import { TreeSchema, type Tree, type VariableNode } from '../../types/tree'
import { applyOps, type TreeOp } from '../assistant/ops'
import type { BranchAnchor, Delta, DeltaResult, DeltaResultStatus, NodeAnchor } from './schema'
import {
  conditionFingerprint,
  resolveBranchAnchor,
  resolveNodeAnchor,
  type BranchResolution,
  type ResolveContext,
} from './resolve'

/**
 * Blume — the delta compiler.
 *
 * `compile(base, deltas)` deterministically produces the deployed tree:
 * the CPG-generated base with the clinic's ordered deltas applied on top.
 * Each delta is resolved against the CURRENT base (late binding — persisted
 * deltas carry no raw node ids), lowered to bounded TreeOps, and applied
 * through the same all-or-nothing `applyOps` gate Sprout uses.
 *
 * THE NEVER-SILENT INVARIANT: every delta ends every compile with exactly
 * one explicit DeltaResult status. A delta whose anchor fails resolves to a
 * stale_* status and is skipped — surfaced for re-review, never dropped,
 * never guessed at. Compilation itself always succeeds; staleness is data.
 */

export interface CompileOptions {
  ctx?: ResolveContext
}

export interface CompileOutput {
  tree: Tree
  results: DeltaResult[]
  /** Compiler notices (lint-level, non-blocking). */
  report: string[]
}

/** The base arrives as raw scaffold JSON (`draft_tree_json` /
 *  `base_tree_json`), which is TreeFullCreate-shaped — no treeId. */
export interface BaseTreeInput {
  treeId?: string
  rootNodeId: string
  nodes: unknown[]
  [key: string]: unknown
}

type Lowered =
  | { ok: true; ops: TreeOp[] }
  | { ok: false; status: Exclude<DeltaResultStatus, 'applied'>; reason: string }

const stale = (status: 'stale_unresolved' | 'stale_ambiguous' | 'stale_conflict', reason: string): Lowered => ({
  ok: false,
  status,
  reason,
})

const STATUS_OF_RESOLUTION = {
  unresolved: 'stale_unresolved',
  ambiguous: 'stale_ambiguous',
  conflict: 'stale_conflict',
} as const

/* -------------------------------------------------------------------------- */
/* Supersession                                                               */
/* -------------------------------------------------------------------------- */

const anchorKey = (a: NodeAnchor): string => JSON.stringify(a)
const branchKey = (b: BranchAnchor): string => `${anchorKey(b.node)}#${b.conditionFingerprint}`

/** Which durable "slots" a delta writes. When a later delta owns every slot
 *  an earlier one wrote, the earlier delta is superseded — one active writer
 *  per slot keeps the review list from silting up. */
function writerKeys(delta: Delta): string[] {
  const p = delta.payload
  switch (p.op) {
    case 'bind_terminal':
      return p.anchors.map((a) => `bind:${anchorKey(a)}`)
    case 'set_urgency':
      return p.anchors.map((a) => `urgency:${anchorKey(a)}`)
    case 'set_threshold':
      return [`threshold:${branchKey(p.branch)}`]
    case 'suppress_branch':
    case 'set_scope':
      return [`suppress:${branchKey(p.branch)}`]
    case 'reorder_priority':
      return [`order:${anchorKey(p.node)}`]
    case 'reword':
      return [`reword:${p.node ? anchorKey(p.node) : ''}:${p.branch ? branchKey(p.branch) : ''}`]
    case 'add_workup':
      return [`workup+:${anchorKey(p.anchor)}:${p.item.name.toLowerCase()}`]
    case 'remove_workup':
      return [`workup-:${anchorKey(p.anchor)}:${p.itemName.toLowerCase()}`]
    case 'add_rule':
      return [`rule:${delta.id}`] // structural additions never supersede each other
  }
}

/* -------------------------------------------------------------------------- */
/* Lowering: one delta → bounded TreeOps against the current tree             */
/* -------------------------------------------------------------------------- */

/** Parents that route into `nodeId`: [parent node id, branch index]. */
function inboundBranches(tree: Tree, nodeId: string): Array<[string, number]> {
  const hits: Array<[string, number]> = []
  for (const n of tree.nodes) {
    if (n.type !== 'variable') continue
    n.branches.forEach((b, i) => {
      if (b.nextNodeId === nodeId) hits.push([n.id, i])
    })
  }
  return hits
}

function resolveAll(
  tree: Tree,
  anchors: NodeAnchor[],
  ctx: ResolveContext,
): { ok: true; nodeIds: string[] } | { ok: false; lowered: Lowered } {
  const nodeIds: string[] = []
  for (const anchor of anchors) {
    const res = resolveNodeAnchor(tree, anchor, ctx)
    if (res.status !== 'resolved') {
      // All-or-nothing per delta: a bulk bind with one failed anchor is
      // wholly stale — partially applying would silently skip endpoints.
      return { ok: false, lowered: stale(STATUS_OF_RESOLUTION[res.status], res.reason ?? res.status) }
    }
    nodeIds.push(res.nodeId!)
  }
  return { ok: true, nodeIds }
}

function requireBranch(tree: Tree, anchor: BranchAnchor, ctx: ResolveContext): { res: BranchResolution; lowered?: Lowered } {
  const res = resolveBranchAnchor(tree, anchor, ctx)
  if (res.status !== 'resolved') {
    return { res, lowered: stale(STATUS_OF_RESOLUTION[res.status], res.reason ?? res.status) }
  }
  return { res }
}

function lower(tree: Tree, delta: Delta, ctx: ResolveContext): Lowered {
  const p = delta.payload

  switch (p.op) {
    case 'bind_terminal': {
      const resolved = resolveAll(tree, p.anchors, ctx)
      if (!resolved.ok) return resolved.lowered
      const ops: TreeOp[] = []
      if (p.target.kind === 'specialist') {
        for (const nodeId of resolved.nodeIds) {
          const node = tree.nodes.find((n) => n.id === nodeId)
          if (node?.type !== 'specialist')
            return stale('stale_conflict', `anchor resolved to a ${node?.type ?? 'missing'} node, expected a terminal`)
          ops.push({
            op: 'update_specialist',
            nodeId,
            specialistName: p.target.specialistName,
            ...(p.target.specialty !== undefined ? { specialty: p.target.specialty } : {}),
            // Placeholders carry no reasoning; give a real binding one.
            ...(node.reasoningTemplate.trim() === '' || node.specialistName.startsWith('[Assign')
              ? { reasoningTemplate: `Routing to ${p.target.specialistName}.` }
              : {}),
          })
        }
      } else {
        // Bind to escalation: TreeOps can't change a node's type, so lower to
        // add-escalation → rewire every inbound branch → delete the terminal.
        resolved.nodeIds.forEach((nodeId, i) => {
          const escAlias = `new_bind_esc_${i}`
          ops.push({ op: 'add_escalation', id: escAlias, reason: (p.target as { reason: string }).reason })
          for (const [parentId, branchIndex] of inboundBranches(tree, nodeId)) {
            ops.push({ op: 'update_branch', nodeId: parentId, branchIndex, nextNodeId: escAlias })
          }
          ops.push({ op: 'delete_node', nodeId })
        })
      }
      return { ok: true, ops }
    }

    case 'set_urgency': {
      const resolved = resolveAll(tree, p.anchors, ctx)
      if (!resolved.ok) return resolved.lowered
      return {
        ok: true,
        ops: resolved.nodeIds.map((nodeId) => ({ op: 'update_specialist', nodeId, urgency: p.urgency })),
      }
    }

    case 'set_threshold': {
      const { res, lowered } = requireBranch(tree, p.branch, ctx)
      if (lowered) return lowered
      const { nodeId, branchIndex } = res as Required<Pick<BranchResolution, 'nodeId' | 'branchIndex'>>
      if (p.mode === 'replace') {
        if (!p.replacement) return { ok: false, status: 'error', reason: 'set_threshold replace mode needs a replacement condition' }
        return { ok: true, ops: [{ op: 'update_branch', nodeId, branchIndex, condition: p.replacement }] }
      }
      if (!p.split || p.split.length < 2)
        return { ok: false, status: 'error', reason: 'set_threshold split mode needs at least two bands' }
      const node = tree.nodes.find((n) => n.id === nodeId) as VariableNode
      const originalDest = node.branches[branchIndex].nextNodeId
      const ops: TreeOp[] = []
      for (let i = 0; i < p.split.length; i++) {
        const band = p.split[i]
        let dest = originalDest
        if (band.target === 'sibling') {
          if (!band.siblingTarget)
            return { ok: false, status: 'error', reason: `split band "${band.label}" targets a sibling but has no siblingTarget anchor` }
          const sib = resolveNodeAnchor(tree, band.siblingTarget, ctx)
          if (sib.status !== 'resolved')
            return stale(STATUS_OF_RESOLUTION[sib.status], `split band "${band.label}": ${sib.reason}`)
          dest = sib.nodeId!
        }
        ops.push({
          op: 'insert_branch',
          nodeId,
          index: branchIndex + i,
          branch: {
            label: band.label,
            ...(band.patientLabel ? { patientLabel: band.patientLabel } : {}),
            condition: band.condition,
            nextNodeId: dest,
          },
        })
      }
      // The original (now shifted past the inserted bands) is removed — the
      // bands replace it at exactly its position in first-match order.
      ops.push({ op: 'remove_branch', nodeId, branchIndex: branchIndex + p.split.length })
      return { ok: true, ops }
    }

    case 'add_workup': {
      const resolved = resolveAll(tree, [p.anchor], ctx)
      if (!resolved.ok) return resolved.lowered
      const nodeId = resolved.nodeIds[0]
      if (p.when) {
        return { ok: true, ops: [{ op: 'add_workup_conditional', nodeId, when: p.when, item: p.item, reason: p.reason ?? '' }] }
      }
      return { ok: true, ops: [{ op: 'add_workup_item', nodeId, item: p.item }] }
    }

    case 'remove_workup': {
      const resolved = resolveAll(tree, [p.anchor], ctx)
      if (!resolved.ok) return resolved.lowered
      const nodeId = resolved.nodeIds[0]
      if (p.guardInstead) {
        return { ok: true, ops: [{ op: 'add_workup_guard', nodeId, item: p.itemName, requiredCondition: p.guardInstead }] }
      }
      const node = tree.nodes.find((n) => n.id === nodeId)
      if (node?.type !== 'specialist') return stale('stale_conflict', 'anchor resolved to a non-terminal node')
      const want = p.itemName.trim().toLowerCase()
      if (node.workup.always.some((w) => w.name.trim().toLowerCase() === want)) {
        return { ok: true, ops: [{ op: 'remove_workup_item', nodeId, name: p.itemName }] }
      }
      if (node.workup.conditional.some((c) => c.item.name.trim().toLowerCase() === want)) {
        return { ok: true, ops: [{ op: 'remove_workup_conditional', nodeId, itemName: p.itemName }] }
      }
      return stale('stale_unresolved', `no workup item "${p.itemName}" on this terminal (the base may have changed)`)
    }

    case 'suppress_branch':
    case 'set_scope': {
      const { res, lowered } = requireBranch(tree, p.branch, ctx)
      if (lowered) return lowered
      const { nodeId, branchIndex } = res as Required<Pick<BranchResolution, 'nodeId' | 'branchIndex'>>
      const reason = p.op === 'set_scope' ? `Out of scope for this clinic: ${p.reason}` : p.reason
      const escAlias = 'new_suppress_esc'
      return {
        ok: true,
        ops: [
          { op: 'add_escalation', id: escAlias, reason },
          { op: 'update_branch', nodeId, branchIndex, nextNodeId: escAlias },
        ],
      }
    }

    case 'add_rule': {
      const { res, lowered } = requireBranch(tree, p.insertAt, ctx)
      if (lowered) return lowered
      const { nodeId: parentId, branchIndex } = res as Required<Pick<BranchResolution, 'nodeId' | 'branchIndex'>>
      const parent = tree.nodes.find((n) => n.id === parentId) as VariableNode
      const originalDest = parent.branches[branchIndex].nextNodeId
      const ops: TreeOp[] = []
      const gateAlias = 'new_rule_gate'
      const gateBranches: Array<{ label: string; patientLabel?: string; condition: unknown; nextNodeId?: string }> = []
      for (let i = 0; i < p.branches.length; i++) {
        const rb = p.branches[i]
        let dest: string
        if (rb.target === 'continue') {
          dest = originalDest
        } else if (rb.target === 'escalate') {
          const escAlias = `new_rule_esc_${i}`
          ops.push({ op: 'add_escalation', id: escAlias, reason: rb.escalationReason ?? 'Needs clinical review.' })
          dest = escAlias
        } else {
          if (!rb.terminalAnchor)
            return { ok: false, status: 'error', reason: `rule branch "${rb.label}" targets a terminal but has no anchor` }
          const t = resolveNodeAnchor(tree, rb.terminalAnchor, ctx)
          if (t.status !== 'resolved') return stale(STATUS_OF_RESOLUTION[t.status], `rule branch "${rb.label}": ${t.reason}`)
          dest = t.nodeId!
        }
        gateBranches.push({
          label: rb.label,
          ...(rb.patientLabel ? { patientLabel: rb.patientLabel } : {}),
          condition: rb.condition,
          nextNodeId: dest,
        })
      }
      // Escalation aliases are registered by the ops above before the gate
      // references them; applyOps resolves them on creation.
      ops.push({
        op: 'add_variable',
        id: gateAlias,
        variableKey: p.variableKey,
        prompt: p.prompt,
        dataSource: p.dataSource,
        branches: gateBranches,
      } as TreeOp)
      ops.push({ op: 'update_branch', nodeId: parentId, branchIndex, nextNodeId: gateAlias })
      return { ok: true, ops }
    }

    case 'reorder_priority': {
      const nodeRes = resolveNodeAnchor(tree, p.node, ctx)
      if (nodeRes.status !== 'resolved')
        return stale(STATUS_OF_RESOLUTION[nodeRes.status], nodeRes.reason ?? nodeRes.status)
      const node = tree.nodes.find((n) => n.id === nodeRes.nodeId)
      if (node?.type !== 'variable') return stale('stale_conflict', 'reorder anchor resolved to a non-variable node')
      if (p.order.length !== node.branches.length) {
        return stale(
          'stale_conflict',
          `this node now has ${node.branches.length} branches but the recorded order lists ${p.order.length} — the branch set changed`,
        )
      }
      const fingerprints = node.branches.map((b) => conditionFingerprint(b.condition))
      const order: number[] = []
      for (const anchor of p.order) {
        const matches = fingerprints
          .map((fp, i) => ({ fp, i }))
          .filter((x) => x.fp === anchor.conditionFingerprint && !order.includes(x.i))
        if (matches.length !== 1) {
          return stale('stale_conflict', `branch "${anchor.label ?? anchor.conditionFingerprint}" no longer matches — the branch set changed`)
        }
        order.push(matches[0].i)
      }
      return { ok: true, ops: [{ op: 'reorder_branches', nodeId: node.id, order }] }
    }

    case 'reword': {
      if (p.branch) {
        const { res, lowered } = requireBranch(tree, p.branch, ctx)
        if (lowered) return lowered
        const { nodeId, branchIndex } = res as Required<Pick<BranchResolution, 'nodeId' | 'branchIndex'>>
        if (p.patientLabel === undefined) return { ok: false, status: 'error', reason: 'branch reword needs a patientLabel' }
        return { ok: true, ops: [{ op: 'update_branch', nodeId, branchIndex, patientLabel: p.patientLabel }] }
      }
      if (p.node) {
        const nodeRes = resolveNodeAnchor(tree, p.node, ctx)
        if (nodeRes.status !== 'resolved')
          return stale(STATUS_OF_RESOLUTION[nodeRes.status], nodeRes.reason ?? nodeRes.status)
        if (p.prompt === undefined) return { ok: false, status: 'error', reason: 'node reword needs a prompt' }
        return { ok: true, ops: [{ op: 'update_variable', nodeId: nodeRes.nodeId!, prompt: p.prompt }] }
      }
      return { ok: false, status: 'error', reason: 'reword needs a node or branch anchor' }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The compiler                                                               */
/* -------------------------------------------------------------------------- */

export function compile(base: BaseTreeInput | Tree, deltas: Delta[], opts: CompileOptions = {}): CompileOutput {
  const ctx = opts.ctx ?? {}
  const report: string[] = []

  const parsed = TreeSchema.safeParse({ ...base, treeId: (base as BaseTreeInput).treeId ?? 'base' })
  if (!parsed.success) {
    throw new Error(`compile: base tree failed schema validation: ${parsed.error.issues[0]?.message}`)
  }
  let tree: Tree = parsed.data

  const ordered = [...deltas].sort((a, b) => a.seq - b.seq)

  // Supersession bookkeeping: last writer per slot wins; an earlier delta is
  // superseded only when EVERY slot it writes has a later writer.
  const lastWriter = new Map<string, string>()
  for (const d of ordered) {
    if (d.status === 'dismissed') continue
    for (const key of writerKeys(d)) lastWriter.set(key, d.id)
  }

  const results: DeltaResult[] = []
  for (const delta of ordered) {
    if (delta.status === 'dismissed') {
      results.push({ deltaId: delta.id, status: 'dismissed', nodeIds: [] })
      continue
    }
    if (writerKeys(delta).every((key) => lastWriter.get(key) !== delta.id)) {
      results.push({ deltaId: delta.id, status: 'superseded', reason: 'a later delta rewrites everything this one set', nodeIds: [] })
      continue
    }

    const lowered = lower(tree, delta, ctx)
    if (!lowered.ok) {
      results.push({ deltaId: delta.id, status: lowered.status, reason: lowered.reason, nodeIds: [] })
      continue
    }

    // Deterministic ids: seeded by delta id + a per-delta counter, so the
    // same (base, deltas) always compiles to a byte-identical tree.
    let counter = 0
    const applied = applyOps(tree, lowered.ops, { idFactory: (kind) => `delta_${delta.id}_${kind}_${counter++}` })
    if (!applied.ok) {
      results.push({
        deltaId: delta.id,
        status: 'error',
        reason: applied.errors.join('; '),
        nodeIds: [],
      })
      continue
    }
    tree = applied.tree
    results.push({ deltaId: delta.id, status: 'applied', nodeIds: [...applied.changedIds, ...applied.addedIds] })
  }

  const staleCount = results.filter((r) => r.status.startsWith('stale')).length
  if (staleCount > 0) report.push(`${staleCount} delta(s) need re-review before this tree is complete`)

  return { tree, results, report }
}
