# Omari — Tree Generator: Document Ingestion + LLM Strengthening Plan

**Status:** Plan only — nothing implemented. Companion to `tree-generator-conceptual-spec.md` and `tree-generator-technical-architecture.md`.

**Goal:** Let the generator ingest a clinic's existing documents (provider rosters, triage cheat sheets, surgeon preference sheets, sample referrals) so trees are built faster and more correctly with the least possible doctor involvement — and strengthen the extraction LLM with open-source clinical-logic corpora (CMS eCQMs, AHRQ CDS Connect, HL7 CQL) — without breaking the system's core invariants.

---

## Part 0 — The architectural stance (read this first, it shapes everything)

The current system has an invariant pinned both in the technical architecture doc and structurally in `backend/tests/test_llm_invariant.py`: **the engine decides, the LLM only reads/extracts/phrases.** Induction, assembly, gap detection, and validation are pure deterministic TypeScript (`frontend/src/lib/generator/`). No LLM-facing schema has a channel through which a specialist, urgency, or workup decision can flow. This isn't incidental — it's the safety story ("every branch traces to a surgeon decision") and the moat ("surgeon-authored, not auto-configured," conceptual spec risk R5).

A naive version of this feature — *"here is Dr. Smith's knee pain protocol PDF, model outputs a decision tree"* — crosses that line. If the model authors trees, Omari becomes the auto-configuration engine the spec explicitly warns against, and loses the "agrees with Dr. Li's own decisions on 94% of cases" proof artifact, because there are no surgeon decisions to validate against.

**The resolution — and it's better, not just safer:** documents don't *author* the tree; they **pre-load every stage of the existing elicitation pipeline**, so the surgeon's job collapses from *deciding from scratch* to *confirming and correcting*. This is the spec's own core principle ("recognition over recall") extended one level: today the surgeon reacts to cases instead of a blank canvas; with ingestion, the surgeon reacts to *pre-answered cases and pre-filled vocabulary* instead of raw cases. Concretely:

- Extracted material enters as **proposals** — a new quarantined data type with provenance (source doc, page, exact quote) and confidence. Proposals cannot become tree content without either (a) an explicit surgeon confirmation, or (b) deterministic induction over confirmed decisions, same as today.
- The LLM's target skill (and the fine-tuning target in Part 3) is **document → structured proposals**: variables, candidate rules, workup guards, roster entries, code mappings. Never document → tree.
- The deterministic core (`induce.ts`, `assemble.ts`, `gaps.ts`, `validate.ts`) stays the sole author of tree structure, unchanged.

Result: doctor involvement drops from ~90 minutes to a target of ~20–30 minutes, but the output still carries the two-axis validation score against the surgeon's own (confirmed) decisions — the thing that closes the credibility gap against incumbents. Speed *and* proof, instead of speed at the cost of proof.

---

## Part 1 — The document ingestion pipeline

### 1.1 Intake and preprocessing (shared infrastructure)

**New backend surface:** a `documents` domain — upload endpoint, storage, and a processing pipeline.

- **Formats:** PDF (native + scanned), DOCX, XLSX/CSV (rosters are usually spreadsheets), images (faxed referral orders are effectively photos of paper). Pipeline: file → text extraction (PyMuPDF for native PDFs; OCR via Tesseract or a vision-capable Claude call for scans/faxes — faxes are low-quality enough that a vision model will meaningfully outperform OCR) → normalized text with page/region anchors preserved.
- **De-identification pass runs before any LLM sees content.** Referral letters and PCP notes contain PHI; even rosters can (patient names in schedule exports). The `ingest_referrals` job already established this pattern (de-identified letters rewritten into cases). Formalize it: a deterministic scrubber (regex tiers for MRN/DOB/SSN/phone) followed by an LLM de-id verification pass whose *only* output channel is "spans still containing possible PHI" — then human-visible confirmation before the document proceeds. Store the original encrypted-at-rest, process only the scrubbed text.
- **New tables:** `documents` (id, clinic_id, type, filename, status, uploaded_by), `document_pages` (text + anchors), `doc_extractions` (the proposal store — type, payload JSONB, source_quote, page_anchor, confidence, status: `proposed | confirmed | rejected | superseded`, confirmed_by, confirmed_at). Alembic migration `006_documents`.

### 1.2 Classification stage

One cheap LLM call per document: classify into `roster | protocol | prerequisites | referral_sample | mixed | unknown`, with a rationale. Real clinic documents are messy — a "doctor preference sheet" often contains roster info *and* prerequisites *and* triage rules. So classification is per-*section*, not per-file: the classifier returns typed regions, and each region routes to the appropriate extractor. `unknown` regions surface to the user ("we couldn't tell what this section is — skip it or tag it?") rather than being silently dropped.

### 1.3 The four extractors (LLM jobs 7–10, all proposal-only)

These follow the exact pattern of the existing six jobs in `services/anthropic.py`: temperature 0, forced tool-use with strict schemas, no decision channels, template fallbacks where sensible, and each gets a pinned schema check added to `test_llm_invariant.py`.

#### Job 7 — Roster extraction (`extract_roster`)

Input: roster/directory regions. Output schema per provider:

- `name`, `credentials` (MD/DO/PA/NP/APP — drives a new capability: trees can route to "surgeon vs. APP" tiers), `subspecialty_focus` (free text + normalized tags), `locations` (site + days if present), `insurance_panels` (payer names as written — normalize later against a payer dictionary), `source_quote` per field.

Feeds: the Setup page's specialist roster, which today is hand-entered. New tables: `providers`, `provider_locations`, `provider_insurance` (clinic-scoped, reusable across sessions — the roster is clinic infrastructure, not session data).

**Design decision to make now:** locations/schedules and insurance panels are *scheduling-time constraints*, not routing logic. They attach to the leaf as metadata the downstream scheduler consumes (`leafConstraints` on the terminal node or provider record), not tree branches — "what insurance do you have?" must not pollute the clinical tree. One exception worth supporting: a payer-mismatch escalation guard ("routed to Dr. Smith but panel mismatch → escalate to scheduling review"), which is an engine-level post-check, not a branch.

#### Job 8 — Protocol/triage extraction (`extract_protocol_rules`)

Input: cheat sheets, phone scripts, nursing protocol binders, SOPs. This is the highest-value and highest-risk extractor. Output schema per rule:

- `kind`: `red_flag | categorization | disposition`
- `conditions`: list of `{concept, comparator, value, verbatim_phrase}` — e.g. `{concept: "bowel_bladder_control", comparator: "eq", value: "lost", verbatim: "loss of bowel/bladder control"}`
- `implied_disposition`: free-text as written ("route to on-call surgeon immediately") — **deliberately a string, not a specialist ID**; mapping to a roster entry happens in a separate confirmation step so the LLM never assigns a destination.
- `urgency_language`: verbatim ("immediately", "within 24h")
- `source_quote`, `confidence`.

Where it feeds — three places, none of which is "the tree":

1. **Layer 1 pre-seeding:** each rule's concepts become pre-populated candidate variables with axis tags, entering the same cross-case tally as highlight-derived variables but flagged `source: document`. The highlight game still runs, but the vocabulary panel starts warm instead of empty.
2. **Targeted case generation:** each extracted rule becomes a generation directive for Job 1 (`generate_cases`): "generate a case pair that sits on either side of this rule's boundary." This is the killer synergy — the spec's biggest risk (R1: shallow cases → thin trees) gets directly mitigated, because the case stream is steered to exercise the clinic's *actual* documented boundaries, including minimal pairs around every extracted threshold.
3. **Pre-answered decision cards (the big UX change, see Part 2):** for each generated case that a rule covers, the Decide card arrives pre-filled with the protocol's implied answer, shown with the source quote. The surgeon confirms, edits, or rejects. A confirmed pre-fill is recorded as a full surgeon decision (with `provenance: doc_confirmed`) and flows into deterministic induction exactly like today's decisions.

**Red-flag rules get special handling** (the clinical-safety core): never batch-confirmed, never auto-anything. Each extracted red-flag rule renders as an individual confirmation item; the surgeon must explicitly accept, modify, or reject each one; accepted red flags are inserted by the assembler as top-of-tree escalation checks (deterministic — the existing escalation-node machinery); and the validation battery (Part 4) must include cases exercising every accepted red flag with a hard 0%-under-escalation gate.

#### Job 9 — Prerequisite extraction (`extract_prerequisites`)

Input: doctor preference sheets, pre-consultation checklists, intake requirement memos. Output schema per requirement:

- `provider_ref` (name string as written, mapped to roster in confirmation) or `condition_scope` ("all knee replacement consults")
- `requirement_kind`: `diagnostic | conservative_care | sequencing`
- `test_or_action`, `recency_window` ("MRI within 6 months"), `quantity_threshold` ("6 consecutive weeks of PT"), `sequencing_note` ("audiology 30 min before ENT slot")
- `source_quote`, `confidence`.

This maps almost 1:1 onto the existing `WorkupSpec` (b-model: always / conditional / doNotOrderUnless) — which is why it's the second-easiest extractor to build after roster. Two schema extensions needed:

- **Recency windows** on workup items (`recencyMonths` — "MRI, but only if none in the last 6 months" is a *do-not-reorder* guard, which is the over-ordering principle expressed by the clinic itself).
- **Conservative-care benchmarks** are workup items whose "test" is a care history fact ("6 weeks PT completed") — they fit the WorkupSpec shape but the Runner must treat them as *ask-the-patient* items, not orderable tests. Sequencing constraints (`sequencing_note`) are scheduling metadata on the leaf, same bucket as Job 7's location constraints — do not model them as clinical logic.

Confirmed prerequisites become *proposed leaf workups*: when assembly reaches a leaf for Dr. Smith, the induced workup (from decisions) is merged with confirmed document prerequisites, and **disagreements between the two become a new gap kind** ("Dr. Smith's preference sheet requires a 6-month-recent MRI, but your case decisions never ordered one on this path — which is right?"). Documents and elicitation cross-examine each other; that's a quality mechanism neither source has alone.

#### Job 10 — External referral vocabulary (`extract_referral_vocab`)

Input: sample faxed referral orders, prior-auth forms, PCP clinical notes (de-identified). Output:

- `icd10_codes` with surrounding context (validate code format deterministically against the public ICD-10-CM list — codes are public domain in the US, ship the table)
- `jargon_mappings`: `{external_term: "lateral epicondylitis", proposed_internal_variable: "elbow_pain_lateral", evidence_quote}`
- `referral_reason_patterns`: recurri/ng phrasings of why patients get sent.

Feeds: (1) a clinic-level `synonym_map` table that the *Runner's* extraction job consumes at intake time — so when a real referral arrives saying "lateral epicondylitis," variable filling recognizes it; (2) realism vocabulary for Job 1 case generation (synthetic cases start speaking the way this clinic's actual referrers write, which sharpens the highlight game); (3) `code_mappings` (ICD-10 → variables/paths) as *proposals* — an ICD-10 code on an inbound referral becomes a pre-filled variable suggestion at intake, never an automatic route (referral codes are notoriously wrong; treat them as weak evidence the surgeon-authored tree then interrogates).

### 1.4 Cross-document reconciliation

Clinics' documents contradict each other constantly (the cheat sheet is 3 years old; the preference sheet is current). After extraction, a deterministic pass groups proposals by concept and flags conflicts: same provider with different focus across docs, contradictory thresholds, red-flag rules present in one SOP but absent from the phone script. Conflicts render in the review UI with both quotes side by side; the surgeon (or clinic admin — see the role split in Part 2) picks. **Never auto-resolve by recency or confidence** — a wrong roster mapping is a misrouted patient.

---

## Part 2 — The accelerated flow: minimizing doctor time

Redesigned wizard flow (`Generate.tsx` gains a stage before Setup):

**Stage 0 — Document drop (clinic admin, not the surgeon).** Upload everything: roster spreadsheets, cheat sheets, preference sheets, sample referrals. Classification + extraction + reconciliation run async. This is deliberately delegable — an office manager can do all of it, and roster/insurance/location confirmation is *their* competence, not the surgeon's. **Split the confirmation queue by required competence:** operational proposals (roster, locations, panels, sequencing) → admin queue; clinical proposals (red flags, categorization rules, prerequisites, thresholds) → surgeon queue. This is the single biggest lever for "least doctor involvement" — most of the extracted volume is operational.

**Stage 1 — Setup:** roster arrives pre-built from Job 7 (admin already confirmed it). Case supply is auto-proposed: letter-derived cases first (existing behavior), then rule-targeted synthetic cases from Job 8 directives.

**Stage 2 — L1 highlight game, shortened:** vocabulary panel starts pre-seeded from documents. The surgeon still highlights (it catches what documents miss — the tacit knowledge documents never contain), but the session needs fewer cases to reach vocabulary saturation. Add a saturation signal: when N consecutive cases produce no new variables, offer to advance.

**Stage 3 — L2 decide, transformed into a confirm-first pass:** cases covered by confirmed protocol rules arrive pre-answered with the source quote visible ("Cheat sheet says: knee pain + popping → Sports Med. Agree for this patient?"). One-tap confirm; edit opens the full card. Cases *not* covered by any rule — the interesting ones — get the full existing treatment (decide, workup chips, counterfactual, minimal-pair probing). Order the queue so uncovered/boundary cases come first while the surgeon is fresh, pre-answered confirmations batch at the end.

**Confirmation-bias guard:** seed a small fraction of pre-fills as *deliberately perturbed* (flagged internally, never persisted as truth) and track whether the surgeon catches them — a surgeon who confirms everything including planted errors is rubber-stamping, and the session should quietly fall back to unfilled cards. This protects the moat's substance, not just its appearance.

**Stage 4 — L3 review, mostly as today,** plus the new gap kinds: doc-vs-decision conflicts, unconfirmed red flags (blocking — cannot publish past an undecided red-flag proposal), prerequisite merge disagreements.

**Time budget target:** admin ~30–45 min (uploads + operational confirmations), surgeon ~20–30 min (highlight a handful of cases, decide the uncovered/boundary cases, confirm pre-fills, resolve clinical gaps). Instrument actual time-in-stage from day one — "surgeon minutes to validated tree" is the headline sales metric and should be quotable from telemetry, not anecdote.

---

## Part 3 — LLM strengthening: the "compiler" strategy, adapted

The instinct — train on text↔logic pairs so the model treats clinical text like code — is right. Three corrections before execution, then the execution plan.

**Correction 1: the training target is extraction schemas, not trees, and not raw CQL.** Per Part 0, the skill needed at scale is *document → structured proposals*. eCQM pairs teach exactly the right reflexes (hard exclusions vs. suggestions, age gates as logic not prose, temporal windows like "within 12 months" as structured recency), but the model should emit **Omari's Zod/tool-use schemas**. Training it to emit CQL and then transpiling adds a lossy middle layer for no benefit — instead, *convert* the eCQM corpus into the internal schema offline (a deterministic-ish CQL→internal-schema converter, LLM-assisted with human spot-checks) so the fine-tuning pairs are (guideline text → internal proposal schema). CQL's real role is as a *source* format and an *export* format (below), not the model's output language.

**Correction 2: know what eCQMs are and aren't.** eCQMs encode *population quality-measure* logic (inclusion/exclusion criteria, temporal windows, care-gap flags) — structurally closest to Omari's **workup guards and prerequisites** (Job 9), and good for red-flag-style hard gates. They are *not* triage routing trees; nothing in CMS's library teaches "knee pain + popping → Sports Med vs. gradual onset → Total Joint." AHRQ CDS Connect artifacts are closer (actual branching CDS logic — statin use, opioid management), so weight them heavily for Job 8's rule-extraction shape. The distribution gap that remains — federal artifacts are *clean*, clinic cheat sheets are *messy* (fragments, table scraps, "call Dr. J's MA first") — is closed with synthetic degradation (below) and a small gold set of real annotated clinic docs, which will matter more per-example than anything else in the corpus.

**Correction 3: fine-tuning is Tier 3, not Step 1.** The current stack is the Anthropic API with strict tool-use, and the six live jobs work. The cheapest large accuracy gains come first from evals + prompt engineering with the same corpus as few-shot material. Fine-tuning an open model (Llama/Qwen) is a real workstream — training infra, serving infra (vLLM), model updates, HIPAA-eligible hosting — and it should have to *beat the frontier-model baseline on the eval* to earn adoption. Run the tiers in order; each tier's artifact (the eval, the corpus) is a prerequisite for the next anyway.

### Tier 1 — Eval-first hardening of the current models (build immediately; also Part 4's foundation)

- Build gold extraction datasets per job: 30–50 real-ish documents per type (start with clinic contacts' docs, de-identified; augment with synthesized cheat sheets reviewed by a clinician), hand-labeled with the exact expected proposal sets.
- Extend the existing eval harness (already a regression gate) with per-job extraction metrics: field-level precision/recall, and **red-flag recall reported separately with its own threshold** (missing a documented red flag is the catastrophic failure mode; over-extracting a spurious rule merely costs the surgeon a rejection tap).
- Mine the eCQM/CDS corpus for **few-shot exemplars**: 3–5 canonical (messy text → clean proposal) pairs per job, embedded in the prompts. This alone typically captures a large fraction of what fine-tuning would buy on structured-extraction tasks.

### Tier 2 — Retrieval for knowledge, not skill

Logic-*skill* shouldn't live in a RAG store — but terminology *knowledge* should: ICD-10-CM code tables (public domain), payer name dictionaries, and an anatomical-term synonym base. Licensing caution: **UMLS requires a (free) license agreement and SNOMED CT requires affiliate licensing** — fine for internal use in a US clinic product but handle the paperwork; ICD-10-CM and RxNorm are unencumbered. These feed deterministic validation (does this code exist?) and retrieval-augmented context for Jobs 8/10 (candidate canonical terms injected into the prompt).

### Tier 3 — Fine-tuned extraction compiler (gated)

- **Corpus:** full eCQM historical archive (CMS eCQI Resource Center) + AHRQ CDS Connect artifacts + HL7 CQL repo tests + Google CQL engine tests (open-sourced July 2024) → parse into (description text, structured logic) pairs → convert logic side into internal proposal schemas → **augment**: paraphrase descriptions (multiple messiness registers: memo-speak, bullet fragments, phone-script imperative), and *degrade* formatting (simulate OCR noise, table linearization, fax artifacts) so the input distribution matches real clinic docs. Target: 5–10k high-quality instruction pairs; quality and distribution-match beat volume.
- **Split discipline:** hold out by **measure family**, not by row — paraphrases of the same eCQM in both train and test will fake the numbers.
- **Method:** LoRA/QLoRA on a strong open base (Llama 3.1 8B/70B or Qwen 2.5 class), standard instruction format, output constrained to the internal JSON schemas (use constrained decoding at inference — schema violations become impossible rather than merely penalized).
- **Adoption gate:** the fine-tuned model must beat the Tier-1 Claude baseline on the gold eval — especially red-flag recall — before any job switches over. Likely realistic outcome worth planning for: the fine-tune wins on cost/latency for high-volume extraction (Job 10 across thousands of referral samples) while Claude stays on the low-volume/high-stakes jobs (red-flag extraction, consistency coaching). Heterogeneous is fine; the eval decides.

### The FHIR play — do it, but at the boundary, not the core

Making FHIR the internal representation would be a rewrite for zero elicitation benefit. Instead, write a deterministic **exporter**: the published `tree_versions` snapshot → FHIR `PlanDefinition`/`Library` (with CQL for the guards). Pure TS/Python transform, no LLM, testable. This gets "interoperable by default" as a checkbox and an EHR-integration story, and it's honest — the tree really is expressible as standard CDS artifacts because the internal schema is already strict.

---

## Part 4 — Clinical accuracy and quality assurance (cross-cutting)

1. **Provenance is total.** Every element of a published tree must trace to one of: surgeon elicitation decision, surgeon-confirmed document proposal (with doc/page/quote), or deterministic induction over those. The publish endpoint already signs snapshots; extend the snapshot to embed the provenance map. This is the audit-trail story for hospital deployment and the liability posture ("the surgeon authored and signed it; here is the quote and the confirmation timestamp for every rule").
2. **Asymmetric metrics, extended.** Keep routing/under-order/over-order never-collapsed; add extraction-layer metrics with the same asymmetry discipline: red-flag recall (hard floor, e.g. must-be-1.0 on the gold set), prerequisite recall (missed prerequisite = wasted visit = the exact failure the product exists to prevent), spurious-rule precision (cost = surgeon annoyance, tolerable).
3. **Red-flag battery in validation.** Every accepted red-flag rule auto-generates adversarial validation cases (rule clearly met, clearly not met, ambiguously met). Publish is blocked on 0% under-escalation for the "clearly met" set.
4. **The invariant test grows with every job.** Jobs 7–10 schemas get pinned in `test_llm_invariant.py`: no specialist IDs, no urgency enums, no orderable-decision channels in any LLM-facing schema; proposal types are structurally unable to enter `decisions`/tree tables without a `confirmed_by` actor.
5. **Compliance becomes a prerequisite, not a deferral.** Ingesting real clinic documents (PHI-bearing referrals, staff data) moves the currently-deferred items — auth, Postgres RLS, `audit_log` — from "pre-PHI hardening someday" to **blocking prerequisites for ingestion GA**. Also: Anthropic API under a BAA / HIPAA-eligible arrangement (or Bedrock/Vertex routing) before any non-scrubbed-adjacent content flows; if Tier 3 ships, the fine-tuned model must be self-hosted or hosted under equivalent terms.
6. **Drift maintenance.** Documents go stale. Store a content hash per document; when a clinic re-uploads a newer roster/preference sheet, diff extractions against confirmed state and surface only the *changes* for re-confirmation — the cheap re-run-one-layer maintainability the conceptual spec demands (§7).

---

## Part 5 — Build sequence

Ordered by risk-retirement and dependency, mirroring the original spec's "deterministic, testable parts first" philosophy:

1. **Document infrastructure + Job 7 (roster)** — lowest clinical risk, immediate visible value (Setup pre-filled), forces building intake/de-id/proposal/confirmation machinery on the easiest content. Includes `006_documents` migration, admin confirmation UI, provenance plumbing.
2. **Job 9 (prerequisites → WorkupSpec proposals)** — nearest-neighbor to the existing schema; delivers the recency-window and conservative-care schema extensions; introduces the doc-vs-decision gap kind. Auth/RLS/audit_log land in this phase (compliance prerequisite).
3. **Tier 1 eval hardening** — gold datasets for Jobs 7/9 retroactively and 8/10 prospectively; extraction metrics in the harness; regression gates. **Do not start Job 8 without this** — it's the extractor where silent quality failure is dangerous.
4. **Job 8 (protocols/triage)** — the big one: rule extraction, red-flag confirmation flow, rule-targeted case generation, pre-answered decide cards, perturbation guard, saturation signal. This phase transforms the surgeon experience.
5. **Job 10 (referral vocabulary) + synonym map into the Runner** — closes the loop from generation-time documents to intake-time extraction quality.
6. **FHIR/CQL exporter** — deterministic, parallelizable anytime after phase 2; cheap credibility.
7. **Tier 3 fine-tune track** — starts only after phase 3's eval exists (it's the adoption gate); runs parallel to phases 4–6; corpus work (eCQM scrape/parse/convert/degrade) can begin earlier since it's useful for Tier-1 few-shots regardless.

### The biggest risks, named

- **(a) Extraction quality on genuinely messy real documents** — mitigate by getting 20+ real clinic docs in hand *before* phase 4 and building the gold set from them, not from imagined cheat sheets.
- **(b) Rubber-stamping eroding the moat** — the perturbation guard and uncovered-cases-first ordering are not optional polish; they're what keeps "surgeon-authored" true.
- **(c) Scope creep toward LLM-authored logic under speed pressure** — the invariant test is the structural defense; extend it before each new job, not after.

**The through-line:** documents make the system *fast*; the confirm-don't-author architecture keeps it *provable*; the eval corpus makes the extraction *strong*; and the same corpus, converted into internal schemas, is what makes fine-tuning worthwhile if the frontier-model baseline ever stops being enough.
