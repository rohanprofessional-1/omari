import { shortBranchLabel } from '../treeToFlow'
import type { Node as TreeNode, Tree } from '../../types/tree'

/**
 * Blume — routing impact of a proposed tree change ("simulate the change").
 *
 * Instead of describing edits structurally, this answers the clinical
 * question: WHICH PATIENTS END UP SOMEWHERE ELSE? It enumerates every
 * decision path (root → destination) in the before and after trees and
 * diffs the destinations. Pure deterministic graph walking — the same
 * spirit as the engine, no LLM anywhere near it.
 */

export interface RoutePath {
  /** Stable key: the sequence of answers taken ("side: Left → duration: Chronic"). */
  signature: string
  /** Where the path lands, as a human label ("Dr. Chen (routine)", "Human review", "nowhere (unwired)"). */
  dest: string
}

export interface RoutingImpact {
  /** Paths that exist in both trees but now land somewhere else. */
  changed: { path: string; from: string; to: string }[]
  /** Paths that only exist after the change. */
  added: { path: string; to: string }[]
  /** Paths that no longer exist after the change. */
  removed: { path: string; from: string }[]
  /** Total distinct paths in the AFTER tree. */
  totalAfter: number
  /** True when enumeration hit the safety cap (impact may be partial). */
  truncated: boolean
}

const PATH_CAP = 400

function destLabel(node: TreeNode | undefined): string {
  if (!node) return 'nowhere (unwired)'
  switch (node.type) {
    case 'specialist':
      return `${node.specialistName} (${node.urgency})`
    case 'escalation':
      return 'Human review'
    case 'variable':
      return 'nowhere (unwired)' // only used for bucket-less variables
  }
}

/** Enumerate every root→destination path. Cycle-safe, capped. */
export function enumerateRoutes(tree: Tree, cap = PATH_CAP): { paths: RoutePath[]; truncated: boolean } {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const paths: RoutePath[] = []
  let truncated = false

  const emit = (steps: string[], dest: string) => {
    if (paths.length >= cap) {
      truncated = true
      return
    }
    paths.push({ signature: steps.join(' → ') || '(start)', dest })
  }

  const walk = (id: string, steps: string[], seen: Set<string>) => {
    if (paths.length >= cap) {
      truncated = true
      return
    }
    const node = byId.get(id)
    if (!node || node.type !== 'variable') {
      emit(steps, destLabel(node))
      return
    }
    if (seen.has(id)) return // cycle guard: don't revisit a variable on the same path
    if (node.branches.length === 0) {
      emit(steps, 'nowhere (unwired)')
      return
    }
    const nextSeen = new Set(seen).add(id)
    for (const b of node.branches) {
      const step = `${node.variableKey}: ${shortBranchLabel(b)}`
      if (!b.nextNodeId || !byId.has(b.nextNodeId)) emit([...steps, step], 'nowhere (unwired)')
      else walk(b.nextNodeId, [...steps, step], nextSeen)
    }
  }

  if (byId.has(tree.rootNodeId)) walk(tree.rootNodeId, [], new Set())
  return { paths, truncated }
}

export function diffRouting(before: Tree, after: Tree): RoutingImpact {
  const b = enumerateRoutes(before)
  const a = enumerateRoutes(after)
  // Last-write-wins per signature is fine: duplicate signatures only occur on
  // duplicate label sequences, which read identically to the clinician anyway.
  const beforeBySig = new Map(b.paths.map((p) => [p.signature, p.dest]))
  const afterBySig = new Map(a.paths.map((p) => [p.signature, p.dest]))

  const changed: RoutingImpact['changed'] = []
  const added: RoutingImpact['added'] = []
  const removed: RoutingImpact['removed'] = []

  for (const [sig, dest] of afterBySig) {
    const prev = beforeBySig.get(sig)
    if (prev === undefined) added.push({ path: sig, to: dest })
    else if (prev !== dest) changed.push({ path: sig, from: prev, to: dest })
  }
  for (const [sig, dest] of beforeBySig) {
    if (!afterBySig.has(sig)) removed.push({ path: sig, from: dest })
  }

  return { changed, added, removed, totalAfter: afterBySig.size, truncated: b.truncated || a.truncated }
}
