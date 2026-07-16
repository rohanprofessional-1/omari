# Sprout — the Builder's AI Assistant

**Status: BUILT (2026-07-03), uncommitted on branch `shivank`.**

Sprout is the conversational assistant embedded in the Builder tab. A clinician
talks to it to edit the open decision tree ("reroute left-sided patients to
Dr. Gooch and add an EMG to his workup") or to interrogate it ("which paths
reach Dr. Chen?"). It replaces box-dragging with sentences — without ever
becoming a clinical author.

This document covers the entire system: the invariant it protects, the
architecture, every feature, the file map, and what was deliberately deferred.

---

## 1. The invariant: scribe, never author

Everything in Omari rests on one claim: **the tree is clinician-authored and
auditable; deterministic code routes, LLMs only read/extract/phrase.** A
conversational editor is the closest the product has ever come to that line,
so Sprout's design holds a bright rule:

> Sprout supplies the **mechanics** — translation, navigation, diffs,
> previews, impact analysis, gap-surfacing. The clinician supplies **every
> clinical decision** — which specialist, what urgency, what workup, what
> thresholds, how patients branch.

Concretely, Sprout has four modes, chosen per turn:

| Mode | When | Example |
|---|---|---|
| `propose` | The clinician stated a concrete edit | "add a below-knee branch routing to Dr. Chen" → drafted operations + diff |
| `clarify` | The instruction is missing a *clinical* decision | "add a node for diabetic patients" → "routed where, with what workup?" |
| `decline` | The clinician asked Sprout to make a clinical judgment | "what workup should cubital tunnel get?" → "that call is yours — tell me and I'll draft it" |
| `answer` | A question about the tree as it stands | "which buckets are unwired?" → answered from the tree JSON only |

The decline rule is absolute: Sprout never fills a routing target, workup item,
or cutoff from medical knowledge, even partially, even when scoped to a
selection. Structural blanks (an unwired bucket, an empty workup on a new
node) are fine to leave; clinical blanks are never filled with defaults.

### How the invariant is enforced (not just intended)

1. **Bounded operations, not tree JSON.** The LLM never writes a tree. It
   emits a list of 19 typed operations (see §4). A pure, deterministic applier
   turns them into a candidate tree — all-or-nothing.
2. **Propose → diff → confirm.** The backend endpoint is stateless and returns
   *proposals only*. Nothing touches the canvas until the clinician reviews
   the exact diff and clicks Apply. Dismissing a proposal changes nothing.
3. **Zod is the gate.** Operations are validated by `TreeOpSchema`
   (discriminated union) and the applied result must pass `TreeSchema` — the
   same hard gate as manual save. Invalid proposals are rejected wholesale
   with a chat explanation; the tree is untouched.
4. **Structural test pins** (`backend/tests/test_assistant_confirm_gate.py`),
   in the same spirit as `test_llm_invariant.py`: the response schema is
   pinned to `{mode, message, operations, focusNodeIds}` (no applied-tree
   field, no auto-apply flag, closed mode enum), and the assistant router is
   asserted to have **no database dependency** — if someone wires persistence
   into the endpoint, a test fails first. Note the deliberate contrast with
   the generator invariant tests: Sprout's ops *do* carry clinical fields
   (specialistName, urgency, workup) because the clinician states them in
   chat and the model transcribes — what keeps authorship is the confirm
   gate, so that is what the tests pin.
5. **Canvas-only application.** Apply mutates the canvas, never the library.
   Persisting still goes through the manual "Save to library" flow with its
   own validation.

---

## 2. Architecture overview

```
┌─ Builder.tsx ──────────────────────────────────────────────────────┐
│  canvas (React Flow)         ┌─ BuilderChatPanel.tsx ────────────┐ │
│  · multi-select → scope      │  chat thread                      │ │
│  · assistantFocus highlight  │  · welcome hero + suggestions     │ │
│  · proposal preview (ghosts) │  · proposal cards (diff/impact)   │ │
│  · "Ask Sprout" launcher     │  · gap-fix mode · step-through    │ │
│  · applyAssistantTree        │  · composer + scope chip          │ │
└──────────────┬───────────────┴──────────────┬────────────────────┘ │
               │ getTree / onApply / onPreview / onFocusNodes        │
               ▼                                                     │
  lib/assistant/  ops.ts (Zod ops + applier)   diff.ts (clinical diff)
                  impact.ts (routing impact)   gaps.ts (gap detector)
                  api.ts (client)
               │
               ▼  POST /api/v1/assistant/tree-chat   (stateless, no DB)
  backend: api/v1/assistant.py → services/anthropic.py::tree_chat()
           (forced tool-use, temp 0, per-op JSON schemas)
```

**Division of labor.** The LLM does exactly two things: chooses a mode +
message, and (for proposals) emits operations referencing node ids. All
validation, application, diffing, impact analysis, gap detection, previewing,
and highlighting are deterministic TypeScript in the browser — consistent with
the repo-wide D3 decision (deterministic tree logic is pure TS importing the
real engine-adjacent modules, no Python port).

**Statelessness.** Conversation history lives in the panel's React state and
is replayed (last 12 turns) with each request. The backend holds nothing; the
database is never touched. No streaming — single `messages.create` awaits,
matching every other LLM call in the app.

---

## 3. Backend

### Endpoint — `POST /api/v1/assistant/tree-chat`

`backend/app/api/v1/assistant.py`, router prefix `/assistant`, registered in
`app/main.py`. Deliberately import-clean: no `get_db`, no models, no session.

Request (`backend/app/schemas/assistant.py::TreeChatRequest`):

```
tree:            dict         # full frontend Tree JSON (camelCase), read-only context
message:         str          # the clinician's latest turn
history:         [{role, content}]   # prior turns, client-supplied
warnings:        [str]        # current validateTreeGraph warnings (for gap questions)
selectedNodeIds: [str]        # canvas selection — scopes "these"/"this"
```

Response (`TreeChatResponse`):

```
mode:         'answer' | 'clarify' | 'propose' | 'decline'
message:      str            # the chat reply (plain text, no markdown)
operations:   [dict]         # proposals only; stripped server-side unless mode='propose'
focusNodeIds: [str]          # presentation-only: nodes the reply refers to
```

### LLM job — `AnthropicService.tree_chat()`

`backend/app/services/anthropic.py`. Follows the established house pattern:
forced tool-use (`tool_choice` on `tree_chat_turn`,
`disable_parallel_tool_use`), temperature 0, tree JSON compact-serialized into
the final user turn (60k char cap), history merged defensively for role
alternation.

The tool's `operations` items schema is a full JSON-Schema `anyOf` over all 19
ops (`_TREE_CHAT_OP_ITEMS`, built by the `_op()` helper from shared `_COND` /
`_KEYED_COND` / `_WORKUP_ITEM` / `_BRANCH` fragments). This mirrors the
frontend Zod union — which remains the authoritative gate — and exists so the
model can't improvise field shapes. (Empirically necessary: before this, the
model emitted `item: "EMG/NCS"` where the contract wants `item: {name}`; the
Zod gate rejected it safely but cost the clinician a retry.)

### System prompt (`TREE_CHAT_SYSTEM`) — the behavioral contract

Key sections, in order:

- **Identity**: "You are Sprout… a scribe and a navigator — NEVER a clinical
  author," with a self-description for "who are you?" questions.
- **THE HARD RULE**: every clinical decision belongs to the clinician; Sprout
  only transcribes decisions stated in the conversation.
- **The four modes** with per-mode message discipline (propose = ONE sentence,
  the app shows the diff; clarify = only the missing decisions, one short
  question per line, max three, no preamble; decline = 1–2 sentences, no
  apologies or lectures; answer = from the tree JSON only).
- **FOLLOW-THROUGH**: when Sprout's previous turn asked about a specific node
  or gap, the clinician's next message answers it — draft for *that* node,
  don't re-ask. (Added after live testing showed re-asking during gap fixing.)
- **BRAIN-DUMPS**: messages may be long, rambling dictation (voice input) —
  extract EVERY edit actually stated and draft them as one ordered proposal,
  ignoring filler; clarify only genuinely missing clinical decisions, never
  one question per sentence of rambling.
- **Operations mechanics**: exact ids from the tree JSON; placeholder ids
  (`new_1`) for additions, referenced by later ops; branches located by
  `branchLabel` or `branchIndex`.
- **LAYOUT**: rearranging the canvas is box-dragging, not a clinical decision —
  propose `move_nodes` directly (exact ids + one placement edge), never paired
  with unasked-for ops; requests beyond edge-parking get pointed at dragging
  or Auto-layout.
- **focusNodeIds**: whenever the message refers to specific nodes, list their
  ids so the app can highlight them; existing ids only; empty otherwise.
- **SELECTION** (injected per-request): the selected node ids, with "'these'
  refers to them; scope to the selection; no need to ask which nodes."
- **VOICE**: plain text only, never markdown; lead with the point, 1–3 short
  sentences; no preambles, no closing filler, no exclamation marks; "a sharp
  colleague, not a chatbot."

### Tests — `backend/tests/test_assistant_confirm_gate.py`

- `test_response_carries_proposals_only` — response fields pinned exactly.
- `test_modes_include_no_auto_apply` — mode enum pinned closed.
- `test_assistant_endpoint_is_stateless` — router source asserted free of
  `get_db` / `AsyncSession` / `app.models`.

---

## 4. The operation contract (frontend `lib/assistant/ops.ts`)

`TreeOpSchema` — a Zod discriminated union of 19 ops:

| Category | Ops |
|---|---|
| Add nodes | `add_variable`, `add_specialist`, `add_escalation` |
| Update nodes | `update_variable`, `update_specialist`, `update_escalation` |
| Branches | `add_branch`, `update_branch`, `remove_branch` (located by `branchIndex` or `branchLabel`) |
| Structure | `delete_node`, `set_root` |
| Workup (always) | `add_workup_item`, `update_workup_item`, `remove_workup_item` |
| Workup (conditional / guards) | `add_workup_conditional`, `remove_workup_conditional`, `add_workup_guard`, `remove_workup_guard` |
| Layout (canvas-only) | `move_nodes` (node ids + a placement edge: `top` / `bottom` / `left` / `right`) |

**Layout moves** ("move the escalation nodes to the bottom") are box-dragging —
squarely Sprout's job (§13) and never a clinical decision. The op is still
bounded: the model names WHICH nodes and WHICH canvas edge; it never emits
coordinates (the tree JSON carries none). `applyOps` validates every id
(all-or-nothing, aliases resolve so a just-added node can be parked) and
returns the moves separately in `ApplyResult.moves` — the tree itself is
byte-identical, so the clinical diff and routing impact are provably empty.
The proposal card shows a `describeMoves` line instead ("Move Human review to
the bottom of the canvas — layout only, wiring and routing unchanged"), and
the same propose → confirm flow gates it. On Apply, the Builder computes the
geometry deterministically (`applyNodeMoves` → `lib/nodePlacement.ts::
planNodeMoves`), tracking every card's real rectangle (position + measured
size) and the live edge list: each moved card gets a desired spot at the
**barycenter of its wiring** (the classic one-layer crossing-minimisation
heuristic — cards land under/beside the nodes they connect to, so edges run
short and parallel), a sweep enforces minimum gaps so parked cards **never
overlap**, a mean-displacement shift keeps the run centred on its wiring, and
the whole row/column parks with clearance beyond the graph's bounding box.
Edge paths are routed by React Flow from their endpoint nodes, so untangled
lines fall out of good node positions. A layout-only apply skips the
auto-layout pass so every other card keeps its position; a mixed proposal
tidies first, then parks the moved cards. Like a manual drag, positions live
on the canvas only (auto-layout or reload re-tidies) — requests beyond
edge-parking (exact coordinates, alignment) get pointed at dragging or the
Auto-layout button.

Leniencies at the boundary (tolerate, then normalize): a bare string workup
item coerces to `{name}` (`WorkupItemInputSchema`); branch `nextNodeId` may be
omitted (unwired); conditions reuse the canonical `ConditionSchema` /
`KeyedConditionSchema` from `types/tree.ts`.

### `applyOps(tree, ops) → {ok, tree, errors, addedIds, changedIds}`

Pure and deterministic:

- Input tree is `TreeSchema.parse`d first (normalizes legacy v1 flat workup
  arrays) and deep-copied — the input is never mutated.
- **All-or-nothing**: any error (unknown node, wrong node type, ambiguous
  branch label, missing workup item) rejects the whole proposal; partial
  application never leaks.
- **Placeholder id aliasing**: `add_*` ops may request an id (e.g. `new_1`);
  colliding/missing ids are regenerated via `newNodeId()` and an alias map
  resolves later references. Requested ids that collide with existing nodes
  are aliased to the *new* node (the model meant the node it just created).
- **Branch resolution**: exact label match wins; word-prefix match is the
  fallback ("EMG normal" finds "EMG normal → diagnostics"); ambiguity errors.
- `delete_node` unwires any bucket pointing at the deleted node (keeping the
  bucket) — matching the Builder's manual-delete behavior.
- The result must pass `TreeSchema` or the proposal is rejected.

Tests: `ops.test.ts` — 11 self-asserting checks (alias resolution,
label-located reroute + clinical diff, delete-unwire, workup add/conditional/
guard/remove with case-insensitive matching, all-or-nothing rejection,
wrong-type and ambiguity errors, collision regeneration, input immutability,
Zod boundary rejection).

---

## 5. Deterministic analysis layers

All computed in the browser per proposal/turn; the LLM never phrases any of it.

### Clinical-consequence diff — `lib/assistant/diff.ts`

`diffTrees(before, after) → DiffEntry[]` where each entry is
`{kind: add|remove|change, text}` stating the **clinical consequence**, not
the mechanics: *"Patients answering 'Left' on 'symptom_side' now go to
Dr. Gooch (was Dr. Chen)"*, *"Patients reaching Dr. Chen now get MRI with
contrast before the visit"*, *"Do NOT order CT myelogram unless emg_status =
inconclusive"*. Covers node adds/removes, renames, prompt/dataSource changes,
branch-level changes (label, condition via `describeCondition`, retarget),
urgency, workup always/conditional/guard deltas, and root changes. This is
what makes "confirm" a real clinical review instead of a reflexive click.

### Routing impact ("simulate the change") — `lib/assistant/impact.ts`

`diffRouting(before, after)` enumerates **every root→destination decision
path** in both trees (`enumerateRoutes`: DFS over branch wiring, per-path
cycle guard, 400-path safety cap with a `truncated` flag) and diffs
destinations by path signature (`"symptom_side: Left → duration: Chronic"`).
Output: `changed` (same path, new destination — with from/to), `added`,
`removed`, `totalAfter`. Every proposal card renders this as a **Routing
impact** section: "1 of 3 paths change destination …", or the equally
important "No patient paths change destination (12 paths checked)". Path-level
rather than patient-case-level: Builder trees aren't linked to generator
session cases yet — if they ever are, running decided cases through the
candidate tree via the real engine is the natural upgrade.

### Gap detection — `lib/assistant/gaps.ts`

`detectBuilderGaps(tree) → BuilderGap[]` where each gap is
`{id, nodeIds, question}` — a stable id (so skips persist across recomputes),
the nodes to highlight, and a deterministic template question. Five kinds:

1. **Dangling bucket** — a branch with no/unknown destination.
2. **Bucket-less variable** — a decision that can't route anyone.
3. **Dead-end paths** — a reachable variable from which no specialist or
   escalation is reachable.
4. **Unreachable node** — wired to nothing from the start.
5. **Reachable specialist with no pre-visit workup** (always AND conditional
   both empty) — the "first visit starts from scratch" gap. Its question
   explicitly says *"Saying 'nothing' is a fine answer"* — the clinician
   deciding "no workup" is a decision, not a gap.

Tests: `impact.test.ts` — 6 checks across both modules (clean diff, retarget
from/to, unwired-path detection, cycle termination, multi-gap detection with
the unreachable-specialist-gets-no-workup-gap subtlety, clean-tree zero-gaps).

---

## 6. The chat panel (`components/BuilderChatPanel.tsx`)

### Identity & welcome

- **Logo**: `src/assets/sprout-logo.png` — the white leaf mark. The original
  navy background was pixel-remapped to the app's `--color-accent-strong`
  (#1e3a8a) so it blends with primary buttons. Used in the launcher, the
  panel header badge, and the welcome hero.
- **Launcher**: a floating **"Ask Sprout"** pill, bottom-right of the canvas
  (the universal AI-assistant position), `bg-accent-strong`, logo + label,
  hover lift. Hidden while the panel is open. (Replaced an earlier toolbar
  button that read as "another layout action.")
- **Welcome hero** (Anaconda-Toolbox-style): shown while the thread is empty —
  large logo badge, "Sprout", "AI ASSISTANT FOR THE TREE BUILDER" in small caps,
  the intro ("I can explain any part of this tree, or make edits you approve
  before they go live. You decide the medicine; I handle the busywork."),
  three starter prompts as stacked buttons, and — when the tree has gaps — an
  amber "Fix N gaps step-by-step" button. The hero disappears at the first
  message; the compact identity (small badge + "You approve every change")
  moves into the header.

### Voice input (click-to-talk)

A mic button beside Send uses the browser's SpeechRecognition (Chrome's
`webkitSpeechRecognition`; the button hides where unsupported). Click to
start: the live transcript — interim results included — streams into the
composer; click again (or hit Send) to stop. Deliberately **not auto-sent**:
speech-to-text mangles clinical terms often enough that the transcript lands
in the composer for a quick review/fix, keeping the clinician's words the
thing Sprout acts on. Recording state is unmistakable (pulsing red mic +
"Listening…" hint), the mic stops on unmount, and a denied-permission error
gets a chat hint. A BRAIN-DUMPS prompt rule pairs with this: long rambling
dictation is distilled into one ordered proposal covering every stated edit
(which then benefits from plan numbering + step-through), with clarifies only
for genuinely missing clinical decisions. No audio ever leaves the browser
for Omari's backend (Chrome's recognizer does its own server-side STT).

### Message rendering

- Bubbles mirror the Runner's chat language (`.omari-msg` animation,
  rounded-2xl with a corner notch; user = accent-strong, assistant = bordered
  bg). Typing indicator = the Runner's three bouncing dots.
- `FormattedText`: a tiny renderer (no markdown engine) — paragraphs on blank
  lines, list-style lines get a muted marker, `**bold**` renders as real bold.
  Purely a safety net; the VOICE rules forbid markdown at the source.

### The proposal card — the confirm gate's UI

For each `propose` turn that survives validation:

- Header: "N proposed changes", or for ≥3 ops **"Plan — N changes in K steps"**
  with numbered entries.
- The clinical-consequence diff list (+/−/~ marks).
- The **Routing impact** section (§5).
- A **"This would introduce:"** amber block listing *new* `validateTreeGraph`
  warnings the change creates (delta vs. current warnings).
- Buttons: **Apply changes / Apply all**, **Step through** (plans only),
  **Preview on canvas**, **Dismiss**.
- Terminal states rendered on the card: applied ✓ / dismissed / stale /
  stopped ("applied K of N steps").

**Staleness guard.** Proposals capture the tree JSON at proposal time. At
Apply, if the canvas changed since (manual edits, another proposal), the ops
are re-run against the *current* tree and applied only if the resulting diff
is byte-identical to what the clinician reviewed — otherwise the card goes
stale with an explanation. The review always covers exactly what lands.

**Failure honesty.** Ops that fail the Zod gate or the applier produce a chat
message ("that draft didn't pass validation, so nothing was changed — try
rephrasing, ideally naming the exact node") — never a partial application.

### Step-through (multi-op plans)

For ≥3-op proposals, **Step through** reviews one operation at a time: each
step's diff is computed against the **live tree at that moment** (so step 3
reflects steps 1–2 having landed), with **Apply step / Skip step / Stop**.
Each step goes through the same all-or-nothing applier; a step depending on a
skipped one fails cleanly ("Step 4 couldn't apply: … Skip it or stop."). This
is how "substantial edits, faster" stays auditable — a big request never
collapses into one opaque mutation.

### Guided gap fixing

Entry: the amber button (hero and/or above the composer whenever
`detectBuilderGaps` finds anything). The loop:

1. Sprout posts the next gap's question ("2 to go — The 'Both' bucket on
   'symptom_side' has no destination. Where should those patients go?") and
   highlights the node(s) on canvas.
2. The clinician answers in plain words. The panel routes the gap's `nodeIds`
   through the `selectedNodeIds` scoping channel, so the model targets the
   right node without re-asking (belt: the FOLLOW-THROUGH prompt rule).
3. The answer becomes a normal proposal → diff → confirm.
4. On apply, the gap list is **recomputed** (one fix can resolve several) and
   the next gap is presented. **Skip** (sticky per gap id) and **Stop**
   controls sit above the composer throughout.
5. When nothing remains: "That's every gap resolved — the tree is
   structurally clean."

Detection and phrasing are deterministic; Sprout relays and transcribes. The
clinician supplies every decision, including "nothing".

### Selection scoping ("select, then talk")

The single hardest problem for a tree chatbot is **reference ambiguity** —
"add an EMG to Dr. Reyes's workup" when Dr. Reyes has two nodes. Selection
kills it:

- **Multi-select** on the canvas: shift-click nodes or shift-drag a box
  (React Flow's native selection). Shift-click deliberately does *not* open
  the editor panel.
- An **"Editing: N nodes"** chip appears above the composer naming the
  selected nodes, with an × that clears the canvas selection — the scope is
  never a mystery.
- `selectedNodeIds` rides along with every message; the SELECTION prompt
  section makes "these" exact.
- **Context-aware suggestion chips** follow the selection: one specialist →
  "Add … to this workup" / "Change urgency to …" / "Which paths reach this
  node?"; ≥2 specialists → "What distinguishes these specialists?" /
  "Reroute paths from these to Dr. …"; one variable → "Add a bucket for …" /
  "Which buckets here are unwired?"; mixed → "What do these nodes do?" /
  "Delete these nodes". Chips pre-fill the composer; the clinician finishes
  the sentence (and thereby supplies the clinical content).

Verified live: the exact message that previously forced "which of the two
Dr. Reyes nodes?" returns a directly-scoped one-op proposal when a node is
selected.

---

## 7. Canvas integration (`pages/Builder.tsx`)

### Reply → canvas highlighting (`focusNodeIds`)

Every response carries `focusNodeIds` (required in the tool schema,
presentation-only, invalid ids dropped client-side). When a reply lands,
`focusAssistantNodes`:

1. **Expands** any collapsed ancestors hiding the referenced nodes (reverse
   BFS to the root),
2. **Isolates** them via the existing focus/dim system — referenced cards stay
   full-color, everything else dims (same visual language as the Path
   Explorer's trace), edges *between* referenced nodes highlight too,
3. **Frames** them (`fitView`, reduced-motion aware).

So "Dr. Reyes has two nodes — which one?" lights up both cards as you read it.
The highlight is a new `assistantFocus` state slotted into the focus
precedence (hover > assistantFocus > traced destination > selection) and is
cleared by any canvas click, node/edge selection, tracing, dismissing a
proposal, closing the panel, or loading another tree. Proposals under review
highlight the nodes they'd touch; Apply highlights what just changed.

### Proposal preview — the visual diff

"Preview on canvas" renders the **candidate tree on the real canvas** without
applying it:

- Added/changed nodes: dashed **blue** outline (`.omari-node-ghost`).
- Nodes the proposal would delete: kept visible, faded, dashed **red**
  (`.omari-node-removed`).
- Collapsed ancestors of affected nodes auto-expand; the layout re-tidies.
- A top-center banner: "Previewing Sprout's proposal — nothing is applied,
  editing is paused", with Exit.
- **The canvas is locked**: `nodesDraggable` / `nodesConnectable` /
  `elementsSelectable` off, node-adding guarded, and **Save to library is
  blocked** with an explicit message — a preview can never be edited or
  persisted by accident.
- A snapshot (`previewSnapshotRef`: nodes, collapse set, root) restores the
  real tree exactly on exit. Critically, `getAssistantTree()` returns the
  **snapshot** during a preview, so any new proposal is computed against
  reality, never against the ghost.
- Apply-while-previewing restores the snapshot first, then commits — surviving
  nodes keep their true positions and no ghost styling leaks.

### Applying a confirmed proposal (`applyAssistantTree`)

Surviving nodes keep their positions/measurements; new nodes are placed by the
next layout pass (ELK, Dagre fallback); collapsed ancestors of affected nodes
expand so every approved change is visible; stale selections/traces clear; the
changed nodes light up. Canvas-only — the library is untouched until a manual
save, and the apply confirmation reminds the clinician to save and to
re-validate a previously-validated tree.

---

## 8. Voice

The system prompt's VOICE section is the product decision that Sprout is a
working tool, not a chat toy:

- Plain text only — never markdown (the UI has a rendering safety net anyway).
- Lead with the point; 1–3 short sentences for most turns.
- No preambles ("Happy to help!"), no closing filler ("Just let me know…"),
  no exclamation marks, no restating the clinician's request.
- Proposals: one sentence — the diff card carries the detail.
- Clarifies: just the missing decisions, one per line, max three.

Before/after, from live testing: *"Happy to add that node! I just need a
couple of clinical details from you: 1. \*\*Where should it connect…\*\*"*
became *"A few things I need to wire this correctly:"* followed by three
clean one-line questions.

---

## 9. File map

**Backend**
| File | Role |
|---|---|
| `backend/app/api/v1/assistant.py` | `/assistant/tree-chat` router — stateless, DB-free |
| `backend/app/schemas/assistant.py` | `TreeChatRequest` / `TreeChatResponse` (the pinned confirm-gate shape) |
| `backend/app/services/anthropic.py` | `TREE_CHAT_SYSTEM`, `TREE_CHAT_TOOL`, `_TREE_CHAT_OP_ITEMS`, `tree_chat()` |
| `backend/app/main.py` | router registration |
| `backend/tests/test_assistant_confirm_gate.py` | structural pins (3 tests) |

**Frontend**
| File | Role |
|---|---|
| `frontend/src/lib/assistant/ops.ts` | `TreeOpSchema` (19 ops, authoritative gate) + `applyOps` |
| `frontend/src/lib/assistant/diff.ts` | clinical-consequence diff |
| `frontend/src/lib/assistant/impact.ts` | path enumeration + routing impact |
| `frontend/src/lib/assistant/gaps.ts` | deterministic gap detector + template questions |
| `frontend/src/lib/assistant/api.ts` | typed client for the endpoint |
| `frontend/src/lib/nodePlacement.ts` | pure placement planner for layout moves (barycenter ordering + overlap sweep); tested in `nodePlacement.test.ts` |
| `frontend/src/components/BuilderChatPanel.tsx` | the panel: hero, thread, proposal cards, gap mode, stepper, scope chip, composer, voice input |
| `frontend/src/pages/Builder.tsx` | launcher, `assistantFocus` highlighting, preview machinery, apply, selection plumbing |
| `frontend/src/assets/sprout-logo.png` | the leaf mark, recolored to accent-strong |
| `frontend/src/index.css` | `.omari-node-ghost` / `.omari-node-removed` preview styles |
| `frontend/src/lib/assistant/ops.test.ts` | 11 applier checks |
| `frontend/src/lib/assistant/impact.test.ts` | 6 impact/gap checks |
| `frontend/scripts/run-tests.mjs` | both test files registered |

---

## 10. Testing & verification

- **Frontend** (`npm test`, self-asserting style, no framework): 11 applier
  checks + 6 impact/gap checks, alongside the existing engine/workup/
  generator/orchestrator suites.
- **Backend** (`docker compose exec backend python -m pytest tests -q`):
  3 confirm-gate pins alongside the existing invariant/generator tests.
- **Live-verified flows** (against the running FastAPI + real Anthropic):
  stated edit → clean scoped ops; clinical-judgment ask → decline; ambiguous
  instruction → clarify naming both candidate nodes *with their ids in
  `focusNodeIds`*; the "both" follow-up → two-op proposal; selection scoping
  removing a previously-forced clarify; a gap-flow answer ("EMG and a wrist
  ultrasound") → direct two-op proposal on the gap's node.

---

## 11. The completion pass (2026-07-08)

Six upgrades that closed the half-open loops:

- **Undo for applied proposals.** Apply records the resulting tree JSON
  (`appliedJson`); applied cards get an Undo button that restores the exact
  before-tree — but ONLY while the canvas still matches what Apply produced
  (the staleness guard pointed the other way). Otherwise Sprout explains and
  refuses. New status: `undone`.
- **Save-in-place.** `PUT /trees/{id}/full` (`update_tree_full` in trees.py,
  sharing `_insert_tree_nodes` with create) replaces the draft rows of the
  SAME tree row and bumps `version`; published `tree_versions` snapshots are
  untouched. The Save popover now leads with "Update “<name>”" when a library
  tree is open, with "save a copy as" beneath — the edit → save loop no longer
  spawns near-duplicates.
- **Conversation persistence.** Threads persist to localStorage per tree
  (`omari:sproutThread:<treeId>`, last 50 messages; the panel remounts via a
  React key when the open tree changes so threads never cross). The stored
  thread doubles as a change log — applied proposals keep their instruction,
  diff, and outcome. Mid-flight step-throughs freeze to `stopped` on restore;
  restored pending proposals are protected by the staleness guard. A trash
  icon in the header clears the thread.
- **Retry / redraft.** `send` was refactored into `sendText(text)`; failed
  turns carry their instruction and render a ↻ Retry button; stale and
  dismissed proposal cards carry ↻ Redraft, which re-sends the original
  instruction (`sourceText`) against the current tree.
- **Streaming (SSE).** `POST /assistant/tree-chat/stream` streams the reply:
  the backend extracts the `message` field incrementally from the partial
  tool-call JSON (`_extract_streaming_message` — escape-aware, chunk-safe) and
  emits `delta` events, then one `done` event with the exact non-streaming
  payload. The panel renders deltas into a placeholder bubble that the final
  payload upgrades in place (proposal card and all); any stream failure falls
  back to the non-streaming endpoint. Streaming changes latency, not
  authority — the confirm gate is identical.
- **The bright-line eval** (`frontend/eval/sprout-eval.mjs`, `npm run
  eval:sprout`). Thirteen canned prompts against the live endpoint asserting
  MODES and op targets: four decline probes (workup choice, specialist
  choice, threshold blessing, medical knowledge) plus the critical
  "scoped selection must NOT weaken the line" probe; stated-edit proposes
  (including selection-scoped disambiguation); underspecified and
  ambiguous-reference clarifies (with focusNodeIds pointing at both
  candidates); a read answer; and the follow-through "both" resolution.
  Spends real tokens, so it's a separate script from `npm test` — run it
  after ANY edit to `TREE_CHAT_SYSTEM`.

## 12. Remaining deferrals & known limits

- **No `audit_log` table** (deferred project-wide); the persisted thread is
  the interim change record.
- **No automatic re-validation**: applying edits stales any prior
  "N% agreement" metric; the apply message reminds the clinician.
- **Impact is path-level, not patient-level**: linking Builder trees to
  generator-session cases would enable "this moves 4 of your 12 test patients
  to Dr. Chen" via the real engine.
- **No hover-a-message-to-highlight** (auto-focus on reply arrival covers the
  need for now).
- **Extending Sprout safely**: any new capability must keep — ops
  proposals-only server-side; the Zod gate + all-or-nothing applier
  client-side; diff review before apply; and the decline rule (mechanics from
  Sprout, clinical decisions from the clinician) — including inside scoped
  selections and guided flows, where the temptation to "just fill it in" is
  strongest.

---

## 13. The test to apply to every future feature

If Sprout went silent mid-session, would a **clinical decision** go unmade
(forbidden — that means Sprout was making it), or just some **typing and
box-dragging** go undone (fine — that's the job)? Every capability above sits
on the typing-and-box-dragging side. Keep it that way.
