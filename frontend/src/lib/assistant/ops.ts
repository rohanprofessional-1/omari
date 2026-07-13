import { z } from 'zod'
import {
  ConditionSchema,
  KeyedConditionSchema,
  TreeSchema,
  WorkupItemSchema,
  emptyWorkupSpec,
  type Node as TreeNode,
  type Tree,
  type VariableNode,
  type WorkupItem,
} from '../../types/tree'
import { newNodeId } from '../treeToFlow'

/**
 * Blume — Builder assistant tree operations.
 *
 * THE BOUNDED EDIT CONTRACT: the assistant LLM never writes tree JSON. It
 * proposes a list of these operations; `applyOps` (pure, deterministic)
 * applies them to a copy of the tree, all-or-nothing, and the result must
 * pass TreeSchema before the clinician ever sees a diff. The clinician
 * confirms every proposal — the assistant transcribes decisions, it never
 * makes them.
 */

/* -------------------------------------------------------------------------- */
/* Operation schemas                                                          */
/* -------------------------------------------------------------------------- */

/** A branch as the assistant may state it; `nextNodeId` may be omitted (unwired). */
export const BranchInputSchema = z.object({
  label: z.string().min(1),
  patientLabel: z.string().optional(),
  condition: ConditionSchema,
  nextNodeId: z.string().optional(),
})

/** A workup item; a bare test name is tolerated and coerced to {name}. */
const WorkupItemInputSchema = z.union([
  WorkupItemSchema.partial({ protocol: true, rationale: true }),
  z.string().min(1).transform((name) => ({ name })),
])

/** Locate a branch on a variable node by index or (exact-ish) label. */
const branchRef = {
  branchIndex: z.number().int().nonnegative().optional(),
  branchLabel: z.string().optional(),
}

export const TreeOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_variable'),
    id: z.string().optional(),
    variableKey: z.string().min(1),
    prompt: z.string().min(1),
    dataSource: z.enum(['patient', 'referral', 'record']).default('patient'),
    branches: z.array(BranchInputSchema).default([]),
  }),
  z.object({
    op: z.literal('add_specialist'),
    id: z.string().optional(),
    specialistName: z.string().min(1),
    specialty: z.string().default(''),
    urgency: z.enum(['routine', 'expedited', 'urgent']).default('routine'),
    reasoningTemplate: z.string().optional(),
    workup: z.array(WorkupItemInputSchema).default([]),
  }),
  z.object({
    op: z.literal('add_escalation'),
    id: z.string().optional(),
    reason: z.string().min(1),
  }),
  z.object({
    op: z.literal('update_variable'),
    nodeId: z.string(),
    variableKey: z.string().optional(),
    prompt: z.string().optional(),
    dataSource: z.enum(['patient', 'referral', 'record']).optional(),
  }),
  z.object({
    op: z.literal('update_specialist'),
    nodeId: z.string(),
    specialistName: z.string().optional(),
    specialty: z.string().optional(),
    urgency: z.enum(['routine', 'expedited', 'urgent']).optional(),
    reasoningTemplate: z.string().optional(),
  }),
  z.object({
    op: z.literal('update_escalation'),
    nodeId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    op: z.literal('add_branch'),
    nodeId: z.string(),
    branch: BranchInputSchema,
  }),
  z.object({
    op: z.literal('update_branch'),
    nodeId: z.string(),
    ...branchRef,
    label: z.string().optional(),
    patientLabel: z.string().optional(),
    condition: ConditionSchema.optional(),
    nextNodeId: z.string().optional(),
  }),
  z.object({
    op: z.literal('remove_branch'),
    nodeId: z.string(),
    ...branchRef,
  }),
  z.object({
    op: z.literal('delete_node'),
    nodeId: z.string(),
  }),
  z.object({
    op: z.literal('set_root'),
    nodeId: z.string(),
  }),
  z.object({
    op: z.literal('add_workup_item'),
    nodeId: z.string(),
    item: WorkupItemInputSchema,
  }),
  z.object({
    op: z.literal('update_workup_item'),
    nodeId: z.string(),
    name: z.string(),
    newName: z.string().optional(),
    protocol: z.string().optional(),
    rationale: z.string().optional(),
  }),
  z.object({
    op: z.literal('remove_workup_item'),
    nodeId: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal('add_workup_conditional'),
    nodeId: z.string(),
    when: KeyedConditionSchema,
    item: WorkupItemInputSchema,
    reason: z.string().default(''),
  }),
  z.object({
    op: z.literal('remove_workup_conditional'),
    nodeId: z.string(),
    itemName: z.string(),
  }),
  z.object({
    op: z.literal('add_workup_guard'),
    nodeId: z.string(),
    item: z.string(),
    requiredCondition: KeyedConditionSchema,
  }),
  z.object({
    op: z.literal('remove_workup_guard'),
    nodeId: z.string(),
    itemName: z.string(),
  }),
  // Layout-only: reposition nodes on the canvas. Never touches tree data or
  // wiring — the model names WHICH nodes and WHERE (a bounded edge), and the
  // Builder computes actual coordinates deterministically.
  z.object({
    op: z.literal('move_nodes'),
    nodeIds: z.array(z.string()).min(1),
    placement: z.enum(['top', 'bottom', 'left', 'right']),
  }),
])
export type TreeOp = z.infer<typeof TreeOpSchema>
export const TreeOpsSchema = z.array(TreeOpSchema).min(1)

/** A confirmed layout move for the Builder to execute (real ids, post-alias). */
export interface NodeMove {
  nodeIds: string[]
  placement: 'top' | 'bottom' | 'left' | 'right'
}

/* -------------------------------------------------------------------------- */
/* Applier                                                                    */
/* -------------------------------------------------------------------------- */

export interface ApplyResult {
  ok: boolean
  tree: Tree
  errors: string[]
  /** Real ids of nodes the ops added (post alias-resolution). */
  addedIds: string[]
  /** Real ids of existing nodes the ops touched. */
  changedIds: string[]
  /** Canvas-layout moves (validated ids) — tree data is never affected. */
  moves: NodeMove[]
}

function fullItem(item: { name: string; protocol?: string; rationale?: string }): WorkupItem {
  return { name: item.name, protocol: item.protocol ?? '', rationale: item.rationale ?? '' }
}

/**
 * Apply a validated op list to a tree, all-or-nothing. Pure — never mutates
 * the input. New-node ids the assistant invented (e.g. "new_1") are replaced
 * with real generated ids; later ops referencing the invented id resolve
 * through an alias map. Any error rejects the WHOLE proposal.
 */
export function applyOps(inputTree: Tree, ops: TreeOp[]): ApplyResult {
  // Normalize (v1 workup arrays → WorkupSpec) and deep-copy in one step.
  const parsed = TreeSchema.safeParse(inputTree)
  if (!parsed.success) {
    return {
      ok: false,
      tree: inputTree,
      errors: [`current tree failed schema validation: ${parsed.error.issues[0]?.message}`],
      addedIds: [],
      changedIds: [],
      moves: [],
    }
  }
  const tree: Tree = JSON.parse(JSON.stringify(parsed.data))
  const errors: string[] = []
  const addedIds: string[] = []
  const changedIds = new Set<string>()
  const moves: NodeMove[] = []
  const alias = new Map<string, string>()

  const resolveId = (id: string): string => alias.get(id) ?? id
  const findNode = (id: string): TreeNode | undefined => tree.nodes.find((n) => n.id === resolveId(id))

  const requireNode = <T extends TreeNode['type']>(
    id: string,
    type: T,
    opName: string,
  ): Extract<TreeNode, { type: T }> | undefined => {
    const node = findNode(id)
    if (!node) {
      errors.push(`${opName}: no node with id "${id}"`)
      return undefined
    }
    if (node.type !== type) {
      errors.push(`${opName}: node "${id}" is a ${node.type}, expected ${type}`)
      return undefined
    }
    return node as Extract<TreeNode, { type: T }>
  }

  const registerNew = (kind: TreeNode['type'], requested?: string): string => {
    const taken = new Set(tree.nodes.map((n) => n.id))
    let id = requested && !taken.has(requested) ? requested : newNodeId(kind)
    while (taken.has(id)) id = newNodeId(kind)
    if (requested && requested !== id) alias.set(requested, id)
    addedIds.push(id)
    return id
  }

  const resolveBranch = (
    node: VariableNode,
    ref: { branchIndex?: number; branchLabel?: string },
    opName: string,
  ): number => {
    if (ref.branchIndex !== undefined) {
      if (ref.branchIndex >= node.branches.length) {
        errors.push(`${opName}: branch index ${ref.branchIndex} out of range on "${node.variableKey}"`)
        return -1
      }
      return ref.branchIndex
    }
    if (ref.branchLabel !== undefined) {
      const want = ref.branchLabel.trim().toLowerCase()
      const indexed = node.branches.map((b, i) => ({ label: b.label.trim().toLowerCase(), i }))
      // Exact label first; fall back to a word-prefix match ("EMG normal"
      // finds "EMG normal → diagnostics") only when nothing matches exactly.
      const exact = indexed.filter((x) => x.label === want)
      const matches = exact.length > 0 ? exact : indexed.filter((x) => x.label.startsWith(`${want} `))
      if (matches.length === 1) return matches[0].i
      errors.push(
        matches.length === 0
          ? `${opName}: no branch labelled "${ref.branchLabel}" on "${node.variableKey}"`
          : `${opName}: branch label "${ref.branchLabel}" is ambiguous on "${node.variableKey}"`,
      )
      return -1
    }
    errors.push(`${opName}: needs branchIndex or branchLabel`)
    return -1
  }

  for (const raw of ops) {
    switch (raw.op) {
      case 'add_variable': {
        const id = registerNew('variable', raw.id)
        tree.nodes.push({
          id,
          type: 'variable',
          variableKey: raw.variableKey,
          prompt: raw.prompt,
          dataSource: raw.dataSource,
          branches: raw.branches.map((b) => ({
            label: b.label,
            ...(b.patientLabel ? { patientLabel: b.patientLabel } : {}),
            condition: b.condition,
            nextNodeId: b.nextNodeId ? resolveId(b.nextNodeId) : '',
          })),
        })
        break
      }
      case 'add_specialist': {
        const id = registerNew('specialist', raw.id)
        tree.nodes.push({
          id,
          type: 'specialist',
          specialistName: raw.specialistName,
          specialty: raw.specialty,
          urgency: raw.urgency,
          reasoningTemplate: raw.reasoningTemplate ?? `Routing to ${raw.specialistName}.`,
          workup: { ...emptyWorkupSpec(), always: raw.workup.map(fullItem) },
        })
        break
      }
      case 'add_escalation': {
        const id = registerNew('escalation', raw.id)
        tree.nodes.push({ id, type: 'escalation', reason: raw.reason })
        break
      }
      case 'update_variable': {
        const node = requireNode(raw.nodeId, 'variable', raw.op)
        if (!node) break
        if (raw.variableKey !== undefined) node.variableKey = raw.variableKey
        if (raw.prompt !== undefined) node.prompt = raw.prompt
        if (raw.dataSource !== undefined) node.dataSource = raw.dataSource
        changedIds.add(node.id)
        break
      }
      case 'update_specialist': {
        const node = requireNode(raw.nodeId, 'specialist', raw.op)
        if (!node) break
        if (raw.specialistName !== undefined) node.specialistName = raw.specialistName
        if (raw.specialty !== undefined) node.specialty = raw.specialty
        if (raw.urgency !== undefined) node.urgency = raw.urgency
        if (raw.reasoningTemplate !== undefined) node.reasoningTemplate = raw.reasoningTemplate
        changedIds.add(node.id)
        break
      }
      case 'update_escalation': {
        const node = requireNode(raw.nodeId, 'escalation', raw.op)
        if (!node) break
        if (raw.reason !== undefined) node.reason = raw.reason
        changedIds.add(node.id)
        break
      }
      case 'add_branch': {
        const node = requireNode(raw.nodeId, 'variable', raw.op)
        if (!node) break
        node.branches.push({
          label: raw.branch.label,
          ...(raw.branch.patientLabel ? { patientLabel: raw.branch.patientLabel } : {}),
          condition: raw.branch.condition,
          nextNodeId: raw.branch.nextNodeId ? resolveId(raw.branch.nextNodeId) : '',
        })
        changedIds.add(node.id)
        break
      }
      case 'update_branch': {
        const node = requireNode(raw.nodeId, 'variable', raw.op)
        if (!node) break
        const i = resolveBranch(node, raw, raw.op)
        if (i < 0) break
        const b = node.branches[i]
        if (raw.label !== undefined) b.label = raw.label
        if (raw.patientLabel !== undefined) b.patientLabel = raw.patientLabel
        if (raw.condition !== undefined) b.condition = raw.condition
        if (raw.nextNodeId !== undefined) b.nextNodeId = raw.nextNodeId ? resolveId(raw.nextNodeId) : ''
        changedIds.add(node.id)
        break
      }
      case 'remove_branch': {
        const node = requireNode(raw.nodeId, 'variable', raw.op)
        if (!node) break
        const i = resolveBranch(node, raw, raw.op)
        if (i < 0) break
        node.branches.splice(i, 1)
        changedIds.add(node.id)
        break
      }
      case 'delete_node': {
        const id = resolveId(raw.nodeId)
        if (!tree.nodes.some((n) => n.id === id)) {
          errors.push(`delete_node: no node with id "${raw.nodeId}"`)
          break
        }
        tree.nodes = tree.nodes.filter((n) => n.id !== id)
        // Unwire any bucket pointing at the deleted node (keep the bucket),
        // matching the Builder's manual-delete behaviour.
        for (const n of tree.nodes) {
          if (n.type !== 'variable') continue
          for (const b of n.branches) {
            if (b.nextNodeId === id) {
              b.nextNodeId = ''
              changedIds.add(n.id)
            }
          }
        }
        break
      }
      case 'set_root': {
        const id = resolveId(raw.nodeId)
        if (!tree.nodes.some((n) => n.id === id)) {
          errors.push(`set_root: no node with id "${raw.nodeId}"`)
          break
        }
        tree.rootNodeId = id
        break
      }
      case 'add_workup_item': {
        const node = requireNode(raw.nodeId, 'specialist', raw.op)
        if (!node) break
        node.workup.always.push(fullItem(raw.item))
        changedIds.add(node.id)
        break
      }
      case 'update_workup_item': {
        const node = requireNode(raw.nodeId, 'specialist', raw.op)
        if (!node) break
        const item = node.workup.always.find(
          (w) => w.name.trim().toLowerCase() === raw.name.trim().toLowerCase(),
        )
        if (!item) {
          errors.push(`update_workup_item: no workup item "${raw.name}" on "${node.specialistName}"`)
          break
        }
        if (raw.newName !== undefined) item.name = raw.newName
        if (raw.protocol !== undefined) item.protocol = raw.protocol
        if (raw.rationale !== undefined) item.rationale = raw.rationale
        changedIds.add(node.id)
        break
      }
      case 'remove_workup_item': {
        const node = requireNode(raw.nodeId, 'specialist', raw.op)
        if (!node) break
        const want = raw.name.trim().toLowerCase()
        const before = node.workup.always.length
        node.workup.always = node.workup.always.filter((w) => w.name.trim().toLowerCase() !== want)
        if (node.workup.always.length === before) {
          errors.push(`remove_workup_item: no workup item "${raw.name}" on "${node.specialistName}"`)
          break
        }
        changedIds.add(node.id)
        break
      }
      case 'add_workup_conditional': {
        const node = requireNode(raw.nodeId, 'specialist', raw.op)
        if (!node) break
        node.workup.conditional.push({ when: raw.when, item: fullItem(raw.item), reason: raw.reason })
        changedIds.add(node.id)
        break
      }
      case 'remove_workup_conditional': {
        const node = requireNode(raw.nodeId, 'specialist', raw.op)
        if (!node) break
        const want = raw.itemName.trim().toLowerCase()
        const before = node.workup.conditional.length
        node.workup.conditional = node.workup.conditional.filter(
          (c) => c.item.name.trim().toLowerCase() !== want,
        )
        if (node.workup.conditional.length === before) {
          errors.push(`remove_workup_conditional: no conditional item "${raw.itemName}" on "${node.specialistName}"`)
          break
        }
        changedIds.add(node.id)
        break
      }
      case 'add_workup_guard': {
        const node = requireNode(raw.nodeId, 'specialist', raw.op)
        if (!node) break
        node.workup.doNotOrderUnless.push({ item: raw.item, requiredCondition: raw.requiredCondition })
        changedIds.add(node.id)
        break
      }
      case 'remove_workup_guard': {
        const node = requireNode(raw.nodeId, 'specialist', raw.op)
        if (!node) break
        const want = raw.itemName.trim().toLowerCase()
        const before = node.workup.doNotOrderUnless.length
        node.workup.doNotOrderUnless = node.workup.doNotOrderUnless.filter(
          (g) => g.item.trim().toLowerCase() !== want,
        )
        if (node.workup.doNotOrderUnless.length === before) {
          errors.push(`remove_workup_guard: no guard for "${raw.itemName}" on "${node.specialistName}"`)
          break
        }
        changedIds.add(node.id)
        break
      }
      case 'move_nodes': {
        // Layout-only: verify every id and hand resolved moves to the Builder.
        // The tree itself is untouched — no changedIds, no diff, no rewiring.
        const resolved: string[] = []
        for (const rawId of raw.nodeIds) {
          const id = resolveId(rawId)
          if (!tree.nodes.some((n) => n.id === id)) {
            errors.push(`move_nodes: no node with id "${rawId}"`)
            continue
          }
          resolved.push(id)
        }
        if (resolved.length === raw.nodeIds.length) moves.push({ nodeIds: [...new Set(resolved)], placement: raw.placement })
        break
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, tree: parsed.data, errors, addedIds: [], changedIds: [], moves: [] }
  }

  // The applied result must itself be a valid tree — the same hard gate as save.
  const finalParse = TreeSchema.safeParse(tree)
  if (!finalParse.success) {
    return {
      ok: false,
      tree: parsed.data,
      errors: [`result failed schema validation: ${finalParse.error.issues[0]?.message}`],
      addedIds: [],
      changedIds: [],
      moves: [],
    }
  }

  // Don't report freshly added nodes as "changed" too.
  for (const id of addedIds) changedIds.delete(id)
  return { ok: true, tree: finalParse.data, errors: [], addedIds, changedIds: [...changedIds], moves }
}

/* -------------------------------------------------------------------------- */
/* Layout-move descriptions (for the proposal card)                           */
/* -------------------------------------------------------------------------- */

const PLACEMENT_TEXT: Record<NodeMove['placement'], string> = {
  top: 'the top of the canvas',
  bottom: 'the bottom of the canvas',
  left: 'the left of the canvas',
  right: 'the right of the canvas',
}

/**
 * Human-readable line per move, in the same voice as the clinical diff.
 * Layout moves have no clinical consequence, and the text says so.
 */
export function describeMoves(tree: Tree, moves: NodeMove[]): string[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const nameOf = (id: string): string => {
    const n = byId.get(id)
    if (!n) return id
    if (n.type === 'variable') return `'${n.variableKey}'`
    if (n.type === 'specialist') return n.specialistName
    return 'Human review'
  }
  return moves.map((m) => {
    const names = m.nodeIds.map(nameOf)
    const listed = names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
    return `Move ${listed} to ${PLACEMENT_TEXT[m.placement]} — layout only, wiring and routing unchanged`
  })
}
