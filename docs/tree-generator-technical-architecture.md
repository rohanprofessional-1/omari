# Omari — Technical Architecture & Backend Spec (v2, adapted to the actual stack)
### From frontend demo → functional, multi-tenant, clinically-safe tool

**Purpose.** This is the stack-adapted version of *Omari_Technical_Architecture_Spec.md* (v1, which assumed Next.js API routes + Supabase). The decision, made 2026-07-02, is to **adapt the spec to the existing stack, not migrate the stack to the spec.** Every concept from v1 survives; only the runtime topology, auth story, and persistence details change. Where v1 and reality diverge, this document wins.

**Companion doc:** `docs/tree-generator-conceptual-spec.md` (the 3-layer generator concept — stack-agnostic, unchanged).

**The actual stack (what we adapt to):**

| Piece | Reality |
|---|---|
| Frontend | Vite + React + TypeScript SPA (`frontend/`), React Flow, Zod. Port **5173**. |
| Backend | **FastAPI** + async SQLAlchemy + Alembic (`backend/`), Postgres in Docker (`blume-postgres`/`blume-backend`). Port **8000**, prefix `/api/v1`. |
| Live-AI relay | Node/Express (`frontend/server/index.mjs`), port **8001** — `/api/extract`, `/api/triage`, `/api/voice`, `/api/phrase`. Holds the Anthropic key. Gitignored. |
| Proxy | `vite.config.ts`: `/api/v1/*` → 8000 (FastAPI), `/api/*` → 8001 (Node). |
| Engine | Pure TS, `frontend/src/lib/engine.ts` (resumable, unit-tested). Runs **in the browser**; the backend persists, it does not route. |
| Tree schema | Zod, `frontend/src/types/tree.ts` — the declared single source of truth. Mirrored by Pydantic schemas in `backend/app/schemas/`. |
| Eval | `frontend/eval/` — extraction eval harness + red-team + calibration (Node scripts hitting the live extractor). |

---

## 1. System shape (the mental model — unchanged invariant, adapted topology)

Three subsystems around one shared artifact (the tree):

```
  UPSTREAM (Generator)          SHARED              DOWNSTREAM (Runtime)
  ┌──────────────────┐      ┌───────────┐        ┌──────────────────────┐
  │ 3-layer elicit    │────▶ │  TREE     │ ◀──────│ Patient intake loop  │
  │ + assemble + val  │      │ (schema)  │        │ (engine + LLM)       │
  └──────────────────┘      └───────────┘        └──────────┬───────────┘
         ▲                        ▲                          │
         │                        │                          ▼
   Surgeon (author)         Deterministic Engine       Referral packet
                            (pure TS, one copy,         ─▶ Doctor Dashboard
                             reused by both sides)          (review/approve)
```

**The one invariant (verbatim from v1, already true in this codebase):** the **deterministic engine** decides routing and selects workup. The **LLM only reads, extracts, phrases, and generates cases** — it never makes or overrides a routing/workup decision. `engine.ts` and `server/index.mjs` already state this boundary in their headers; the generator inherits it.

**Adapted runtime topology:**

- **Vite/React SPA** — Builder, Runner, and the new Generator UX (highlight game, case decisions, gap review). The engine and all *deterministic* generator logic run here as pure TS (see §4 for why this is safe and where it hardens later).
- **FastAPI (8000)** — the system of record. All persistence (trees, versions, generator session data, conversations, referrals, audit), all multi-tenancy enforcement, and — after consolidation (D2 below) — all LLM calls.
- **Node live-AI server (8001)** — today's LLM relay. **Slated for retirement**: `backend/app/services/anthropic.py` already ports all four prompts verbatim. Until cutover it stays; new LLM jobs are built in FastAPI only.
- **Postgres (Docker)** — dev via `docker compose`; a managed Postgres (RDS/Cloud SQL/Supabase-as-plain-Postgres) for prod. Migrations via Alembic.

**Key architectural decisions this adaptation makes** (each detailed in its section):

- **D1 — Tree persistence goes hybrid.** Relational tables (`nodes`/`branches`/`conditions`) remain the *editable draft* surface (they already work); publishing writes an **immutable JSONB snapshot** to `tree_versions` in the *frontend camelCase shape* — the engine's native input. (§2.2)
- **D2 — One LLM relay, in FastAPI.** Consolidate the duplicated Node/FastAPI LLM code into `services/anthropic.py`; retire port 8001 and the proxy split. New generator jobs (case gen, highlight fallback, gap phrasing) are FastAPI-only from day one. (§6)
- **D3 — Deterministic generator logic is pure TS, browser-first.** Induction, assembly, gap detection, and validation are pure TS modules under `frontend/src/lib/generator/`, importing the *actual* `engine.ts` (one engine, no Python port, no drift). FastAPI persists each stage's output. Written environment-agnostic so the same modules later run in a Node worker for authoritative server-side validation — a hardening step, not a rewrite. (§4)
- **D4 — Auth is FastAPI-native JWT + app-layer org scoping; Postgres RLS is a pre-PHI hardening gate,** not an MVP blocker. (§7)

---

## 2. Data model (adapted to SQLAlchemy/Alembic; `org` → `clinic`)

The codebase already uses `clinics` as the tenant unit — we keep that name rather than introducing `organizations`. Every customer-owned row carries `clinic_id`. Conventions follow the existing models: `String(36)` UUID PKs, `TimestampMixin`, enums as named Postgres enums, JSON via SQLAlchemy `JSON` (use JSONB on Postgres).

### 2.1 Tenancy, identity, roster

```
clinics               EXISTS (id, name, type, knowledge_base, group)
users                 NEW    (id, clinic_id, email, role, name, auth fields per D4)
                             -- role: surgeon | staff | admin
specialists           EXISTS (id, clinic_id, name, specialty, email, phone,
                              department, notes, is_active)
                             -- ADD: urgency_default, reasoning_template
                             -- (v1 spec fields; today these live only on tree nodes)
```

Note: `SpecialistNode` currently stores `specialistName`/`specialty` as **strings**, not FKs. The generator needs a real roster (Layer 2 asks "which of your surgeons?"), so generated trees should reference `specialists.id`, with the string fields kept as denormalized display values for backward compatibility.

### 2.2 The tree (versioned, signed) — decision D1

```
trees                 EXISTS (id, clinic_id, name, description, root_node_id,
                              version, is_active, authored_by)
                             -- ADD: status (draft | published | archived),
                             --      current_version_id, subspecialty
nodes/branches/conditions/workup_items   EXIST — remain the DRAFT edit surface
tree_versions         NEW    (id, tree_id, version_no, tree_json,           -- JSONB, IMMUTABLE
                              validation_summary_json, signed_by, signed_at,
                              created_at)
```

- **Draft** = the relational rows the Builder already saves via `POST /api/v1/trees/full`. Editable, mutable, Zod-validated on save.
- **Publish** = serialize the draft to the frontend `Tree` shape (the exact JSON `TreeSchema.parse` accepts and `runEngine` consumes), validate, snapshot into `tree_versions`, stamp `signed_by`/`signed_at`. Never mutated after creation — this is what makes every historical routing decision reproducible.
- Runtime (conversations) and validation runs pin `tree_version_id`, never the mutable draft.
- Storing `tree_json` in the *frontend camelCase shape* is deliberate: the engine consumes it with zero mapping, and the Zod schema remains the single source of truth. The Pydantic schemas validate transport; Zod defines the contract.

### 2.3 Schema upgrade required first: WorkupSpec (conceptual-spec model "b")

Today `SpecialistNodeSchema.workup` is a **flat list** (model "a"). The generator's differentiator requires **conditioned-leaf workup**:

```ts
// types/tree.ts — the upgrade (Zod first; everything else follows)
interface WorkupSpec {
  always: WorkupItem[]
  conditional: { when: Condition & { key: string }; item: WorkupItem; reason: string }[]
  doNotOrderUnless: { item: string; requiredCondition: Condition & { key: string } }[]
  escalateWorkupIf?: Condition & { key: string }
}
```

- **Zod migration:** accept both shapes; normalize old `WorkupItem[]` → `{ always: items, conditional: [], doNotOrderUnless: [] }`. Existing trees (sample, Duke, library rows) validate unchanged.
- **Engine addition:** a pure `resolveWorkup(spec, filled)` beside `runEngine` — evaluates `conditional`/`doNotOrderUnless`/`escalateWorkupIf` against the path variables using the existing `evaluateCondition`. Unit-tested like the engine.
- **Persistence:** add a JSONB `workup_spec` column on `nodes` (Zod-validated at the API boundary); migrate existing `workup_items` rows into `workup_spec.always`. The `workup_items` table stays only until the Builder UI reads the new column, then is dropped. Rationale: workup rules are read/written as a unit and never queried relationally — JSONB is the honest shape, and it matches the snapshot-first direction of D1.

### 2.4 Generator working data (the 3 layers) — all NEW

```
generation_sessions   (id, clinic_id, tree_id?, created_by, stage, status)
synthetic_cases       (id, clinic_id?,            -- NULL = shared/template library
                       subspecialty, narrative, ground_truth_json,
                       source, quality_reviewed)   -- source: generated | real_deidentified
case_highlights       (id, session_id, case_id, span_text, span_start, span_end,
                       axis, mapped_variable_key)  -- axis: routing | workup | both
candidate_variables   (id, session_id, key, label, axis, value_samples_json, frequency)
case_decisions        (id, session_id, case_id, routed_specialist_id,
                       workup_json, workup_counterfactual, would_not_order_json,
                       is_minimal_pair_of, varied_variable)
induced_rules         (id, session_id, kind, condition_json, target_json,
                       support_case_ids_json, confidence)   -- kind: routing_branch | workup_rule
gaps                  (id, session_id, kind, detail_json, status)
validation_runs       (id, session_id, tree_json, ran_at)
validation_results    (id, run_id, case_id, expected_json, engine_json,
                       routing_match, workup_under_order, workup_over_order)
```

Pipeline shape is unchanged from v1: each layer reads the previous tables and writes the next, culminating in a draft `tree_json` + `validation_summary_json` (the two-axis metric).

**Registry caveat:** the existing `variables` table is **global** (PK = `key`). Generator sessions will mint new variables per clinic/subspecialty. Either scope the table (`(clinic_id, key)` PK) or keep generator candidates in `candidate_variables` until publish and namespace on promotion. Decide before Layer 1 ships; the global table is fine until then.

### 2.5 Runtime (patient intake → referral) — mostly EXISTS

The v1 spec's runtime tables map almost 1:1 onto what's built:

| v1 spec | Reality |
|---|---|
| `intake_sessions` | `conversations` EXISTS — ADD `tree_version_id` (pin the immutable version), `mode (live\|demo)` |
| `intake_messages` | `conversation_turns` EXISTS |
| `extracted_variables` | `patient_variables` EXISTS (typed value columns + confidence + via) |
| `routing_results` | On `conversations` EXISTS (`outcome_specialist_id`, `outcome_urgency`, `escalation_reason`, `path_taken`) — ADD `workup_json` (the *resolved* workup) |
| `referrals` | NEW: `(id, clinic_id, conversation_id, status, specialist_id, workup_json, reviewed_by, reviewed_at, override_json)` — status: `pending_review \| approved \| rerouted` |

### 2.6 Audit (append-only — non-negotiable for clinical) — NEW

```
audit_log             (id, clinic_id, actor_id, action, entity_type, entity_id,
                       before_json, after_json, created_at)
```

Every clinically meaningful mutation writes here: tree published, referral approved/overridden, workup changed. Enforce append-only in Postgres itself (Alembic migration: `REVOKE UPDATE, DELETE ON audit_log FROM <app role>`, or a `BEFORE UPDATE OR DELETE` trigger that raises). Application discipline is not enforcement.

---

## 3. The tree schema (unchanged principle, one source of truth)

`frontend/src/types/tree.ts` **remains the single source of truth** — it already declares itself as such, and the engine, Builder, Runner, and eval harness all import it. The v1 spec's TS interfaces are already ~90% implemented there. The deltas:

1. **`WorkupSpec`** (§2.3) — the load-bearing upgrade.
2. **Escalation reasons on both axes** — escalation can be a routing hole *or* "surgeon must decide diagnostics" (`escalateWorkupIf`).
3. **`specialistId` FK** on `SpecialistNode` (§2.1), keeping the display strings.

The Pydantic schemas in `backend/app/schemas/` mirror Zod for transport validation (as `TreeFullCreate` does today). Accepted drift risk: mirror maintenance is manual; the mitigation is that `tree_versions.tree_json` is validated by **Zod** before publish and consumed by the engine directly, so Pydantic drift can't corrupt the runtime artifact.

---

## 4. The deterministic engine + generator compute (decision D3)

`engine.ts` is already exactly what the v1 spec demands: pure, resumable (`incomplete` + `missingVariables` = v1's `need_variable`), path-tracking, cycle-guarded, unit-tested, LLM-free. **It does not get ported to Python.** A second engine implementation is the single easiest way to violate the "one engine, two uses" invariant.

Consequences:

- **Generator deterministic stages live in `frontend/src/lib/generator/`** as pure TS modules: `accumulator.ts` (Layer 1 tally), `induce.ts` (partitioner), `assemble.ts`, `gaps.ts`, `validate.ts` (imports `runEngine` + `resolveWorkup` directly — Layer 3 validation runs the *actual* engine against recorded `case_decisions`). Each stage POSTs its output to FastAPI for persistence, so the DB — not browser state — is the record.
- **Environment-agnostic by construction:** no DOM, no fetch inside the pure modules (I/O stays in thin callers). The existing eval harness (`frontend/eval/`, Node `.mjs` scripts importing pure `metrics.mjs`) proves this pattern in this repo.
- **Hardening path (pre-real-deployment):** when validation must be authoritative (a surgeon signs based on it) or generation gets heavy, run the *same modules* in a small Node worker invoked by FastAPI (or as a job runner beside it). That is a deployment change, not a rewrite — which is the whole point of keeping them pure.
- **MVP honesty:** browser-run validation is fine while the only user is the authoring surgeon on their own draft. It is not fine as a compliance artifact; the sign-off flow should eventually record a server-side validation run.

Same posture applies to the runtime: today the **frontend runs the engine** and FastAPI persists (as `chat.py`'s header states). That stays for MVP. Moving the intake loop server-side (v1 §5's `POST /api/intake/message` doing triage→extract→engine→next-step in one handler) is the same Node-worker/engine-service decision — flagged as the first hardening step before real patients, since a hostile client must not be able to skip intake-before-routing.

---

## 5. API plan (FastAPI, `/api/v1`, existing routers extended)

Auth via JWT (D4); every handler resolves `current_user` → `clinic_id` and scopes queries. `[D]` = deterministic, `[L]` = LLM job, ✅ = exists today.

### Tree authoring & lifecycle (`api/v1/trees.py`)
```
GET    /trees                       ✅ list (org-scoped once auth lands)
POST   /trees                       ✅ create draft (metadata)
POST   /trees/full                  ✅ persist complete nested draft [D]
GET    /trees/{id}                  ✅ full tree
PATCH  /trees/{id}                  ✅ rename/update
DELETE /trees/{id}                  ✅ soft delete
POST   /trees/{id}/publish          NEW  draft → immutable tree_versions row + sign [D]
GET    /trees/{id}/versions         NEW  version history (audit)
```
Specialists/variables/clinics/patients CRUD ✅ exist.

### Generator (`api/v1/gen.py` — NEW router, per layer)
```
POST   /gen/sessions                          start a generation session
POST   /gen/cases                             generate synthetic cases        [L] (offline/curated)
GET    /gen/cases?subspecialty=…              list cases
POST   /gen/highlights                        submit Layer-1 highlights       [D] (+ [L] fallback classify)
GET    /gen/sessions/{id}/variables           ranked candidate variables      [D]
POST   /gen/decisions                         Layer-2 routing+workup per case [D]
POST   /gen/sessions/{id}/induce              persist induced_rules           [D]*
POST   /gen/sessions/{id}/assemble            persist draft tree_json         [D]*
POST   /gen/sessions/{id}/gaps                persist gap list                [D]* (+ [L] phrasing)
POST   /gen/sessions/{id}/validate            persist validation run + metric [D]*
```
\* Per D3, at MVP the deterministic computation runs in the browser and these endpoints **persist and version** the results (server recomputation comes with the Node worker). The v1 observation stands: **almost the entire generator is deterministic** — the LLM only generates cases, fallback-classifies highlights, and phrases gap messages.

### Runtime intake (`api/v1/conversations.py` — ✅ exists, extend)
```
POST   /conversations                         ✅ start (ADD: tree_version_id pin)
POST   /conversations/{id}/chat               ✅ triage [L] + extract [L] + persist
GET    /conversations/{id}                    ✅ state (turns, variables, path)
```
Turn loop today: `chat.py` stores turn → triage (non-symptom turns get a warm reply and **do not advance routing** — v1's rule, already implemented) → extract → persist typed `patient_variables`. Frontend runs the engine, applies the threshold bands from `thresholds.ts` (commit ≥0.8 / confirm ≥0.5 / re-ask below — this is v1's confidence-handling, already built), and asks the next question. The `NextStep` union from v1 (`ask | confirm | reply | done`) is worth adopting as the explicit response type when the loop moves server-side.

### Doctor dashboard (`api/v1/referrals.py` — NEW)
```
GET    /referrals?status=pending_review       queue
GET    /referrals/{id}                        packet: specialist, resolved workup, path,
                                              transcript, confidences, "why" (explain.ts)
POST   /referrals/{id}/approve                → approved (+ audit)
POST   /referrals/{id}/override               reroute / edit workup (+ audit)
```

### Consolidated LLM relay (`api/v1/ai.py` — NEW, replaces Node :8001) — decision D2
```
POST   /ai/extract    POST /ai/triage    POST /ai/voice    POST /ai/phrase
```
Thin wrappers over `services/anthropic.py` (prompts already ported). Cutover: point `extract.ts`/`triage.ts`/`voice.ts`/`phrase.ts` at `/api/v1/ai/*`, delete the `'/api' → 8001` proxy rule, retire `server/index.mjs`, move the key to `backend/.env` only. Re-run `npm run eval` against the new endpoints before deleting anything — the eval harness is the regression gate for this migration.

---

## 6. LLM structure & plan (same seven jobs, one home)

The seven-job inventory from v1 maps onto reality as follows. All jobs live in `backend/app/services/anthropic.py` after D2; each is single-purpose, schema-forced, server-side.

| # | Job | Status | Where |
|---|-----|--------|-------|
| 1 | Synthetic case generation | NEW | `anthropic.py` — offline/curated flow, surgeon quality-review gate (R1) |
| 2 | Highlight→variable classify (fallback) | NEW | `anthropic.py` — only for spans not matched by case ground truth |
| 3 | Gap message phrasing | NEW | `anthropic.py` — phrasing only; detection is deterministic TS |
| 4 | Turn-type classification | ✅ built | `triage()` — forced `triage_turn` tool; cannot advance routing |
| 5 | Variable extraction | ✅ built | `extract()` — forced tool use; thresholds gate acceptance |
| 6 | Targeted question generation | ✅ built | `voice()` — falls back to authored prompt on failure |
| 7 | Patient-facing phrasing cleanup | ✅ built | `phrase()` + deterministic `patientLabel` fallback |

Existing practices to keep (all already in the code): forced tool-use with `disable_parallel_tool_use`, prompts owned server-side (browser sends only text + tool schema), deterministic fallbacks for jobs 6/7, graceful degradation when the key is missing.

**Hard-won lessons to preserve as requirements:**
- **`unwrapVariables`** (`extract.ts`): the extractor model intermittently nests tool args under a junk key; the unwrap fixed extraction F1 from 37%→74.5%. Any new extraction consumer must go through the same parse path.
- **Model IDs in env only** (`config.py`: `ANTHROPIC_MODEL`, `ANTHROPIC_EXTRACT_MODEL`; Node `.env` today). Add v1's **startup model check** — one cheap call at boot that fails loudly if the configured model is retired/suspended. This exact failure (silent fallback after a model suspension) already bit this project once.
- **Tiering:** fast/cheap tier for jobs 4–7 (latency-sensitive runtime volume), stronger tier for jobs 1–2 (offline, quality-sensitive). Keep both knobs env-driven.
- **Eval harness is load-bearing** (`frontend/eval/`): 22 gold + 10 adversarial cases, per-variable P/R/F1, calibration/ECE (which justified the 0.8/0.5 thresholds — the model is well-calibrated ≥80%, unreliable at 50–70%). Extend the same discipline to job 1 (case quality rubric) and job 2 (classify accuracy) as they're built. Run sequentially — concurrent bursts hit rate limits and return degraded results.

---

## 7. Security, multi-tenancy & compliance (decision D4)

- **Auth (NEW):** FastAPI-native JWT — a `users` table with hashed credentials (or an external IdP later; the seam is a `get_current_user` dependency either way). Roles: `surgeon | staff | admin`.
- **Multi-tenancy, two stages:**
  1. **MVP — app-layer scoping:** a `get_current_clinic` dependency; every query in every router filters by `clinic_id`. Enforced by code review + a test suite that asserts cross-clinic reads fail. This replaces Supabase RLS-by-default.
  2. **Pre-PHI hardening — Postgres RLS for real:** enable `ROW LEVEL SECURITY` on customer tables via Alembic, `SET LOCAL app.clinic_id` per request/session, policies keyed to it. Defense-in-depth under the same FastAPI code.
- **PHI posture (unchanged from v1 — it's stack-independent):** BAA with Anthropic and the DB/host **before any real patient**; until then only synthetic/de-identified data through Claude. TLS in transit; encrypted storage at rest (managed Postgres in prod — the Docker volume is dev-only). Minimum-necessary prompts (already practiced: the relay sends patient text + variable schema, never the tree). De-identify everything used for validation.
- **Secrets:** Anthropic key currently in gitignored `frontend/.env` (Node server). After D2: `backend/.env` in dev, host secret manager in prod. Never in the client bundle — already true, keep it true.
- **Audit:** §2.6, append-only enforced in the database.
- **Regulatory posture (unchanged):** engine-decides / surgeon-authors / surgeon-signs keeps this surgeon-authored decision support with a human in the loop. The `tree_versions` sign-off chain plus `audit_log` is the evidence trail. Worth a conversation with someone who knows FDA CDS guidance before go-live.

---

## 8. Migration path: demo → functional (resequenced against what's already built)

Steps 1 and much of 3 from v1's sequence are **already done** — that work just wasn't visible to the v1 author.

0. ✅ **Done already:** tree persistence + library picker (`/trees/full`, `treeLibrary.ts`, seed scripts); conversation/turn/variable persistence (`chat.py`); LLM relay with guardrails; engine + tests; extraction eval harness + thresholds + calibration + explainability.
1. **Schema v2 + versioning.** `WorkupSpec` in Zod (backward-compatible normalize), `resolveWorkup` in the engine, `workup_spec` JSONB column + Alembic migration, `POST /trees/{id}/publish` → immutable `tree_versions`, pin `tree_version_id` on conversations. *Locks the seam everything else depends on (v1 build-sequence step 1).*
2. **Auth + users + clinic scoping + audit_log.** D4 stage 1. *Turns it multi-user; audit starts accumulating from the first real mutation.*
3. **LLM consolidation (D2).** `api/v1/ai.py`, frontend cutover, eval-harness regression run, retire :8001 and the proxy split.
4. **Referrals + dashboard.** `referrals` table + queue + approve/override, `explain.ts` output in the packet. *Closes the loop to the buyer.*
5. **Generator thin slice (highest risk, prove early).** Layer 2 UI (case decisions, both questions per case) on a handful of hand-authored cases → `induce.ts` → `assemble.ts` → `validate.ts` reusing the engine → the **two-axis metric** persisted via `/gen/*`. *The conceptual spec's step 2–3; everything rides on this working.*
6. **Generator full.** Layer 1 highlight game + curated case generation (job 1 + quality review — R1 is the real bottleneck), gap detection incl. over-ordering flags, then hospital-ready wrap (reconciliation, sign-off UI, template forking).
7. **Compliance + hardening gate** before any real patient: BAA, RLS stage 2, server-side validation/intake (the D3/§4 Node-worker step), PHI review.

---

## 9. Open technical questions (v1's list, adapted)

- **When does generator compute move server-side?** (replaces v1's "sync vs. async") — trigger is either surgeon sign-off requiring an authoritative validation run, or case volume making browser runs slow. The D3 purity rule keeps the move cheap; decide the hosting shape then (Node worker beside FastAPI vs. FastAPI shelling to a pinned script).
- **Records ingestion** (`dataSource: "record"` — already in the enum): stub the interface; build-vs-integrate later. Unchanged from v1.
- **Workup model depth:** ship (b) conditioned-leaf; instrument for when a subspecialty needs (c) branchable workup sub-logic. Unchanged.
- **Variables registry scoping** (§2.4): global `variables.key` PK vs. clinic-scoped — decide before Layer 1 mints variables.
- **Reconciliation UX for multi-surgeon trees** — ties to conceptual-spec R6 (who authors a department tree). Unchanged.
- **Model pinning & fallback policy** — which tier per job, exact behavior when the primary model is unavailable; implement the startup check (§6). Already bit once.
- **Zod↔Pydantic mirror maintenance** — live with manual mirroring, or generate one from the other (e.g., JSON Schema export from Zod → Pydantic codegen) once the schema stabilizes post-WorkupSpec.

---

## 10. The throughline (unchanged — the stack was never the point)

Everything above serves the same invariant as v1: **the engine decides, the surgeon authors, the LLM only reads and phrases — and every decision is versioned, signed, and auditable.** The adaptation changes *where things run* (FastAPI instead of Next.js routes, JWT + scoped queries instead of Supabase RLS, one TS engine kept pure instead of ported), but not one element of the safety architecture. The demo already proves the experience — and more of the v1 spec than its author knew was already real. This document is the path to making the rest true on the stack we actually have.
