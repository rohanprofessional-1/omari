import type { Node as TreeNode, Tree } from '../types/tree'
import { nodeDisplayName, type BuilderFlowNode } from './treeToFlow'

/**
 * Blume — convert the Builder canvas back into a Tree, and run soft graph
 * validation.
 *
 * The canvas's authoritative wiring lives in each variable node's
 * `branches[].nextNodeId` (connections write back to branches), so the Tree is
 * the nodes' own `treeNode` data — already the real schema shape, not raw
 * React Flow geometry. The caller still validates the result with Zod.
 */

export interface TreeWarning {
  id: string
  message: string
}

/** Pick a start node: the configured root if present, else a node with no incoming edges. */
function pickRoot(nodes: TreeNode[], preferredRootId: string): string {
  if (nodes.some((n) => n.id === preferredRootId)) return preferredRootId

  const hasIncoming = new Set<string>()
  for (const n of nodes) {
    if (n.type === 'variable') {
      for (const b of n.branches) if (b.nextNodeId) hasIncoming.add(b.nextNodeId)
    }
  }
  const roots = nodes.filter((n) => !hasIncoming.has(n.id))
  const variableRoot = roots.find((n) => n.type === 'variable')
  return (variableRoot ?? roots[0] ?? nodes[0])?.id ?? ''
}

/** Build a Tree object from the current flow nodes. */
export function flowNodesToTree(
  nodes: BuilderFlowNode[],
  treeId: string,
  preferredRootId: string,
): Tree {
  const treeNodes = nodes.map((n) => n.data.treeNode)
  return {
    treeId,
    rootNodeId: pickRoot(treeNodes, preferredRootId),
    nodes: treeNodes,
  }
}

/* -------------------------------------------------------------------------- */
/* Soft graph validation (warnings, never hard blocks)                        */
/* -------------------------------------------------------------------------- */

function forwardReachable(nodes: TreeNode[], rootId: string): Set<string> {
  const ids = new Set(nodes.map((n) => n.id))
  const seen = new Set<string>()
  const stack: string[] = []
  if (ids.has(rootId)) {
    seen.add(rootId)
    stack.push(rootId)
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  while (stack.length) {
    const node = byId.get(stack.pop()!)
    if (!node || node.type !== 'variable') continue
    for (const b of node.branches) {
      if (b.nextNodeId && ids.has(b.nextNodeId) && !seen.has(b.nextNodeId)) {
        seen.add(b.nextNodeId)
        stack.push(b.nextNodeId)
      }
    }
  }
  return seen
}

/** Nodes from which a specialist/escalation endpoint is reachable. */
function canReachTerminal(nodes: TreeNode[]): Set<string> {
  const ids = new Set(nodes.map((n) => n.id))
  // Reverse adjacency: target -> sources that point at it.
  const reverse = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.type !== 'variable') continue
    for (const b of n.branches) {
      if (!b.nextNodeId || !ids.has(b.nextNodeId)) continue
      const list = reverse.get(b.nextNodeId) ?? []
      list.push(n.id)
      reverse.set(b.nextNodeId, list)
    }
  }
  const seen = new Set<string>()
  const stack: string[] = []
  for (const n of nodes) {
    if (n.type === 'specialist' || n.type === 'escalation') {
      seen.add(n.id)
      stack.push(n.id)
    }
  }
  while (stack.length) {
    const cur = stack.pop()!
    for (const src of reverse.get(cur) ?? []) {
      if (!seen.has(src)) {
        seen.add(src)
        stack.push(src)
      }
    }
  }
  return seen
}

/** Produce gentle, non-blocking warnings about the tree's structure. */
export function validateTreeGraph(tree: Tree): TreeWarning[] {
  const warnings: TreeWarning[] = []
  const { nodes } = tree

  if (nodes.length === 0) {
    return [{ id: 'empty', message: 'The canvas is empty — there is nothing to route.' }]
  }

  const ids = new Set(nodes.map((n) => n.id))
  if (!ids.has(tree.rootNodeId)) {
    warnings.push({ id: 'no-root', message: 'No start node — the tree has no entry point.' })
  }

  const reachable = forwardReachable(nodes, tree.rootNodeId)
  const reachesTerminal = canReachTerminal(nodes)

  for (const node of nodes) {
    const name = nodeDisplayName(node)

    if (node.type === 'variable') {
      if (node.branches.length === 0) {
        warnings.push({
          id: `no-buckets-${node.id}`,
          message: `Variable “${name}” has no buckets, so it can't route anywhere.`,
        })
      }
      node.branches.forEach((b, i) => {
        if (!b.nextNodeId || !ids.has(b.nextNodeId)) {
          warnings.push({
            id: `dangling-${node.id}-${i}`,
            message: `Bucket “${b.label || `#${i + 1}`}” on “${name}” has no destination.`,
          })
        }
      })
    }

    // Unreachable: not the root, and can't be reached from it.
    if (node.id !== tree.rootNodeId && !reachable.has(node.id)) {
      warnings.push({
        id: `unreachable-${node.id}`,
        message: `“${name}” is unreachable from the start node.`,
      })
    }

    // A reachable variable node that can never arrive at an endpoint.
    if (node.type === 'variable' && reachable.has(node.id) && !reachesTerminal.has(node.id)) {
      warnings.push({
        id: `no-terminal-${node.id}`,
        message: `A path through “${name}” never reaches a specialist or escalation.`,
      })
    }
  }

  return warnings
}
