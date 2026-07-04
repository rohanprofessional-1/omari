import type { Tree } from '../../types/tree'

/**
 * Blume — deterministic gap detection for the Sprout guided-fix flow.
 *
 * Finds the holes a Builder tree can prove about itself — unwired buckets,
 * unreachable nodes, dead-end paths, bucket-less variables, reachable
 * specialists with no pre-visit workup — and phrases each as ONE question
 * for the clinician. Detection and phrasing are both deterministic; Sprout
 * only relays the question and transcribes the clinician's answer. The
 * clinician supplies every decision (including "no workup is correct").
 */

export interface BuilderGap {
  /** Stable id so a skipped gap stays skipped across recomputes. */
  id: string
  /** Nodes to highlight on the canvas while this gap is being discussed. */
  nodeIds: string[]
  /** The question Sprout asks — template-phrased, decision left to the clinician. */
  question: string
}

export function detectBuilderGaps(tree: Tree): BuilderGap[] {
  const gaps: BuilderGap[] = []
  const ids = new Set(tree.nodes.map((n) => n.id))
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))

  /* Forward reachability from the root. */
  const reachable = new Set<string>()
  if (ids.has(tree.rootNodeId)) {
    const stack = [tree.rootNodeId]
    reachable.add(tree.rootNodeId)
    while (stack.length) {
      const node = byId.get(stack.pop()!)
      if (!node || node.type !== 'variable') continue
      for (const b of node.branches) {
        if (b.nextNodeId && ids.has(b.nextNodeId) && !reachable.has(b.nextNodeId)) {
          reachable.add(b.nextNodeId)
          stack.push(b.nextNodeId)
        }
      }
    }
  }

  /* Reverse reachability to any terminal (specialist/escalation). */
  const reverse = new Map<string, string[]>()
  for (const n of tree.nodes) {
    if (n.type !== 'variable') continue
    for (const b of n.branches) {
      if (!b.nextNodeId || !ids.has(b.nextNodeId)) continue
      const arr = reverse.get(b.nextNodeId)
      if (arr) arr.push(n.id)
      else reverse.set(b.nextNodeId, [n.id])
    }
  }
  const reachesTerminal = new Set<string>()
  {
    const stack: string[] = []
    for (const n of tree.nodes) {
      if (n.type === 'specialist' || n.type === 'escalation') {
        reachesTerminal.add(n.id)
        stack.push(n.id)
      }
    }
    while (stack.length) {
      const cur = stack.pop()!
      for (const src of reverse.get(cur) ?? []) {
        if (!reachesTerminal.has(src)) {
          reachesTerminal.add(src)
          stack.push(src)
        }
      }
    }
  }

  for (const node of tree.nodes) {
    if (node.type === 'variable') {
      if (node.branches.length === 0) {
        gaps.push({
          id: `no-buckets-${node.id}`,
          nodeIds: [node.id],
          question: `“${node.variableKey}” has no buckets, so it can't route anyone. What answers should it split patients on, and where does each go?`,
        })
      }
      node.branches.forEach((b, i) => {
        if (!b.nextNodeId || !ids.has(b.nextNodeId)) {
          gaps.push({
            id: `dangling-${node.id}-${i}`,
            nodeIds: [node.id],
            question: `The “${b.label || `#${i + 1}`}” bucket on “${node.variableKey}” has no destination. Where should those patients go?`,
          })
        }
      })
      if (reachable.has(node.id) && !reachesTerminal.has(node.id) && node.branches.length > 0) {
        gaps.push({
          id: `no-terminal-${node.id}`,
          nodeIds: [node.id],
          question: `Paths through “${node.variableKey}” never reach a specialist or escalation. Where should they ultimately land?`,
        })
      }
    }

    if (node.id !== tree.rootNodeId && !reachable.has(node.id)) {
      const name =
        node.type === 'variable' ? node.variableKey : node.type === 'specialist' ? node.specialistName : 'the escalation node'
      gaps.push({
        id: `unreachable-${node.id}`,
        nodeIds: [node.id],
        question: `“${name}” can't be reached from the start of the tree. Should it be wired in somewhere, or deleted?`,
      })
    }

    if (
      node.type === 'specialist' &&
      reachable.has(node.id) &&
      node.workup.always.length === 0 &&
      node.workup.conditional.length === 0
    ) {
      gaps.push({
        id: `no-workup-${node.id}`,
        nodeIds: [node.id],
        question: `Patients reach ${node.specialistName} with no pre-visit workup — their first visit starts from scratch. Should anything be ordered beforehand? (Saying “nothing” is a fine answer — I'll leave it as is.)`,
      })
    }
  }

  return gaps
}
