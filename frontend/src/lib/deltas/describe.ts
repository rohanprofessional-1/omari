import type { Condition } from '../../types/tree'
import type { BranchAnchor, Delta, NodeAnchor } from './schema'

/**
 * Blume — human-readable delta rendering.
 *
 * One sentence per delta, in the same clinical voice as the Sprout diff.
 * The rendered list IS the clinic's deviation register: it's what the
 * surgeon reviews at sign-off, and every CPG deviation says so explicitly.
 */

function anchorText(a: NodeAnchor): string {
  if (a.kind === 'variable') return `'${a.variableKey}'`
  if (a.kind === 'terminal') return a.specialistName ? `'${a.specialistName}'` : a.specialty ? `'${a.specialty}'` : 'a CPG endpoint'
  return `node ${a.nodeId}`
}

function branchText(b: BranchAnchor): string {
  return b.label ? `'${b.label}'` : 'a branch'
}

function conditionText(c: Condition): string {
  if (c.op === 'equals') return `= ${String(c.value)}`
  if (c.op === 'range') {
    if (c.min !== undefined && c.max !== undefined) return `${c.min}–${c.max}`
    if (c.min !== undefined) return `≥ ${c.min}`
    return `≤ ${c.max}`
  }
  return `one of ${c.values.join(', ')}`
}

export function describeDelta(delta: Delta): string {
  const p = delta.payload
  let text: string
  switch (p.op) {
    case 'bind_terminal': {
      const where = p.anchors.length === 1 ? anchorText(p.anchors[0]) : `${p.anchors.length} CPG endpoints`
      text =
        p.target.kind === 'specialist'
          ? `Route ${where} to ${p.target.specialistName}${p.target.specialty ? ` (${p.target.specialty})` : ''}`
          : `Route ${where} to human review — ${p.target.reason}`
      break
    }
    case 'set_urgency': {
      const where = p.anchors.length === 1 ? anchorText(p.anchors[0]) : `${p.anchors.length} endpoints`
      text = `Set urgency of ${where} to ${p.urgency}`
      break
    }
    case 'set_threshold':
      text =
        p.mode === 'replace'
          ? `Set the ${branchText(p.branch)} threshold on ${anchorText(p.branch.node)} to ${p.replacement ? conditionText(p.replacement) : '?'}`
          : `Split ${branchText(p.branch)} on ${anchorText(p.branch.node)} into ${p.split?.map((s) => `${s.label} (${conditionText(s.condition)})`).join(', ') ?? '?'}`
      break
    case 'add_workup':
      text = p.when
        ? `Order ${p.item.name} before visits to ${anchorText(p.anchor)} when ${p.when.key} ${conditionText(p.when)}`
        : `Always order ${p.item.name} before visits to ${anchorText(p.anchor)}`
      break
    case 'remove_workup':
      text = p.guardInstead
        ? `Don't order ${p.itemName} for ${anchorText(p.anchor)} unless ${p.guardInstead.key} ${conditionText(p.guardInstead)}`
        : `Stop ordering ${p.itemName} for ${anchorText(p.anchor)}`
      break
    case 'suppress_branch':
      text = `Suppress the ${branchText(p.branch)} pathway on ${anchorText(p.branch.node)} — ${p.reason}`
      break
    case 'set_scope':
      text = `Out of scope: ${branchText(p.branch)} — ${p.reason}`
      break
    case 'add_rule':
      text = `Add clinic rule '${p.variableKey}' ("${p.prompt}") before ${branchText(p.insertAt)} on ${anchorText(p.insertAt.node)}`
      break
    case 'reorder_priority':
      text = `Reorder branch precedence on ${anchorText(p.node)}: ${p.order.map(branchText).join(' → ')}`
      break
    case 'reword':
      text = p.branch
        ? `Reword the patient label on ${branchText(p.branch)} (copy only, routing unchanged)`
        : `Reword the prompt on ${p.node ? anchorText(p.node) : '?'} (copy only, routing unchanged)`
      break
  }
  if (delta.provenance.deviatesFromCpg) {
    text += ` — DEVIATES FROM CPG: ${delta.provenance.rationale || 'no rationale recorded'}`
  }
  return text
}

export function describeDeltas(deltas: Delta[]): string[] {
  return [...deltas].sort((a, b) => a.seq - b.seq).map(describeDelta)
}
