import dagre from 'dagre'
import ELK from 'elkjs/lib/elk.bundled.js'
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

/**
 * View-only collapse state layered onto a node for rendering (never persisted,
 * never read by the engine). Drives the card's expand/collapse chevron + badge.
 */
export type NodeView = {
  collapsed: boolean
  hasChildren: boolean
  hiddenCount: number
}

/** Data carried on every flow node: the original tree node, untouched. */
export type BuilderNodeData = { treeNode: TreeNode; view?: NodeView }
export type BuilderFlowNode = RFNode<BuilderNodeData>

export type NodeKind = TreeNode['type']

/** Fixed card width (kept in sync with the cards' Tailwind width). */
export const NODE_WIDTH = 300

/**
 * Estimated render height per node type — used only to space the layout. These
 * reflect the COMPACT (collapsed) cards: specialist Basis/Workup and variable
 * prompt are hidden behind expanders, so heights no longer scale with workup
 * length. Approximate is fine — dagre only needs it to reserve vertical room.
 */
function estimateHeight(node: TreeNode): number {
  switch (node.type) {
    case 'variable':
      // header + name + Details row + Buckets (visible — they carry the handles).
      return 104 + node.branches.length * 32
    case 'specialist':
      // header + name + specialty + optional confirm flag + collapsed Basis/Workup
      // expander rows (the workup LIST is hidden until expanded).
      return 96 + (node.confirmWithDrLi ? 22 : 0) + (node.clinicalBasis ? 30 : 0) + 30
    case 'escalation':
      return 96
  }
}

// Routing arrows of various flavours (mirrors patientLabel.ts) — used to strip
// the "→ destination/routing" tail off a branch label for a clean edge caption.
const ROUTING_ARROW = /\s*(?:→|⟶|➜|»|->|=>)\s*/

/**
 * The SHORT answer term for an edge caption: the branch label up to any routing
 * arrow ("EMG normal → diagnostics" → "EMG normal"; "Multifocal → systemic
 * workup" → "Multifocal"). Never includes the "→ destination" — the edge already
 * visually goes there. Falls back to the authored patientLabel, then the raw label.
 */
export function shortBranchLabel(branch: { label: string; patientLabel?: string }): string {
  const head = branch.label.split(ROUTING_ARROW)[0].trim()
  return head || branch.patientLabel?.trim() || branch.label
}

/**
 * Calm, harmonious COOL palette (blues / greens / teals / indigos — never a loud
 * rainbow). A variable node's bucket `i` and its outgoing edge both use
 * `edgeColor(i)`, so the start dot and its line share one colour and a single
 * thread can be followed from answer → destination.
 */
export const EDGE_PALETTE = [
  '#2563eb', // blue (accent)
  '#0d9488', // teal
  '#4b9cd3', // carolina blue
  '#1f9d63', // green
  '#6366f1', // indigo
  '#0891b2', // cyan
  '#3b82f6', // bright blue
  '#2e9e5b', // deeper green
  '#5b7fde', // periwinkle
  '#14b8a6', // teal (light)
] as const

export function edgeColor(index: number): string {
  return EDGE_PALETTE[index % EDGE_PALETTE.length]
}

/** Short destination name for the edge's end-cue chip (where the line lands). */
export function nodeShortName(node: TreeNode): string {
  switch (node.type) {
    case 'variable':
      return node.variableKey
    case 'specialist': {
      // Last name reads best on a tiny chip ("Dr. Lisa Hobson-Webb" → "Hobson-Webb").
      const parts = node.specialistName.replace(/^Dr\.?\s+/i, '').trim().split(/\s+/)
      return parts[parts.length - 1] || node.specialistName
    }
    case 'escalation':
      return 'Review'
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

/**
 * Data the custom `bucket` edge renders from: the branch it traces, its per-bucket
 * colour, the short answer caption, the destination's short name (end cue), and
 * the current highlight/dim state (for hover/select path isolation).
 */
export type BuilderEdgeData = {
  sourceNodeId: string
  branchIndex: number
  color: string
  label: string
  targetName: string
  highlighted: boolean
  dimmed: boolean
  // Layer 3 (bundling): when true, this edge braids into a shared "trunk" toward
  // its destination instead of routing independently. `laneOffset` staggers each
  // destination's trunk onto its own vertical lane so different targets don't
  // blur into one ambiguous rope. The edge un-bundles itself when highlighted.
  bundled: boolean
  laneOffset: number
}

/**
 * Build ONE branch edge of a variable node. The edge originates from that
 * branch's OWN handle (`sourceHandle`) and is coloured to match the bucket's
 * start dot. Visual styling lives in the custom `bucket` edge component; here we
 * only set the per-edge data + a colour-matched, state-aware arrowhead.
 */
function makeEdge(
  sourceId: string,
  index: number,
  label: string,
  target: string,
  targetName: string,
  state: { selected: boolean; highlighted: boolean; dimmed: boolean; laneOffset: number },
): Edge {
  const color = edgeColor(index)
  const active = state.highlighted || state.selected
  // A calm resting line gets a soft, desaturated marker so the canvas reads
  // quiet; dimmed (focus elsewhere) is fainter still; active is full colour.
  const markerColor = state.dimmed
    ? 'rgba(100,116,139,0.12)'
    : active
      ? color
      : 'rgba(100,116,139,0.45)'
  const markerSize = active ? 22 : 16
  return {
    id: `${sourceId}__b${index}__${target}`,
    source: sourceId,
    sourceHandle: branchHandleId(index),
    target,
    type: 'bucket',
    selected: state.selected,
    data: {
      sourceNodeId: sourceId,
      branchIndex: index,
      color,
      label,
      targetName,
      highlighted: active,
      dimmed: state.dimmed,
      // Bundle every edge by default; the edge component un-bundles itself when
      // active so a focused thread can be traced individually out of the trunk.
      bundled: !active,
      laneOffset: state.laneOffset,
    } satisfies BuilderEdgeData,
    markerEnd: { type: MarkerType.ArrowClosed, width: markerSize, height: markerSize, color: markerColor },
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
  opts?: { selectedEdgeId?: string; activeEdgeIds?: Set<string> | null },
): Edge[] {
  const selectedEdgeId = opts?.selectedEdgeId
  // When an active set is provided (a path is being isolated), edges IN it are
  // highlighted and all others dimmed. When null, everything renders calmly.
  const activeEdgeIds = opts?.activeEdgeIds ?? null
  const byId = new Map(nodes.map((n) => [n.id, n.data.treeNode]))

  // Per-destination trunk lanes (Layer 3): every edge sharing a target braids
  // through one shared vertical lane just before that target. Give each target a
  // stable, staggered lane offset so adjacent destinations keep distinct trunks
  // rather than smearing into a single ambiguous rope. Order-stable across renders.
  const laneOffsets = new Map<string, number>()
  let laneSeen = 0
  for (const flowNode of nodes) {
    const treeNode = flowNode.data.treeNode
    if (treeNode.type !== 'variable') continue
    for (const branch of treeNode.branches) {
      if (branch.nextNodeId && byId.has(branch.nextNodeId) && !laneOffsets.has(branch.nextNodeId)) {
        // Cycle through a few lane positions (~16px apart) so neighbouring trunks
        // stay visually separate without wandering out of the inter-column gap.
        laneOffsets.set(branch.nextNodeId, (laneSeen % 4) * 16)
        laneSeen++
      }
    }
  }

  const edges: Edge[] = []
  for (const flowNode of nodes) {
    const treeNode = flowNode.data.treeNode
    if (treeNode.type !== 'variable') continue
    treeNode.branches.forEach((branch, i) => {
      const targetNode = byId.get(branch.nextNodeId)
      if (!branch.nextNodeId || !targetNode) return
      const id = `${treeNode.id}__b${i}__${branch.nextNodeId}`
      // Caption shows ONLY the answer term — the edge already goes to the target.
      const label = shortBranchLabel(branch)
      const targetName = nodeShortName(targetNode)
      const selected = id === selectedEdgeId
      const highlighted = activeEdgeIds ? activeEdgeIds.has(id) : false
      const dimmed = activeEdgeIds ? !activeEdgeIds.has(id) : false
      edges.push(
        makeEdge(treeNode.id, i, label, branch.nextNodeId, targetName, {
          selected,
          highlighted,
          dimmed,
          laneOffset: laneOffsets.get(branch.nextNodeId) ?? 0,
        }),
      )
    })
  }
  return edges
}

/**
 * Vertical breathing room (px) added to every node's height before handing it to
 * dagre. dagre reserves space rank-by-rank; padding the heights keeps a clear gap
 * so the long edges it threads between ranks (as dummy nodes) don't get drawn
 * underneath a real card. Directly addresses "nodes sitting on top of wires".
 */
const LAYOUT_VPAD = 26

/**
 * Run dagre to produce a tidy LEFT-TO-RIGHT layered arrangement and return the
 * nodes with updated positions. Pure: does not mutate the inputs.
 *
 * Defaults to 'LR' so the tree reads as a horizontal flowchart — root on the
 * left, each depth in its own vertical column. `ranksep` is the horizontal gap
 * between columns (generous, to leave room for the on-edge captions); `nodesep`
 * is the vertical gap within a column.
 *
 * Quality matters here, so we do three things beyond the defaults:
 *  1. Feed dagre the REAL rendered size of each node (`measured`) when available
 *     instead of a rough estimate — wrong heights are the main reason cards end
 *     up overlapping the wires that route between ranks.
 *  2. Register EVERY parallel edge (not one per source/target pair) so a popular
 *     destination is pulled toward its many sources, which the network-simplex
 *     ordering then uses to minimise crossings.
 *  3. Use the `network-simplex` ranker + `greedy` acyclicer for the tidiest
 *     layering and crossing-reduction dagre offers.
 */
export function layoutWithDagre(
  nodes: BuilderFlowNode[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'LR',
): BuilderFlowNode[] {
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: direction,
    nodesep: 64,
    ranksep: 190,
    edgesep: 28,
    marginx: 32,
    marginy: 32,
    ranker: 'network-simplex',
    acyclicer: 'greedy',
  })

  for (const node of nodes) {
    // Prefer the actual rendered box; fall back to the estimate before first paint.
    const width = node.measured?.width ?? NODE_WIDTH
    const height = (node.measured?.height ?? estimateHeight(node.data.treeNode)) + LAYOUT_VPAD
    g.setNode(node.id, { width, height })
  }
  // Register each edge individually (multigraph) so multiple buckets pointing at
  // the same target each contribute pull, improving ordering for shared targets.
  edges.forEach((edge, i) => {
    g.setEdge(edge.source, edge.target, { weight: 1, minlen: 1 }, `e${i}`)
  })

  dagre.layout(g)

  return nodes.map((node) => {
    const { x, y } = g.node(node.id)
    // dagre centres each node in its padded box; convert back to React Flow's
    // top-left using the node's TRUE size (not the padded one) so the visible
    // card lands centred in the slot dagre reserved for it.
    const width = node.measured?.width ?? NODE_WIDTH
    const height = node.measured?.height ?? estimateHeight(node.data.treeNode)
    return { ...node, position: { x: x - width / 2, y: y - height / 2 } }
  })
}

/* -------------------------------------------------------------------------- */
/* ELK layout (orthogonal routing + crossing minimisation)                    */
/* -------------------------------------------------------------------------- */

// One ELK instance for the whole app (elk.bundled runs on the main thread — fine
// for trees of this size). The layered algorithm with ORTHOGONAL edge routing is
// what React Flow documents for clean, lane-routed, crossing-minimised graphs.
const elk = new ELK()

const ELK_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT', // left-to-right, matching the current orientation
  'elk.edgeRouting': 'ORTHOGONAL', // clean right-angle wires routed in lanes
  // Crossing minimisation + tidy node placement.
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  // Spacing: room between columns (layers) and within them for the wires.
  'elk.spacing.nodeNode': '58',
  'elk.layered.spacing.nodeNodeBetweenLayers': '180',
  'elk.spacing.edgeNode': '34',
  'elk.layered.spacing.edgeNodeBetweenLayers': '44',
  'elk.spacing.edgeEdge': '18',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
}

/**
 * Lay out the graph with ELK's layered algorithm (LR, orthogonal routing,
 * crossing minimisation). Async — ELK resolves a Promise. Returns the nodes with
 * updated top-left positions (ELK and React Flow both use a top-left origin, so
 * no centre-conversion is needed). Pure: does not mutate the inputs.
 */
export async function layoutWithElk(
  nodes: BuilderFlowNode[],
  edges: Edge[],
  direction: 'RIGHT' | 'DOWN' = 'RIGHT',
): Promise<BuilderFlowNode[]> {
  if (nodes.length === 0) return nodes
  const graph = {
    id: 'root',
    layoutOptions: { ...ELK_LAYOUT_OPTIONS, 'elk.direction': direction },
    children: nodes.map((n) => ({
      id: n.id,
      width: n.measured?.width ?? NODE_WIDTH,
      height: n.measured?.height ?? estimateHeight(n.data.treeNode),
    })),
    edges: edges.map((e, i) => ({
      id: e.id || `elk_e${i}`,
      sources: [e.source],
      targets: [e.target],
    })),
  }
  const laid = await elk.layout(graph)
  const byId = new Map((laid.children ?? []).map((c) => [c.id, c]))
  return nodes.map((node) => {
    const c = byId.get(node.id)
    if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') return node
    return { ...node, position: { x: c.x, y: c.y } }
  })
}

/**
 * Lay out with ELK; if ELK throws (or isn't usable), fall back to Dagre so we
 * never ship a broken layout. Reports which engine actually ran so the caller
 * can surface it. Always keeps the left-to-right orientation.
 */
export async function layoutGraph(
  nodes: BuilderFlowNode[],
  edges: Edge[],
): Promise<{ nodes: BuilderFlowNode[]; engine: 'elk' | 'dagre' }> {
  try {
    const laid = await layoutWithElk(nodes, edges, 'RIGHT')
    return { nodes: laid, engine: 'elk' }
  } catch (err) {
    console.warn('[Blume] ELK layout failed — falling back to Dagre.', err)
    return { nodes: layoutWithDagre(nodes, edges, 'LR'), engine: 'dagre' }
  }
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
