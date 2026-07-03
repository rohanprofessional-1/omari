# Omari — Referral + Workup Decision Tree Generator
### Conceptual Spec (v1)

**Purpose of this document.** Define, conceptually and completely, the system that takes a surgeon's tacit clinical judgment and turns it into a **validated, hospital-ready decision tree that produces both a routing decision (the exact subspecialist) and a workup determination (the specific pre-visit diagnostics)** — fast enough to neutralize a competitor's "deployed in weeks" advantage, without sacrificing the surgeon authorship that is our moat.

This is a conceptual spec, not implementation code. A technical cofounder should finish it knowing *what* to build, *why each part exists*, *what it inputs and outputs*, and *where the real risks are*.

---

## 0. The one-paragraph summary

A surgeon cannot build a good decision tree from a blank canvas — their expertise is stored as intuitive pattern-recognition on cases, not as an explicit flowchart. So the generator never asks them to *write* their logic; it *elicits* it by having them react to and decide on realistic cases, then induces the tree from those decisions. It runs in three layers: **(1) Variable Elicitation** surfaces the vocabulary (which clinical facts matter, for routing *and* for workup); **(2) Logic Induction** captures the grammar (how those facts decide *where the patient goes* and *what must be done before they arrive*); **(3) Assembly + Gap Detection + Validation** builds the draft tree, interrogates it for holes, and scores it against the surgeon's own decisions to produce both a finished tree and a proof-of-accuracy number. The output is a tree the surgeon authored, owns, and signed — with routing *and* workup as co-equal, inseparable outputs.

---

## 1. Design goals and non-negotiable principles

**Goals**
- **Speed:** get a surgeon from nothing to a strong, validated draft in ~1–2 hours of *their* time. This is the feature that erases a breadth-platform's setup-speed advantage.
- **Dual output:** every terminal decision carries *both* the right subspecialist *and* the right pre-visit workup. Neither is an afterthought.
- **Provable quality:** the process emits an accuracy metric (routing accuracy and workup accuracy, reported separately), because our second competitive gap — credibility vs. an already-deployed incumbent — is closed by evidence, not by a nicer editor.
- **Hospital-ready:** a real department, not one solo surgeon — meaning multi-author reconciliation, sign-off, versioning, and maintainability.

**Principles (these constrain every design choice below)**
- **Recognition over recall.** Never show a blank canvas. Always give the surgeon something to react to, decide on, or correct.
- **Decisions, not abstractions.** Never ask "what's your age cutoff?" Show cases; induce the cutoff from where their routing flips.
- **The surgeon authors; the system drafts.** The output is a *draft the surgeon interrogates, corrects, and signs* — not a tree the system auto-configures and the surgeon rubber-stamps. This line is the entire difference between us and an auto-configuration engine. If we cross it in the name of speed, we've built a worse version of the thing we're differentiating against.
- **Routing and workup are one clinical act, elicited together.** We do not build a routing tree and bolt workup on. The surgeon's judgment "this patient goes to Dr. X *and* needs an EMG first, or the visit is wasted" is a single decision, and we capture it as one.
- **Over-ordering is a failure, not a feature.** Recommending an unneeded test wastes the patient's money and time and erodes trust. The generator must actively elicit *when the surgeon would NOT order something*, and default to conservative (escalate-to-surgeon) when uncertain.

---

## 2. The artifact being produced: the dual-output tree

Everything the generator emits conforms to one schema — the same tree the downstream engine already consumes. The reframe (workup as first-class) changes what the tree must carry.

**Variable nodes** — a clinical fact to be filled from the patient (e.g., symptom duration, symptom location, dominant symptom, prior treatment, EMG status). Each has answer-buckets that drive branching.

**Terminal / specialist nodes** — no longer just a routing destination. Each carries two coupled outputs:
- **Routing:** the exact subspecialist (named clinician, not just department), with urgency and a reasoning template.
- **Workup:** the pre-visit diagnostic specification for patients who land here.

**The key structural decision — workup is path-dependent, not just leaf-dependent.** The right workup is a function of the *combination of variables on the patient's path*, not merely of which specialist they reached. Two patients routed to the same surgeon may need different workups because they arrived by different branches (e.g., one presentation needs an EMG, another needs an MRI with a specific sequence). Three ways to model this, in increasing power:
- **(a) Flat leaf list** — each terminal node has a fixed workup list. Simplest; too shallow for our differentiator. *Rejected as the primary model.*
- **(b) Conditioned leaf workup** — the terminal node's workup is a small set of rules over the path variables ("order EMG always; add MRI-with-contrast only if `mass_present = yes`"). *Recommended baseline.*
- **(c) Workup as its own branchable sub-logic** — workup can branch on variables mid-path, mirroring routing. Most expressive; heaviest to build and elicit. *Reserve for cases where (b) proves insufficient.*

We build **(b)** first: workup lives at the terminal but is conditioned on path variables, plus explicit conservative defaults and "do-not-order-unless" guards. This is expressive enough to be a real differentiator and light enough to elicit and validate.

**Escalation nodes** — genuine ambiguity or red-flag → human review. Present in both routing (no clear specialist) and workup (surgeon must decide the diagnostics) dimensions.

---

## 3. Layer 1 — Variable Elicitation ("the highlight game"), now dual-vocabulary

**Goal.** Surface the *vocabulary* — which clinical facts matter. The reframe adds a second vocabulary: facts that matter for **routing**, facts that matter for **workup**, and the overlap.

**Why this layer exists.** Recognition is faster and more complete than recall. A surgeon reading a rich case will flag what's salient effortlessly; the same surgeon staring at a blank field list will miss things and stall.

**Inputs**
- 10–15 rich, messy, *clinically realistic* synthetic patient narratives for the subspecialty, each with known ground-truth variables baked in (curated offline so quality is controlled — see Risk R1).

**Mechanism**
- The surgeon reads each case and **highlights** the phrases that are clinically salient (browser text-selection).
- **Each highlight is tagged along two axes:** *does this fact change where the patient goes (routing), what needs to be done before the visit (workup), or both?* This tag is the new, load-bearing addition. It's how workup determinants that are routing-irrelevant get captured — e.g., "has a pacemaker" doesn't change the specialist but forbids an MRI, so it's a workup determinant only. The original plan would have missed these entirely.
- A **cross-case accumulator** tallies which variables recur, with what values, and under which axis.

**Outputs**
- A frequency-ranked list of candidate variables, each labeled routing-relevant / workup-relevant / both, with observed value ranges.

**What it captures / can't.** Captures the *vocabulary* (which nodes the tree needs, on both axes). Does *not* capture how those variables discriminate — that's Layer 2.

**Failure modes to design against**
- Surgeon highlights the obvious and skips the tacit → mitigated by case *richness* and by Layer 3 gap detection catching what's missing.
- Workup determinants under-surfaced because they're less top-of-mind than routing cues → mitigated by explicitly prompting the second axis ("and is there anything here that changes what you'd want *done* before you see them?").

---

## 4. Layer 2 — Logic Induction (case-routing + workup induction) — the load-bearing layer

**Goal.** Capture the *grammar* — how variables combine, where thresholds sit, who they route to, **and** what workup each path demands and why. This is where the moat is actually extracted.

**Why this layer exists.** A surgeon's expertise is stored as procedural decision-making on cases. Ask them to *make decisions* and the logic comes out with minimal translation; ask them to *describe* the logic and you get an incomplete, rationalized version.

**Inputs**
- The candidate variables from Layer 1.
- A **specialist roster** — the department's clinicians and each one's focus (these become the leaf nodes).
- A stream of synthetic cases, including deliberately varied ones (below).

**Mechanism — two questions per case, not one**
For each case the surgeon answers:
1. **"Where does this patient go?"** → routing decision (pick a specialist).
2. **"What must be done before they arrive, or the first visit is wasted?"** → workup decision (name the diagnostics), plus the counterfactual: *"and if they showed up without it?"* — this captures *why the workup matters*, which is the value logic behind our whole pitch (productive first visit / time-to-surgery).

**The clever core — systematic case variation (minimal pairs), now serving double duty.**
Show the same case with one variable flipped (age 30 vs. 70; pain at the knee vs. below the knee; mass present vs. absent) and watch what changes:
- If **routing** flips → you've found a routing discriminator and roughly where its threshold sits.
- If **workup** flips → you've found a workup determinant and its trigger.
- **They don't always move together.** A flip may change the workup while the specialist stays the same (same surgeon, but now an EMG is required), or change the specialist while the workup is unchanged. Watching the two axes independently is exactly what separates our elicited depth from rules-based scheduling logic.

**Over-ordering guard elicitation (new, required).** Because an unneeded test is an active harm, Layer 2 must also capture the *negative* space: cases where the surgeon would deliberately **not** order something, and where they'd rather escalate than guess. Present cases near the boundary and ask "would you order the MRI here, or wait?" The "no" answers are as valuable as the "yes" answers — they become the do-not-order guards and conservative defaults in the tree.

**Induction / partitioner logic.** Group the routed cases by chosen specialist, find which variable values separate the groups, and make those the routing branches. Independently, group by workup decision and find which path variables trigger each test → the conditioned workup rules. Start rule-based; ML is not required for a first hospital-ready tree.

**Outputs**
- Routing branch conditions (thresholds, combinations) with the cases that support each.
- Workup rules per path (order / conditionally-order / do-not-order / escalate), each with the surgeon's counterfactual reason attached.

**What it captures.** The discriminating logic for routing *and* workup — the actual moat — plus the value rationale and the safety guards.

**Failure mode to respect (the big one).** This layer's quality is bottlenecked by the synthetic cases from Layer 1. Shallow or generic cases → the surgeon routes them all the same way → nothing discriminates → you induce a thin tree while believing the method worked. Case quality is the hidden dependency; see Risk R1.

---

## 5. Layer 3 — Assembly + Gap Detection + Validation — now dual, and the proof engine

**Goal.** Turn elicited variables + induced logic into a valid tree, surface what's missing on *both* axes, and score it against the surgeon's own decisions — producing the finished tree *and* the accuracy metric.

**Mechanism**

**(a) Tree assembler.** Compose Layer 1 variables + Layer 2 routing/workup logic into a valid tree in the schema: order variable nodes by importance, build routing branches from partitions, attach conditioned workup to terminals, insert escalation nodes wherever routing or workup was ambiguous.

**(b) Gap detection — interrogate the draft (dual-axis).** Surface holes the surgeon didn't notice:
- *Routing coverage gaps* — a variable value seen in cases but with no branch ("you saw 'upper back' but there's no path for it").
- *Workup coverage gaps* — a routed path with **no workup specified** ("patients reach Dr. X via this branch but you never said what they need beforehand — intentional?"). This is the reframe's most important new check.
- *Undifferentiated specialists* — two clinicians no variable ever distinguishes ("what question separates Dr. A from Dr. B?"). Directly serves specialist-level routing.
- *Over-ordering flags* — a path that orders a test on every patient when the cases suggest it's only sometimes needed ("this branch always orders an MRI — is it truly always required, or only when a mass is present?"). This is the safety/cost check, and it's unique to caring about workup.
- *Unhandled buckets, dead ends, thin-evidence branches* — a branch induced from only 1–2 cases, flagged low-confidence.

**(c) Validation pass — the proof artifact.** Run held-out synthetic cases (and, when available, real de-identified historical referrals) through the *actual downstream engine* on the draft tree, and compare to the surgeon's recorded decisions. Report **two numbers, separately:**
- **Routing accuracy** — % of cases routed to the specialist the surgeon chose.
- **Workup accuracy** — decomposed into **under-ordering rate** (missed a test the surgeon wanted — wastes the visit) and **over-ordering rate** (ordered a test the surgeon wouldn't — wastes money/time). These error types have *asymmetric* cost and must never be collapsed into one "accuracy" figure.

Each mismatch is both a remaining gap to fix *and* a data point in the score. When the numbers plateau at a level the surgeon signs off on, the tree is done — and you have a slide that says, e.g., "built in 90 minutes; agrees with Dr. Li's own decisions on 94% of routing and 91% of workup, with a 0% under-order rate on red-flag cases."

**Outputs**
- The finished, valid, surgeon-signed tree.
- A validation report (the two-axis accuracy metric) — simultaneously QA and the external proof of quality.

---

## 6. Why the order, and why all three (unchanged, extended)

A surgeon's knowledge lives in three forms, and no single mechanism reaches all of them:
- **Recognition** ("that's relevant") → Layer 1, highlighting.
- **Procedural decision-making** ("this one goes there, and needs that first") → Layer 2, case-routing + workup.
- **Implicit / unstated knowledge** ("you always do X but never said so") → Layer 3, gap detection.

The order is forced: **vocabulary first** (so you know what to vary in Layer 2), **logic second** (the substance), **gaps last** (you can only detect gaps in a draft that exists). The reframe doesn't change the order — it threads the *workup axis* through all three stages instead of stapling it on at the end.

---

## 7. What makes a tree "hospital-ready" (the cross-cutting requirements)

A single surgeon's validated tree is an MVP artifact. "Hospital-ready" adds four things:

- **Multi-author reconciliation.** A department has several surgeons who may route or work up the same case differently. The generator must run the elicitation per surgeon (or per subspecialty), then surface *disagreements* explicitly and force a resolution: a shared standard, or per-surgeon branches. Unreconciled conflict is a routing error waiting to happen.
- **Sign-off, versioning, and audit trail.** A hospital-deployed clinical logic must be owned, signed, versioned, and change-tracked — who authored it, who approved it, what changed and when. This is also what keeps you on the safe side of clinical-decision-support scrutiny: the surgeon authored and signed it; the system executed it.
- **Maintainability.** Trees drift — a new surgeon joins, a new imaging modality appears, a referral pattern shifts. The generator isn't a one-shot; re-running a single layer (e.g., re-inducing one branch) must be cheap, and edits must re-trigger validation.
- **Template / packet reuse (the flywheel, held honestly).** A validated "peripheral nerve packet" seeds the next clinic's draft, which the local surgeon then validates and forks. This compounds — your version of an incumbent's data moat, but built from *structured, validated clinical reasoning* rather than raw interaction logs. Two honest caveats: it's **back-loaded** (helps at scale, not with customer #1), and it depends on **how transferable clinical logic actually is across clinics** — an assumption to *test*, not assume (see Risk R4). Validation on every fork is what stops the flywheel from propagating an early mistake to everyone downstream.

---

## 8. Open design questions / risks (resolve these with cofounders)

- **R1 — Synthetic case quality is the real bottleneck.** Layer 2's entire output depends on cases rich enough to expose real thresholds. *Who authors them, and how do we verify clinical richness?* Options: surgeon-reviewed generated cases, or seed from de-identified real referrals. This deserves more attention than the induction algorithm.
- **R2 — Workup structure: model (b) vs. (c).** Start with conditioned-leaf workup (b). Watch for subspecialties where workup genuinely needs to branch mid-tree; only then invest in (c).
- **R3 — Over-ordering safety.** The asymmetric cost of under- vs. over-ordering must be a first-class concept in elicitation, gap detection, and validation — not a footnote. Conservative default = escalate to surgeon when uncertain.
- **R4 — Transferability assumption.** The template flywheel (and the scaling story) rests on clinical logic being reusable across clinics. Test it cheaply: have several surgeons react to the same draft tree and measure how much they change. Barely change → powerful network effect. Rewrite half → weaker, and you want to know now.
- **R5 — The authorship/automation line.** Every increment of automation that removes surgeon decisions moves you toward being an auto-configuration engine and away from your moat. The guardrail: the surgeon must make real decisions (Layer 2) and resolve real gaps (Layer 3) — those are non-removable, by design, even when it would be "faster" to skip them.
- **R6 — Who authors a department tree?** A lead surgeon? A committee? This affects reconciliation, sign-off, and liability. Decide before the first hospital deployment.

---

## 9. Suggested build sequence

1. **Lock the dual-output schema** (routing + conditioned workup + escalation). Everything reads it.
2. **Layer 2 first, thin** — case-routing + workup capture on a handful of hand-written cases, feeding a rule-based partitioner. This is the load-bearing, highest-risk stage; prove it early.
3. **Layer 3 validation harness** — reuse the downstream engine to score a draft; get the two-axis accuracy metric working. This is your proof engine *and* your internal QA; build it before you scale case volume.
4. **Layer 1 highlight game + case generation** — surface vocabulary and produce the case stream at quality (invest here per R1).
5. **Gap detection** — the interrogation checks, dual-axis, including over-ordering flags.
6. **Hospital-ready wrap** — reconciliation, sign-off/versioning, maintainability, templates.

Deterministic, testable parts first; the elicitation UX and case quality (the genuinely hard parts) get the most iteration.

---

## 10. The throughline

The generator's real job is **elicitation, not data entry** — and now, elicitation of *two coupled clinical judgments at once*: where the patient goes, and what they need before they arrive. Get that right and you've built the thing that (a) makes surgeon-authored trees fast enough to beat a breadth platform's setup speed, (b) produces a proof metric that closes your credibility gap, and (c) keeps the surgeon in the authoring seat — which is the one thing that keeps this a moat instead of a knockoff. Routing gets you parity; the workup axis, elicited and validated to real depth, is what makes the first surgical visit productive — and that's the outcome nobody else produces.
