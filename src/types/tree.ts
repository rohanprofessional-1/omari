import { z } from 'zod'

/**
 * Blume — shared decision-tree schema.
 *
 * This file is the SINGLE SOURCE OF TRUTH for the routing contract:
 * the builder writes trees that match these schemas, and the deterministic
 * engine reads them. Validate everything with Zod; import these types
 * everywhere. The deterministic engine — never an LLM — makes routing
 * decisions. The LLM only extracts information and phrases questions.
 */

/* -------------------------------------------------------------------------- */
/* Condition                                                                  */
/* -------------------------------------------------------------------------- */

/** A scalar a condition can compare against. */
export const ConditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
])
export type ConditionValue = z.infer<typeof ConditionValueSchema>

/** Exact-match condition: the variable equals `value`. */
export const EqualsConditionSchema = z.object({
  op: z.literal('equals'),
  value: ConditionValueSchema,
})
export type EqualsCondition = z.infer<typeof EqualsConditionSchema>

/** Numeric-range condition. Both bounds optional; min inclusive, max inclusive. */
export const RangeConditionSchema = z.object({
  op: z.literal('range'),
  min: z.number().optional(),
  max: z.number().optional(),
})
export type RangeCondition = z.infer<typeof RangeConditionSchema>

/** Membership condition: the variable is one of `values`. */
export const InConditionSchema = z.object({
  op: z.literal('in'),
  values: z.array(z.string()),
})
export type InCondition = z.infer<typeof InConditionSchema>

export const ConditionSchema = z.discriminatedUnion('op', [
  EqualsConditionSchema,
  RangeConditionSchema,
  InConditionSchema,
])
export type Condition = z.infer<typeof ConditionSchema>

/* -------------------------------------------------------------------------- */
/* Branch                                                                     */
/* -------------------------------------------------------------------------- */

/** A single edge out of a VariableNode: if `condition` holds, go to `nextNodeId`. */
export const BranchSchema = z.object({
  label: z.string(),
  condition: ConditionSchema,
  nextNodeId: z.string(),
})
export type Branch = z.infer<typeof BranchSchema>

/* -------------------------------------------------------------------------- */
/* Nodes                                                                      */
/* -------------------------------------------------------------------------- */

/** Where the value for a variable comes from. */
export const DataSourceSchema = z.enum(['patient', 'referral', 'record'])
export type DataSource = z.infer<typeof DataSourceSchema>

/** Routing urgency assigned at a specialist endpoint. */
export const UrgencySchema = z.enum(['routine', 'expedited', 'urgent'])
export type Urgency = z.infer<typeof UrgencySchema>

/**
 * A decision point. Resolves `variableKey`, then the engine evaluates
 * `branches` in order and follows the first whose condition matches.
 */
export const VariableNodeSchema = z.object({
  id: z.string(),
  type: z.literal('variable'),
  variableKey: z.string(),
  prompt: z.string(),
  dataSource: DataSourceSchema,
  branches: z.array(BranchSchema),
})
export type VariableNode = z.infer<typeof VariableNodeSchema>

/** A single recommended workup item attached to a specialist endpoint. */
export const WorkupItemSchema = z.object({
  name: z.string(),
  protocol: z.string(),
  rationale: z.string(),
})
export type WorkupItem = z.infer<typeof WorkupItemSchema>

/** A terminal node: route the patient to a specialist with urgency and workup. */
export const SpecialistNodeSchema = z.object({
  id: z.string(),
  type: z.literal('specialist'),
  specialistName: z.string(),
  specialty: z.string(),
  urgency: UrgencySchema,
  reasoningTemplate: z.string(),
  workup: z.array(WorkupItemSchema),
})
export type SpecialistNode = z.infer<typeof SpecialistNodeSchema>

/** A terminal node: the tree cannot route automatically; escalate to a human. */
export const EscalationNodeSchema = z.object({
  id: z.string(),
  type: z.literal('escalation'),
  reason: z.string(),
})
export type EscalationNode = z.infer<typeof EscalationNodeSchema>

export const NodeSchema = z.discriminatedUnion('type', [
  VariableNodeSchema,
  SpecialistNodeSchema,
  EscalationNodeSchema,
])
export type Node = z.infer<typeof NodeSchema>

/* -------------------------------------------------------------------------- */
/* Tree                                                                       */
/* -------------------------------------------------------------------------- */

/** A complete routing tree authored by a surgeon. */
export const TreeSchema = z.object({
  treeId: z.string(),
  rootNodeId: z.string(),
  nodes: z.array(NodeSchema),
})
export type Tree = z.infer<typeof TreeSchema>

/* -------------------------------------------------------------------------- */
/* Variable specification                                                     */
/* -------------------------------------------------------------------------- */

/** How a variable is asked, what shape its answer takes, and how to extract it. */
export const AnswerTypeSchema = z.enum([
  'single_choice',
  'number',
  'boolean',
  'text',
])
export type AnswerType = z.infer<typeof AnswerTypeSchema>

/**
 * The definition of a variable referenced by `variableKey` in the tree:
 * the clinical intent, the patient-facing question, its answer shape, and
 * hints the LLM uses to extract a value (the LLM extracts; it never routes).
 */
export const VariableSpecSchema = z.object({
  key: z.string(),
  clinicalPrompt: z.string(),
  patientQuestion: z.string(),
  answerType: AnswerTypeSchema,
  options: z.array(z.string()).optional(),
  extractionHints: z.string(),
})
export type VariableSpec = z.infer<typeof VariableSpecSchema>

/* -------------------------------------------------------------------------- */
/* Filled variables                                                           */
/* -------------------------------------------------------------------------- */

/** A single extracted value plus the extractor's confidence in it (0–1). */
export const FilledVariableSchema = z.object({
  value: z.any(),
  confidence: z.number(),
})
export type FilledVariable = z.infer<typeof FilledVariableSchema>

/** All values gathered for a patient, keyed by variable `key`. */
export const FilledVariablesSchema = z.record(z.string(), FilledVariableSchema)
export type FilledVariables = z.infer<typeof FilledVariablesSchema>
