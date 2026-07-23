import { z } from 'zod'
import {
  ConditionSchema,
  DataSourceSchema,
  KeyedConditionSchema,
  UrgencySchema,
  WorkupItemSchema,
} from '../../types/tree'

/**
 * Blume — clinic delta layer, persisted vocabulary.
 *
 * A delta is a clinic's durable clinical decision expressed against a
 * CPG-generated base tree: "bind this guideline endpoint to Dr. Osei",
 * "our PSA cutoff is 4", "we don't treat pediatric presentations".
 *
 * THE ANCHORING CONTRACT: base-tree node ids are regenerated on every CPG
 * upload (fresh `doc_<uuid>_s<n>_` prefixes), so deltas never persist raw
 * node ids. They anchor semantically — normalized variable keys, hashes of
 * the verbatim CPG text (`clinicalBasis`), condition fingerprints — and the
 * compiler resolves anchors against the *current* base at compile time.
 * A delta whose anchor no longer resolves is surfaced for re-review; it is
 * never silently dropped and never silently misapplied.
 *
 * ANCHORS SEE THE COMPILED-SO-FAR TREE: deltas apply in `seq` order, and each
 * one resolves against the tree with all earlier deltas applied — the same
 * state the author was looking at. So a delta touching a terminal that an
 * earlier delta bound anchors by the BOUND name (e.g. 'Dr. Osei'), not the
 * placeholder label; replay re-runs the whole sequence, so intermediate
 * anchors keep resolving on a regenerated base.
 */

/* -------------------------------------------------------------------------- */
/* Anchors                                                                    */
/* -------------------------------------------------------------------------- */

export const NodeAnchorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('variable'),
    /** Normalized variableKey — `doc_<hex>_s<n>_` prefixes stripped. */
    variableKey: z.string().min(1),
    /** Document name, to disambiguate the same key across grafted CPGs. */
    docScope: z.string().optional(),
  }),
  z.object({
    kind: z.literal('terminal'),
    /** FNV-1a hash of normalized clinicalBasis — strongest anchor; the
     *  verbatim CPG text survives regeneration. */
    clinicalBasisHash: z.string().optional(),
    /** Terminal's name at authoring time (incl. `[Assign specialist — X]`). */
    specialistName: z.string().optional(),
    specialty: z.string().optional(),
    docScope: z.string().optional(),
  }),
  /** Last resort, for hand-built nodes with no semantic identity. Goes
   *  stale the moment the base is regenerated (baseHash mismatch). */
  z.object({
    kind: z.literal('pinned'),
    nodeId: z.string().min(1),
    baseHash: z.string(),
  }),
])
export type NodeAnchor = z.infer<typeof NodeAnchorSchema>

export const BranchAnchorSchema = z.object({
  node: NodeAnchorSchema,
  /** Canonical serialization of the branch condition at authoring time —
   *  primary within-node matcher (see `conditionFingerprint`). */
  conditionFingerprint: z.string().min(1),
  /** Branch label at authoring time — fallback matcher. A label match with
   *  a different fingerprint means the guideline moved → stale_conflict. */
  label: z.string().optional(),
})
export type BranchAnchor = z.infer<typeof BranchAnchorSchema>

/* -------------------------------------------------------------------------- */
/* Provenance                                                                 */
/* -------------------------------------------------------------------------- */

export const ProvenanceSchema = z.object({
  author: z.string().default(''),
  /** Why the clinic made this change. REQUIRED when deviatesFromCpg. */
  rationale: z.string().default(''),
  /** The surgeon's practice contradicts the guideline. First-class and
   *  recorded — never an error. The rendered delta list is the clinic's
   *  deviation register at sign-off. */
  deviatesFromCpg: z.boolean().default(false),
  /** The clinicalBasis text being overridden, captured at authoring time. */
  cpgBasis: z.string().optional(),
  sessionStage: z
    .enum(['mapping', 'thresholds', 'scope', 'workup', 'validation', 'gaps', 'freeform'])
    .optional(),
})
export type Provenance = z.infer<typeof ProvenanceSchema>

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

/** Where a bound terminal routes: a roster specialist, or a safe escalation. */
export const BindTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('specialist'),
    /** `specialists.id` roster reference, when bound from the roster table. */
    specialistId: z.string().optional(),
    specialistName: z.string().min(1),
    specialty: z.string().optional(),
  }),
  z.object({
    kind: z.literal('escalation'),
    reason: z.string().min(1),
  }),
])
export type BindTarget = z.infer<typeof BindTargetSchema>

const SplitBandSchema = z.object({
  label: z.string().min(1),
  patientLabel: z.string().optional(),
  condition: ConditionSchema,
  /** 'same' keeps the original branch's destination; 'sibling' routes to
   *  another existing node (resolved via anchor). */
  target: z.enum(['same', 'sibling']).default('same'),
  siblingTarget: NodeAnchorSchema.optional(),
})

const RuleBranchSchema = z.object({
  label: z.string().min(1),
  patientLabel: z.string().optional(),
  condition: ConditionSchema,
  /** 'continue' → the edge's original destination; 'escalate' → a new
   *  escalation node; 'terminal' → an existing node via anchor. */
  target: z.enum(['continue', 'escalate', 'terminal']),
  escalationReason: z.string().optional(),
  terminalAnchor: NodeAnchorSchema.optional(),
})

export const DeltaOpSchema = z.discriminatedUnion('op', [
  // Bind CPG care-pathway endpoints to a local specialist (or escalation).
  // Bulk by design: many placeholders, one binding.
  z.object({
    op: z.literal('bind_terminal'),
    anchors: z.array(NodeAnchorSchema).min(1),
    target: BindTargetSchema,
  }),
  z.object({
    op: z.literal('set_urgency'),
    anchors: z.array(NodeAnchorSchema).min(1),
    urgency: UrgencySchema,
  }),
  // Concretize a guideline threshold: replace the condition in place, or
  // split one ambiguous branch into ordered bands at the same position.
  z.object({
    op: z.literal('set_threshold'),
    branch: BranchAnchorSchema,
    mode: z.enum(['replace', 'split']),
    replacement: ConditionSchema.optional(),
    split: z.array(SplitBandSchema).min(2).optional(),
    /** Set when the concretization flips the variable's answers from
     *  categorical strings to numbers — flags same-key impact review. */
    answerTypeChange: z.enum(['none', 'string_to_number']).default('none'),
  }),
  z.object({
    op: z.literal('add_workup'),
    anchor: NodeAnchorSchema,
    item: WorkupItemSchema.partial({ protocol: true, rationale: true }),
    /** Present → path-conditioned addition instead of `always`. */
    when: KeyedConditionSchema.optional(),
    reason: z.string().optional(),
  }),
  z.object({
    op: z.literal('remove_workup'),
    anchor: NodeAnchorSchema,
    itemName: z.string().min(1),
    /** Present → add a doNotOrderUnless guard instead of hard removal. */
    guardInstead: KeyedConditionSchema.optional(),
  }),
  // Clinic doesn't handle this pathway: retarget the branch to an escalation
  // carrying the reason. NEVER deletes the branch — removal would silently
  // change which later branch matches (first-match evaluation).
  z.object({
    op: z.literal('suppress_branch'),
    branch: BranchAnchorSchema,
    reason: z.string().min(1),
  }),
  // Subtree/section-level suppression with scope provenance.
  z.object({
    op: z.literal('set_scope'),
    branch: BranchAnchorSchema,
    reason: z.string().min(1),
  }),
  // Structural escape hatch: insert a clinic-specific variable gate on an edge.
  z.object({
    op: z.literal('add_rule'),
    insertAt: BranchAnchorSchema,
    variableKey: z.string().min(1),
    prompt: z.string().min(1),
    dataSource: DataSourceSchema.default('referral'),
    branches: z.array(RuleBranchSchema).min(1),
  }),
  // Branch precedence is clinical logic under first-match evaluation.
  // `order` lists ALL the node's branches (as anchors) in desired order;
  // a branch-set change since authoring stales the delta.
  z.object({
    op: z.literal('reorder_priority'),
    node: NodeAnchorSchema,
    order: z.array(BranchAnchorSchema).min(2),
  }),
  // Copy-only: reword a prompt or patient-facing label. Zero routing impact,
  // kept separate from clinical ops in the review list.
  z.object({
    op: z.literal('reword'),
    node: NodeAnchorSchema.optional(),
    branch: BranchAnchorSchema.optional(),
    prompt: z.string().optional(),
    patientLabel: z.string().optional(),
  }),
])
export type DeltaOp = z.infer<typeof DeltaOpSchema>

/* -------------------------------------------------------------------------- */
/* The persisted delta                                                        */
/* -------------------------------------------------------------------------- */

/** Persisted lifecycle status (compile outcomes live on DeltaResult). */
export const DeltaStatusSchema = z.enum([
  'active',
  'stale_unresolved',
  'stale_ambiguous',
  'stale_conflict',
  'superseded',
  'dismissed',
])
export type DeltaStatus = z.infer<typeof DeltaStatusSchema>

export const DeltaSchema = z.object({
  id: z.string().min(1),
  /** Application order — compile applies strictly ascending. */
  seq: z.number().int().nonnegative(),
  payload: DeltaOpSchema,
  /** Snapshot of the anchored fragment at authoring time, for the
   *  precondition check (did the guideline move underneath us?). */
  expected: z.unknown().optional(),
  provenance: ProvenanceSchema,
  status: DeltaStatusSchema.default('active'),
  /** Hash of the base this delta was authored against. */
  baseHash: z.string().optional(),
})
export type Delta = z.infer<typeof DeltaSchema>

export const DeltasSchema = z.array(DeltaSchema)

/** Outcome of one delta in one compile. Every delta gets exactly one. */
export type DeltaResultStatus =
  | 'applied'
  | 'stale_unresolved'
  | 'stale_ambiguous'
  | 'stale_conflict'
  | 'superseded'
  | 'dismissed'
  | 'error'

export interface DeltaResult {
  deltaId: string
  status: DeltaResultStatus
  /** Human-readable explanation for anything that didn't apply. */
  reason?: string
  /** Real node ids this delta touched or created (this compile only). */
  nodeIds: string[]
}
