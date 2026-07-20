import { describeCondition } from '../treeToFlow'
import type { Node as TreeNode, Tree, WorkupItem } from '../../types/tree'

/**
 * Blume — human-readable diff between two trees, for the assistant's
 * propose → confirm gate. Each entry states the CLINICAL consequence of a
 * change ("'Mass present' now routes to Dr. Gooch (was Dr. Chen)"), not the
 * structural mechanics, so confirming a proposal is a real clinical review.
 * Deterministic — computed from the trees, never phrased by the LLM.
 */

export interface DiffEntry {
  kind: 'add' | 'remove' | 'change'
  text: string
}

function nameOf(node: TreeNode | undefined, fallback = 'nowhere (unwired)'): string {
  if (!node) return fallback
  switch (node.type) {
    case 'variable':
      return `decision “${node.variableKey}”`
    case 'specialist':
      return node.specialistName
    case 'escalation':
      return 'human review (escalation)'
  }
}

function shortName(node: TreeNode): string {
  return node.type === 'variable' ? node.variableKey : nameOf(node)
}

function target(tree: Tree, id: string): string {
  if (!id) return 'nowhere (unwired)'
  return nameOf(tree.nodes.find((n) => n.id === id), `unknown node ${id}`)
}

function itemNames(items: WorkupItem[]): Set<string> {
  return new Set(items.map((i) => i.name.trim().toLowerCase()))
}

export function diffTrees(before: Tree, after: Tree): DiffEntry[] {
  const out: DiffEntry[] = []
  const beforeById = new Map(before.nodes.map((n) => [n.id, n]))
  const afterById = new Map(after.nodes.map((n) => [n.id, n]))

  /* Added nodes */
  for (const node of after.nodes) {
    if (beforeById.has(node.id)) continue
    switch (node.type) {
      case 'variable':
        out.push({
          kind: 'add',
          text: `Add decision “${node.variableKey}” (${node.prompt}) with ${node.branches.length} bucket${node.branches.length === 1 ? '' : 's'}: ${node.branches.map((b) => `“${b.label}” → ${target(after, b.nextNodeId)}`).join('; ') || 'none yet'}.`,
        })
        break
      case 'specialist':
        out.push({
          kind: 'add',
          text: `Add specialist ${node.specialistName} (${node.specialty || 'no specialty set'}, ${node.urgency})${node.workup.always.length ? ` with workup: ${node.workup.always.map((w) => w.name).join(', ')}` : ' with no pre-visit workup'}.`,
        })
        break
      case 'escalation':
        out.push({ kind: 'add', text: `Add escalation to human review: ${node.reason}` })
        break
    }
  }

  /* Removed nodes */
  for (const node of before.nodes) {
    if (afterById.has(node.id)) continue
    out.push({ kind: 'remove', text: `Delete ${nameOf(node)} — buckets that pointed here become unwired.` })
  }

  /* Changed nodes */
  for (const node of after.nodes) {
    const prev = beforeById.get(node.id)
    if (!prev || prev.type !== node.type) continue

    if (node.type === 'variable' && prev.type === 'variable') {
      if (prev.variableKey !== node.variableKey)
        out.push({ kind: 'change', text: `Rename decision “${prev.variableKey}” to “${node.variableKey}”.` })
      if (prev.prompt !== node.prompt)
        out.push({ kind: 'change', text: `Reword “${node.variableKey}”: “${prev.prompt}” → “${node.prompt}”.` })
      if (prev.dataSource !== node.dataSource)
        out.push({ kind: 'change', text: `“${node.variableKey}” now answered from the ${node.dataSource} (was ${prev.dataSource}).` })

      // Branch-level diff by position (ops edit in place; adds append; removes splice).
      const max = Math.max(prev.branches.length, node.branches.length)
      const removed = prev.branches.slice(node.branches.length)
      for (const b of removed)
        out.push({ kind: 'remove', text: `Remove bucket “${b.label}” from “${node.variableKey}” — patients matching it no longer have a route here.` })
      for (let i = 0; i < Math.min(prev.branches.length, node.branches.length, max); i++) {
        const a = prev.branches[i]
        const b = node.branches[i]
        if (a.label !== b.label)
          out.push({ kind: 'change', text: `Rename bucket “${a.label}” to “${b.label}” on “${node.variableKey}”.` })
        if (JSON.stringify(a.condition) !== JSON.stringify(b.condition))
          out.push({ kind: 'change', text: `Bucket “${b.label}” on “${node.variableKey}” now matches ${describeCondition(b.condition)} (was ${describeCondition(a.condition)}).` })
        if (a.nextNodeId !== b.nextNodeId)
          out.push({ kind: 'change', text: `Patients answering “${b.label}” on “${node.variableKey}” now go to ${target(after, b.nextNodeId)} (was ${target(before, a.nextNodeId)}).` })
      }
      for (const b of node.branches.slice(prev.branches.length))
        out.push({ kind: 'add', text: `Add bucket “${b.label}” (${describeCondition(b.condition)}) on “${node.variableKey}” → ${target(after, b.nextNodeId)}.` })
    }

    if (node.type === 'specialist' && prev.type === 'specialist') {
      if (prev.specialistName !== node.specialistName)
        out.push({ kind: 'change', text: `All paths to ${prev.specialistName} now route to ${node.specialistName}.` })
      if (prev.specialty !== node.specialty)
        out.push({ kind: 'change', text: `${node.specialistName}: specialty “${prev.specialty}” → “${node.specialty}”.` })
      if (prev.urgency !== node.urgency)
        out.push({ kind: 'change', text: `Referrals to ${node.specialistName} are now ${node.urgency} (was ${prev.urgency}).` })
      if (prev.reasoningTemplate !== node.reasoningTemplate)
        out.push({ kind: 'change', text: `Update the reasoning shown for ${node.specialistName}.` })

      const prevNames = itemNames(prev.workup.always)
      const nextNames = itemNames(node.workup.always)
      for (const w of node.workup.always)
        if (!prevNames.has(w.name.trim().toLowerCase()))
          out.push({ kind: 'add', text: `Patients reaching ${node.specialistName} now get ${w.name} before the visit${w.rationale ? ` (${w.rationale})` : ''}.` })
      for (const w of prev.workup.always)
        if (!nextNames.has(w.name.trim().toLowerCase()))
          out.push({ kind: 'remove', text: `${w.name} is no longer ordered before visits to ${node.specialistName}.` })
      for (const w of node.workup.always) {
        const old = prev.workup.always.find((p) => p.name.trim().toLowerCase() === w.name.trim().toLowerCase())
        if (old && (old.protocol !== w.protocol || old.rationale !== w.rationale))
          out.push({ kind: 'change', text: `Update ${w.name} details for ${node.specialistName}.` })
      }

      const prevCond = new Set(prev.workup.conditional.map((c) => c.item.name.trim().toLowerCase()))
      const nextCond = new Set(node.workup.conditional.map((c) => c.item.name.trim().toLowerCase()))
      for (const c of node.workup.conditional)
        if (!prevCond.has(c.item.name.trim().toLowerCase()))
          out.push({ kind: 'add', text: `${node.specialistName}: order ${c.item.name} only when ${c.when.key} ${describeCondition(c.when)}.` })
      for (const c of prev.workup.conditional)
        if (!nextCond.has(c.item.name.trim().toLowerCase()))
          out.push({ kind: 'remove', text: `${node.specialistName}: drop the conditional rule for ${c.item.name}.` })

      const prevGuard = new Set(prev.workup.doNotOrderUnless.map((g) => g.item.trim().toLowerCase()))
      const nextGuard = new Set(node.workup.doNotOrderUnless.map((g) => g.item.trim().toLowerCase()))
      for (const g of node.workup.doNotOrderUnless)
        if (!prevGuard.has(g.item.trim().toLowerCase()))
          out.push({ kind: 'add', text: `${node.specialistName}: do NOT order ${g.item} unless ${g.requiredCondition.key} ${describeCondition(g.requiredCondition)}.` })
      for (const g of prev.workup.doNotOrderUnless)
        if (!nextGuard.has(g.item.trim().toLowerCase()))
          out.push({ kind: 'remove', text: `${node.specialistName}: remove the do-not-order guard on ${g.item}.` })
    }

    if (node.type === 'escalation' && prev.type === 'escalation' && prev.reason !== node.reason)
      out.push({ kind: 'change', text: `Escalation reason: “${prev.reason}” → “${node.reason}”.` })
  }

  if (before.rootNodeId !== after.rootNodeId) {
    const rootNode = afterById.get(after.rootNodeId)
    out.push({ kind: 'change', text: `The tree now starts at ${rootNode ? shortName(rootNode) : after.rootNodeId}.` })
  }

  return out
}
