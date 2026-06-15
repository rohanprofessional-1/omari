import dagre from 'dagre'
import { MarkerType, type Edge, type Node as RFNode } from '@xyflow/react'
import type { Condition, Node as TreeNode, Tree } from '../types/tree'

/**
 * Blume — Tree <-> React Flow conversion, dagre auto-layout, and factories
 * for new nodes.
 *
 * Display-only: turns validated tree nodes (the shared contract) into the
 * nodes and edges React Flow renders. The node `type` is the tree node's
 * `type` ('variable' | 'specialist' | 'escalation'), mapping to a custom card.
 */

/** Data carried on every flow node: the original tree node, untouched. */
export type BuilderNodeData = { treeNode: TreeNode }
export type BuilderFlowNode = RFNode<BuilderNodeData>

export type NodeKind = TreeNode['type']

/** Fixed card width (kept in sync with the cards' Tailwind width). */
export const NODE_WIDTH = 300

/** Estimated render height per node type — used only to space the layout. */
function estimateHeight(node: TreeNode): number {
  switch (node.type) {
    case 'variable':
      return 130 + node.branches.length * 30
    case 'specialist':
      return 170 + node.workup.length * 56
    case 'escalation':
      return 130
  }
}

/** Human-readable summary of a branch condition, for the card/edge labels. */
export function describeCondition(condition: Condition): string {
  switch (condition.op) {
    case 'equals':
      return `= ${String(condition.value)}`
    case 'range': {
      const lo = condition.min ?? '−∞'
      const hi = condition.max ?? '+∞'
      return `${lo} … ${hi}`
    }
    case 'in':
      return `in [${condition.values.join(', ')}]`
  }
}

/** Stable handle id for a given branch index (one output handle per bucket). */
export function branchHandleId(index: number): string {
  return `b${index}`
}

/** Display name for a node, used in edge labels and delete warnings. */
export function nodeDisplayName(node: TreeNode): string {
  switch (node.type) {
    case 'variable':
      return node.variableKey
    case 'specialist':
      return node.specialistName
    case 'escalation':
      return 'Escalation'
  }
}

/** Data we stash on each edge so a selected edge can be traced to its branch. */
export type BuilderEdgeData = { sourceNodeId: string; branchIndex: number }

/**
 * Build a styled React Flow edge for ONE branch of a variable node. The edge
 * originates from that branch's OWN handle (`sourceHandle`), so the connection
 * is permanently tied to a specific answer/bucket.
 */
function makeEdge(
  sourceId: string,
  index: number,
  label: string,
  target: string,
  selected: boolean,
): Edge {
  // Solid blue flow; bright blue when selected, with a subtle animated dash.
  const stroke = selected ? '#3B82F6' : '#2563EB'
  return {
    id: `${sourceId}__b${index}__${target}`,
    source: sourceId,
    sourceHandle: branchHandleId(index),
    target,
    label,
    type: 'smoothstep',
    selected,
    animated: selected,
    data: { sourceNodeId: sourceId, branchIndex: index } satisfies BuilderEdgeData,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: selected ? '#3B82F6' : '#2563EB' },
    style: { stroke, strokeWidth: selected ? 2.5 : 1.6 },
    labelStyle: { fontSize: 11, fill: '#4A4F47', fontWeight: selected ? 600 : 400 },
    labelBgStyle: { fill: '#FFFFFF', fillOpacity: 0.92 },
    labelBgPadding: [5, 3] as [number, number],
    labelBgBorderRadius: 5,
  }
}

/** Convert a Tree into React Flow nodes (positions filled in by layout). */
export function treeToFlowNodes(tree: Tree): BuilderFlowNode[] {
  return tree.nodes.map((treeNode) => ({
    id: treeNode.id,
    type: treeNode.type,
    position: { x: 0, y: 0 },
    data: { treeNode },
  }))
}

/**
 * Derive edges live from the current flow nodes' branches. Edges whose target
 * is empty or points at a non-existent node (e.g. a freshly added bucket) are
 * skipped rather than rendered as dangling lines.
 */
export function deriveEdges(
  nodes: BuilderFlowNode[],
  selectedEdgeId?: string,
): Edge[] {
  const byId = new Map(nodes.map((n) => [n.id, n.data.treeNode]))
  const edges: Edge[] = []
  for (const flowNode of nodes) {
    const treeNode = flowNode.data.treeNode
    if (treeNode.type !== 'variable') continue
    treeNode.branches.forEach((branch, i) => {
      const targetNode = byId.get(branch.nextNodeId)
      if (!branch.nextNodeId || !targetNode) return
      const id = `${treeNode.id}__b${i}__${branch.nextNodeId}`
      const label = `${branch.label} → ${nodeDisplayName(targetNode)}`
      edges.push(makeEdge(treeNode.id, i, label, branch.nextNodeId, id === selectedEdgeId))
    })
  }
  return edges
}

/**
 * Run dagre to produce a tidy top-down arrangement and return the nodes with
 * updated positions. Pure: does not mutate the inputs.
 */
export function layoutWithDagre(
  nodes: BuilderFlowNode[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): BuilderFlowNode[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 70, ranksep: 90, marginx: 20, marginy: 20 })

  for (const node of nodes) {
    g.setNode(node.id, {
      width: NODE_WIDTH,
      height: estimateHeight(node.data.treeNode),
    })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const { x, y, width, height } = g.node(node.id)
    // dagre returns the node centre; React Flow wants the top-left corner.
    return { ...node, position: { x: x - width / 2, y: y - height / 2 } }
  })
}

/* -------------------------------------------------------------------------- */
/* New-node factories                                                         */
/* -------------------------------------------------------------------------- */

/** Reasonably unique id for a freshly created node. */
export function newNodeId(kind: NodeKind): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `node_${kind}_${rand}`
}

/** Create a sensible default tree node of the given kind. */
export function createTreeNode(kind: NodeKind, id: string = newNodeId(kind)): TreeNode {
  switch (kind) {
    case 'variable':
      return {
        id,
        type: 'variable',
        variableKey: 'new_variable',
        prompt: 'New decision — describe what this asks.',
        dataSource: 'patient',
        branches: [
          { label: 'Option A', condition: { op: 'equals', value: 'option_a' }, nextNodeId: '' },
        ],
      }
    case 'specialist':
      return {
        id,
        type: 'specialist',
        specialistName: 'New Specialist',
        specialty: 'Specialty',
        urgency: 'routine',
        reasoningTemplate: 'Routing to {specialistName}.',
        workup: [],
      }
    case 'escalation':
      return {
        id,
        type: 'escalation',
        reason: 'Describe why this case escalates to a human.',
      }
  }
}
