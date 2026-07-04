import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodes,
  useNodesState,
  useReactFlow,
  useStore,
  useViewport,
  type Connection,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { sampleTree } from '../data/sampleTree'
import { dukeNerveTree } from '../data/dukeNerveTree'
import { fetchTrees, fetchTree } from '../lib/api'
import {
  createTreeNode,
  deriveEdges,
  layoutGraph,
  layoutWithDagre,
  nodeDisplayName,
  NODE_WIDTH,
  treeToFlowNodes,
  type BuilderEdgeData,
  type BuilderFlowNode,
  type NodeKind,
} from '../lib/treeToFlow'
import { TreeSchema, type Node as TreeNode, type Tree } from '../types/tree'
import { flowNodesToTree, validateTreeGraph, type TreeWarning } from '../lib/buildTree'
import { useTreeStore } from '../store/treeStore'
import VariableNodeCard from '../components/nodes/VariableNodeCard'
import SpecialistNodeCard from '../components/nodes/SpecialistNodeCard'
import EscalationNodeCard from '../components/nodes/EscalationNodeCard'
import BucketEdge from '../components/edges/BucketEdge'
import EditorPanel from '../components/EditorPanel'
import BuilderActionsContext from '../components/BuilderActionsContext'

const nodeTypes = {
  variable: VariableNodeCard,
  specialist: SpecialistNodeCard,
  escalation: EscalationNodeCard,
}

const edgeTypes = {
  bucket: BucketEdge,
}

// Minimap dot colours mirror the node accent tokens.
const MINIMAP_COLORS: Record<string, string> = {
  variable: '#2563EB',
  specialist: '#4B9CD3',
  escalation: '#6CB4EE',
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const DRAG_MIME = 'application/blume-node-kind'

const PALETTE: { kind: NodeKind; label: string; dot: string; hint: string }[] = [
  { kind: 'variable', label: 'Variable', dot: 'bg-nodevar', hint: 'A decision / question' },
  { kind: 'specialist', label: 'Specialist', dot: 'bg-nodespec', hint: 'A routing endpoint' },
  { kind: 'escalation', label: 'Escalation', dot: 'bg-nodeesc', hint: 'Human review' },
]

function isNodeKind(value: string): value is NodeKind {
  return value === 'variable' || value === 'specialist' || value === 'escalation'
}

/** Set of node ids reachable from `rootId` by following branch wiring. */
function reachableFrom(nodes: BuilderFlowNode[], rootId: string): Set<string> {
  const ids = new Set(nodes.map((n) => n.id))
  const adjacency = new Map<string, string[]>()
  for (const n of nodes) {
    const tn = n.data.treeNode
    const outs =
      tn.type === 'variable'
        ? tn.branches.map((b) => b.nextNodeId).filter((t) => t && ids.has(t))
        : []
    adjacency.set(n.id, outs)
  }
  const seen = new Set<string>()
  const stack: string[] = []
  if (ids.has(rootId)) {
    seen.add(rootId)
    stack.push(rootId)
  }
  while (stack.length) {
    const cur = stack.pop()!
    for (const next of adjacency.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return seen
}

function labelOf(nodes: BuilderFlowNode[], id: string): string {
  const n = nodes.find((x) => x.id === id)
  return n ? nodeDisplayName(n.data.treeNode) : id
}

/** Adjacency (node id → existing branch-target ids) for the current wiring. */
function buildAdjacency(nodes: BuilderFlowNode[]): Map<string, string[]> {
  const ids = new Set(nodes.map((n) => n.id))
  const adj = new Map<string, string[]>()
  for (const n of nodes) {
    const tn = n.data.treeNode
    const outs =
      tn.type === 'variable'
        ? tn.branches.map((b) => b.nextNodeId).filter((t) => t && ids.has(t))
        : []
    adj.set(n.id, outs)
  }
  return adj
}

/**
 * VIEW-ONLY visibility for expand/collapse. A node is hidden iff it is a
 * descendant cut off by a collapsed node — i.e. reachable from the root in the
 * FULL graph but NOT reachable once we stop descending into collapsed nodes.
 * Shared destinations (our DAG) stay visible if any open path still reaches them,
 * and disconnected / freshly-added nodes (not under the root) are always visible.
 * Never touches tree data — purely decides what the canvas draws.
 */
interface Visibility {
  visibleIds: Set<string>
  hiddenCountByNode: Map<string, number>
  childCount: Map<string, number>
}

function computeVisibility(
  nodes: BuilderFlowNode[],
  rootId: string,
  collapsed: Set<string>,
): Visibility {
  const ids = new Set(nodes.map((n) => n.id))
  const adj = buildAdjacency(nodes)

  const childCount = new Map<string, number>()
  for (const [k, v] of adj) childCount.set(k, new Set(v).size)

  const walk = (stopAtCollapsed: boolean): Set<string> => {
    const seen = new Set<string>()
    if (!ids.has(rootId)) return seen
    const stack = [rootId]
    seen.add(rootId)
    while (stack.length) {
      const cur = stack.pop()!
      if (stopAtCollapsed && collapsed.has(cur)) continue // visible, children hidden
      for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
    }
    return seen
  }

  const visibleFromRoot = walk(true)
  const fullReachable = walk(false)

  const hidden = new Set<string>()
  for (const id of fullReachable) if (!visibleFromRoot.has(id)) hidden.add(id)

  const visibleIds = new Set<string>()
  for (const n of nodes) if (!hidden.has(n.id)) visibleIds.add(n.id)

  // How many descendants each collapsed node is currently hiding (for its badge).
  const hiddenCountByNode = new Map<string, number>()
  for (const c of collapsed) {
    if (!visibleIds.has(c)) continue
    const sub = new Set<string>()
    const stack = [...(adj.get(c) ?? [])]
    while (stack.length) {
      const cur = stack.pop()!
      if (sub.has(cur)) continue
      sub.add(cur)
      for (const nx of adj.get(cur) ?? []) if (!sub.has(nx)) stack.push(nx)
    }
    let count = 0
    for (const s of sub) if (hidden.has(s)) count++
    hiddenCountByNode.set(c, count)
  }

  return { visibleIds, hiddenCountByNode, childCount }
}

/** Nodes on ANY route root → dest (reachable from root AND can reach dest). */
function nodesOnPath(nodes: BuilderFlowNode[], rootId: string, destId: string): Set<string> {
  const ids = new Set(nodes.map((n) => n.id))
  const fwd = buildAdjacency(nodes)
  const rev = new Map<string, string[]>()
  for (const [src, outs] of fwd) for (const t of outs) {
    const arr = rev.get(t)
    if (arr) arr.push(src)
    else rev.set(t, [src])
  }
  const reach = (adj: Map<string, string[]>, start: string): Set<string> => {
    const seen = new Set<string>()
    if (!ids.has(start)) return seen
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const cur = stack.pop()!
      for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
    }
    return seen
  }
  const fromRoot = reach(fwd, rootId)
  const toDest = reach(rev, destId)
  const out = new Set<string>()
  for (const id of fromRoot) if (toDest.has(id)) out.add(id)
  return out
}

/**
 * Default collapse for a freshly loaded tree. Large trees (the Duke tree) open
 * CALM — root + first level visible, every deeper branch collapsed — so the user
 * drills in. Small trees (the simple sample) open fully expanded. Returns the set
 * of node ids to collapse (depth ≥ 1 nodes that have children).
 */
function defaultCollapsedFor(nodes: BuilderFlowNode[], rootId: string): Set<string> {
  const collapsed = new Set<string>()
  if (nodes.length <= 14) return collapsed // small tree → fully expanded
  const adj = buildAdjacency(nodes)
  const ids = new Set(nodes.map((n) => n.id))
  if (!ids.has(rootId)) return collapsed
  // BFS depth from root; collapse any node at depth ≥ 1 that has children.
  const depth = new Map<string, number>([[rootId, 0]])
  const queue = [rootId]
  while (queue.length) {
    const cur = queue.shift()!
    const d = depth.get(cur)!
    for (const nx of adj.get(cur) ?? []) {
      if (!depth.has(nx)) { depth.set(nx, d + 1); queue.push(nx) }
    }
  }
  for (const [id, d] of depth) {
    if (d >= 1 && (adj.get(id)?.length ?? 0) > 0) collapsed.add(id)
  }
  return collapsed
}

interface SelectedEdge {
  id: string
  source: string
  branchIndex: number
}

/** A routing endpoint shown in the Path Explorer (specialist or escalation). */
interface Destination {
  id: string
  kind: 'specialist' | 'escalation'
  primary: string
  secondary: string
}

function BuilderCanvas() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const addCascade = useRef(0)

  const initialNodes = useMemo(() => {
    const nodes = treeToFlowNodes(sampleTree)
    return layoutWithDagre(nodes, deriveEdges(nodes))
  }, [])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null)
  // Transient hover targets that drive single-path isolation (highlight + dim).
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [hoveredBucket, setHoveredBucket] = useState<{ nodeId: string; branchIndex: number } | null>(
    null,
  )
  // Path Explorer: a pinned destination whose ALL routes-from-root are traced.
  // View-only — never edits the tree or opens the editor.
  const [tracedDestId, setTracedDestId] = useState<string | null>(null)
  // VIEW-ONLY expand/collapse: ids whose downstream subtree is hidden on the
  // canvas. Never persisted, never read by the engine/Runner — the saved tree is
  // always the full tree regardless of what's collapsed here.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saveResult, setSaveResult] = useState<{
    ok: boolean
    warnings: TreeWarning[]
  } | null>(null)
  const { fitView, screenToFlowPosition } = useReactFlow()
  const { saveTree } = useTreeStore()
  
  const [dbTrees, setDbTrees] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetchTrees().then(setDbTrees).catch(console.error)
  }, [])

  // Keep a ref to the latest nodes for event handlers (keydown) that must read
  // current state without being re-bound on every change.
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  // Latest collapse set for async layout / event handlers without re-binding.
  const collapsedRef = useRef(collapsed)
  useEffect(() => {
    collapsedRef.current = collapsed
  }, [collapsed])

  // Which tree is currently loaded on the canvas (drives save id/root + the
  // top-bar tag). Starts as the simple sample; the load buttons swap it.
  const [activeMeta, setActiveMeta] = useState({
    treeId: sampleTree.treeId,
    rootNodeId: sampleTree.rootNodeId,
  })
  // Latest root id for event handlers that must read it without re-binding.
  const rootIdRef = useRef(sampleTree.rootNodeId)
  useEffect(() => {
    rootIdRef.current = activeMeta.rootNodeId
  }, [activeMeta])

  // Which single PATH (if any) to isolate: the most specific hover wins, else the
  // current selection. An isolated path highlights its edge(s) + endpoint nodes
  // and dims everything else. Null → nothing isolated (all calm).
  const focus = useMemo(() => {
    // Resolve the focal target by precedence: a transient hover wins, then the
    // pinned traced destination (Path Explorer), then the current selection.
    let edgeId: string | null = null
    let nodeId: string | null = null
    let destId: string | null = null
    if (hoveredEdgeId) edgeId = hoveredEdgeId
    else if (hoveredBucket) {
      const n = nodes.find((x) => x.id === hoveredBucket.nodeId)
      const tn = n?.data.treeNode
      const branch = tn?.type === 'variable' ? tn.branches[hoveredBucket.branchIndex] : undefined
      if (branch?.nextNodeId) edgeId = `${hoveredBucket.nodeId}__b${hoveredBucket.branchIndex}__${branch.nextNodeId}`
    } else if (hoveredNodeId) nodeId = hoveredNodeId
    else if (tracedDestId) destId = tracedDestId
    else if (selectedEdge) edgeId = selectedEdge.id
    else if (selectedId) nodeId = selectedId
    if (!edgeId && !nodeId && !destId) return null

    // Edge descriptors (id → source/target) for the current wiring.
    const ids = new Set(nodes.map((n) => n.id))
    const descs: { id: string; source: string; target: string }[] = []
    const fwd = new Map<string, string[]>()
    const rev = new Map<string, string[]>()
    const pushTo = (m: Map<string, string[]>, k: string, v: string) => {
      const arr = m.get(k)
      if (arr) arr.push(v)
      else m.set(k, [v])
    }
    for (const fn of nodes) {
      const tn = fn.data.treeNode
      if (tn.type !== 'variable') continue
      tn.branches.forEach((b, i) => {
        if (b.nextNodeId && ids.has(b.nextNodeId)) {
          descs.push({ id: `${fn.id}__b${i}__${b.nextNodeId}`, source: fn.id, target: b.nextNodeId })
          pushTo(fwd, fn.id, b.nextNodeId)
          pushTo(rev, b.nextNodeId, fn.id)
        }
      })
    }

    const activeEdges = new Set<string>()
    const activeNodes = new Set<string>()
    if (edgeId) {
      const d = descs.find((x) => x.id === edgeId)
      if (d) {
        activeEdges.add(d.id)
        activeNodes.add(d.source)
        activeNodes.add(d.target)
      }
    }
    if (nodeId) {
      activeNodes.add(nodeId)
      for (const d of descs) {
        if (d.source === nodeId || d.target === nodeId) {
          activeEdges.add(d.id)
          activeNodes.add(d.source)
          activeNodes.add(d.target)
        }
      }
    }
    if (destId) {
      // ALL routes root → destId: a node is on a route iff it is reachable from
      // the root AND can reach the destination; an edge u→v iff u is reachable
      // from root and v can reach the destination. Captures EVERY path, not one.
      const reach = (adj: Map<string, string[]>, start: string): Set<string> => {
        const seen = new Set<string>()
        if (!ids.has(start)) return seen
        const stack = [start]
        seen.add(start)
        while (stack.length) {
          const cur = stack.pop()!
          for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
        }
        return seen
      }
      const fromRoot = reach(fwd, activeMeta.rootNodeId)
      const toDest = reach(rev, destId)
      for (const n of fromRoot) if (toDest.has(n)) activeNodes.add(n)
      for (const d of descs) if (fromRoot.has(d.source) && toDest.has(d.target)) activeEdges.add(d.id)
    }
    if (activeEdges.size === 0 && activeNodes.size === 0) return null
    return { activeEdges, activeNodes }
  }, [hoveredEdgeId, hoveredBucket, hoveredNodeId, tracedDestId, selectedEdge, selectedId, nodes, activeMeta.rootNodeId])

  // VIEW-ONLY visibility from the collapse set: which nodes/edges the canvas
  // draws. Tree data is untouched — this only decides what's shown.
  const visibility = useMemo(
    () => computeVisibility(nodes, activeMeta.rootNodeId, collapsed),
    [nodes, activeMeta.rootNodeId, collapsed],
  )

  // Edges are DERIVED from branch wiring (selection + isolation state applied),
  // then filtered to the visible subgraph (no wires into hidden nodes, and none
  // out of a collapsed node).
  const edges = useMemo(() => {
    const visNodes = nodes.filter((n) => visibility.visibleIds.has(n.id))
    const derived = deriveEdges(visNodes, {
      selectedEdgeId: selectedEdge?.id,
      activeEdgeIds: focus?.activeEdges ?? null,
    })
    return derived.filter((e) => !collapsed.has(e.source))
  }, [nodes, visibility, collapsed, selectedEdge, focus])

  // Nodes for rendering: only the visible ones; dim any not on the isolated path
  // (positions/handles unchanged), and inject the view-only collapse flags the
  // card uses to draw its expand/collapse chevron + hidden-count badge.
  const displayNodes = useMemo(() => {
    const active = focus?.activeNodes ?? null
    return nodes
      .filter((n) => visibility.visibleIds.has(n.id))
      .map((n) => {
        const dim = active ? !active.has(n.id) : false
        const base = (n.className ?? '').replace(/\bomari-node-dim\b/g, '').trim()
        const className = dim ? `${base} omari-node-dim`.trim() : base || undefined
        const view = {
          collapsed: collapsed.has(n.id),
          hasChildren: (visibility.childCount.get(n.id) ?? 0) > 0,
          hiddenCount: visibility.hiddenCountByNode.get(n.id) ?? 0,
        }
        return { ...n, className, data: { ...n.data, view } }
      })
  }, [nodes, focus, visibility, collapsed])

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null

  // Every destination on the current tree (specialists + escalations), derived
  // live so it works for both trees. Specialists first, then escalations.
  const destinations = useMemo<Destination[]>(() => {
    const out: Destination[] = []
    for (const n of nodes) {
      const tn = n.data.treeNode
      if (tn.type === 'specialist')
        out.push({ id: tn.id, kind: 'specialist', primary: tn.specialistName, secondary: tn.specialty })
      else if (tn.type === 'escalation')
        out.push({ id: tn.id, kind: 'escalation', primary: 'Human review', secondary: tn.reason })
    }
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'specialist' ? -1 : 1))
  }, [nodes])

  /**
   * Re-tidy the VISIBLE graph with ELK (Dagre fallback) for a given collapse set,
   * then fit the visible nodes into view. Hidden nodes keep their positions —
   * only what's on screen is laid out, so collapsing/expanding re-tidies cleanly.
   * Layout/positions only: never changes tree data, wiring, or the saved tree.
   */
  const runLayout = useCallback(
    async (collapsedSet: Set<string>, opts?: { fit?: boolean }) => {
      const all = nodesRef.current
      if (all.length === 0) return
      const vis = computeVisibility(all, rootIdRef.current, collapsedSet)
      const visNodes = all.filter((n) => vis.visibleIds.has(n.id))
      // Lay out only edges that are actually drawn (skip wires out of collapsed nodes).
      const layoutEdges = deriveEdges(visNodes).filter((e) => !collapsedSet.has(e.source))
      const { nodes: laid } = await layoutGraph(visNodes, layoutEdges)
      const posById = new Map(laid.map((n) => [n.id, n.position]))
      setNodes((current) =>
        current.map((n) => {
          const p = posById.get(n.id)
          return p ? { ...n, position: p } : n
        }),
      )
      if (opts?.fit !== false) {
        const fitNodes = visNodes.map((n) => ({ id: n.id }))
        window.requestAnimationFrame(() =>
          fitView({
            nodes: fitNodes,
            duration: prefersReducedMotion() ? 0 : 400,
            padding: 0.15,
          }),
        )
      }
    },
    [setNodes, fitView],
  )

  // On mount, refine the initial (Dagre-seeded) sample layout with ELK so the
  // first paint also gets orthogonal routing + crossing minimisation.
  useEffect(() => {
    void runLayout(collapsedRef.current)
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // View-only: pin/unpin a destination to trace its routes. Never edits; clears
  // node/edge selection so the editor doesn't open and the two modes don't mix.
  // When pinning, auto-expand any collapsed nodes ON the traced path so the whole
  // route is visible (re-tidying the layout if that revealed anything).
  const onTraceDest = useCallback(
    (id: string) => {
      setTracedDestId((prev) => {
        const next = prev === id ? null : id
        if (next) {
          const onPath = nodesOnPath(nodesRef.current, rootIdRef.current, next)
          const cur = collapsedRef.current
          const reduced = new Set([...cur].filter((c) => !onPath.has(c)))
          if (reduced.size !== cur.size) {
            setCollapsed(reduced)
            void runLayout(reduced)
          }
        }
        return next
      })
      setSelectedId(null)
      setSelectedEdge(null)
    },
    [runLayout],
  )

  // VIEW-ONLY expand/collapse of a node's subtree, then re-tidy the visible graph.
  const onToggleCollapse = useCallback(
    (id: string) => {
      const next = new Set(collapsedRef.current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setCollapsed(next)
      void runLayout(next)
    },
    [runLayout],
  )

  // Nice-to-have: frame the traced route(s) once pinned (smooth; instant if
  // reduced-motion). Reads the freshly-computed focus for the active nodes.
  useEffect(() => {
    if (!tracedDestId) return
    const ids = focus?.activeNodes
    if (!ids || ids.size === 0) return
    const fitNodes = [...ids].map((id) => ({ id }))
    window.requestAnimationFrame(() =>
      fitView({ nodes: fitNodes, duration: prefersReducedMotion() ? 0 : 400, padding: 0.25 }),
    )
    // Frame only when the pinned destination changes (not on hover/selection).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracedDestId])

  const updateTreeNode = useCallback(
    (id: string, updater: (node: TreeNode) => TreeNode) => {
      setNodes((current) =>
        current.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, treeNode: updater(n.data.treeNode) } } : n,
        ),
      )
    },
    [setNodes],
  )


  /* --------------------------- Add nodes --------------------------------- */

  const addNode = useCallback(
    (kind: NodeKind, position: { x: number; y: number }) => {
      const treeNode = createTreeNode(kind)
      const flowNode: BuilderFlowNode = {
        id: treeNode.id,
        type: treeNode.type,
        position,
        data: { treeNode },
        selected: true,
      }
      setNodes((current) => [
        ...current.map((n) => (n.selected ? { ...n, selected: false } : n)),
        flowNode,
      ])
      setSelectedId(treeNode.id)
      setSelectedEdge(null)
    },
    [setNodes],
  )

  const addAtCenter = useCallback(
    (kind: NodeKind) => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      const offset = (addCascade.current++ % 6) * 28
      const screen = rect
        ? { x: rect.left + rect.width / 2 + offset, y: rect.top + rect.height / 3 + offset }
        : { x: 240 + offset, y: 160 + offset }
      addNode(kind, screenToFlowPosition(screen))
    },
    [addNode, screenToFlowPosition],
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const kind = event.dataTransfer.getData(DRAG_MIME)
      if (!isNodeKind(kind)) return
      addNode(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    },
    [addNode, screenToFlowPosition],
  )

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  /* --------------------------- Connections ------------------------------- */

  // Answer-driven: a connection writes the target into the SPECIFIC branch the
  // source handle belongs to. The edge then regenerates from that branch.
  const onConnect = useCallback(
    (params: Connection) => {
      const { source, target, sourceHandle } = params
      if (!source || !target || source === target || !sourceHandle) return
      const index = Number(sourceHandle.replace(/^b/, ''))
      if (Number.isNaN(index)) return
      updateTreeNode(source, (n) =>
        n.type === 'variable'
          ? {
              ...n,
              branches: n.branches.map((b, i) =>
                i === index ? { ...b, nextNodeId: target } : b,
              ),
            }
          : n,
      )
    },
    [updateTreeNode],
  )

  // No self-loops (a bucket pointing back at its own node).
  const isValidConnection = useCallback(
    (c: Connection | Edge) => c.source !== c.target,
    [],
  )

  /* ----------------------------- Delete ---------------------------------- */

  const applyRemoval = useCallback(
    (ids: Set<string>) => {
      setNodes((current) =>
        current
          .filter((n) => !ids.has(n.id))
          .map((n) => {
            const tn = n.data.treeNode
            if (tn.type !== 'variable') return n
            // Unwire any bucket that pointed at a deleted node (keep the bucket).
            const branches = tn.branches.map((b) =>
              ids.has(b.nextNodeId) ? { ...b, nextNodeId: '' } : b,
            )
            return { ...n, data: { ...n.data, treeNode: { ...tn, branches } } }
          }),
      )
    },
    [setNodes],
  )

  // Presentation only: fade the node(s) out briefly, then actually remove them.
  const deleteNodes = useCallback(
    (ids: Set<string>) => {
      if (prefersReducedMotion()) {
        applyRemoval(ids)
        return
      }
      setNodes((current) =>
        current.map((n) => (ids.has(n.id) ? { ...n, className: 'omari-leaving' } : n)),
      )
      window.setTimeout(() => applyRemoval(ids), 150)
    },
    [applyRemoval, setNodes],
  )

  const deleteNode = useCallback(
    (id: string) => {
      const current = nodesRef.current
      const before = reachableFrom(current, rootIdRef.current)
      const afterNodes = current.filter((n) => n.id !== id)
      const after = reachableFrom(afterNodes, rootIdRef.current)
      // Orphans: nodes that WERE reachable but are stranded by this deletion.
      const orphans = afterNodes.filter((n) => before.has(n.id) && !after.has(n.id))

      const ids = new Set<string>([id])
      if (orphans.length > 0) {
        const names = orphans.map((o) => `“${labelOf(current, o.id)}”`).join(', ')
        const alsoDelete = window.confirm(
          `Deleting “${labelOf(current, id)}” also strands: ${names}.\n\n` +
            `OK = delete those too.  Cancel = keep them on the canvas (disconnected).`,
        )
        if (alsoDelete) orphans.forEach((o) => ids.add(o.id))
      }

      deleteNodes(ids)
      setSelectedId((prev) => (prev && ids.has(prev) ? null : prev))
      setSelectedEdge(null)
      setTracedDestId((prev) => (prev && ids.has(prev) ? null : prev))
    },
    [deleteNodes],
  )

  const deleteEdge = useCallback(
    (info: SelectedEdge) => {
      updateTreeNode(info.source, (n) =>
        n.type === 'variable'
          ? {
              ...n,
              branches: n.branches.map((b, i) =>
                i === info.branchIndex ? { ...b, nextNodeId: '' } : b,
              ),
            }
          : n,
      )
      setSelectedEdge(null)
    },
    [updateTreeNode],
  )

  // Delete / Backspace removes the selected edge or node — but never while the
  // user is typing in the editor panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return
      }
      if (selectedEdge) {
        e.preventDefault()
        deleteEdge(selectedEdge)
        return
      }
      const selectedNodeId = selectedId ?? nodesRef.current.find((n) => n.selected)?.id ?? null
      if (selectedNodeId) {
        e.preventDefault()
        deleteNode(selectedNodeId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedEdge, selectedId, deleteEdge, deleteNode])

  /* --------------------------- Canvas actions ---------------------------- */

  const onAutoLayout = useCallback(() => {
    void runLayout(collapsedRef.current)
  }, [runLayout])

  // VIEW-ONLY: reveal every collapsed subtree at once, then re-tidy + fit.
  const onExpandAll = useCallback(() => {
    const empty = new Set<string>()
    setCollapsed(empty)
    void runLayout(empty)
  }, [runLayout])

  // VIEW-ONLY: collapse every node that has children (down to the root), then
  // re-tidy + fit. Inverse of Expand all.
  const onCollapseAll = useCallback(() => {
    const adj = buildAdjacency(nodesRef.current)
    const all = new Set<string>()
    for (const [id, outs] of adj) if (outs.length > 0) all.add(id)
    setCollapsed(all)
    void runLayout(all)
  }, [runLayout])

  const onClear = useCallback(() => {
    if (window.confirm('Clear the entire canvas and start over? This cannot be undone.')) {
      setNodes([])
      setSelectedId(null)
      setSelectedEdge(null)
      setTracedDestId(null)
      setCollapsed(new Set())
    }
  }, [setNodes])

  // Load a tree onto the canvas AND make it the active tree for the Runner.
  // Presentation/data only: it just renders an existing validated Tree; the
  // engine and Runner are unchanged. The simple sample stays the safe fallback.
  // Lays out instantly with Dagre, then refines with ELK; large trees open with
  // their deeper branches collapsed (root + first level visible) for a calm start.
  const loadTree = useCallback(
    (tree: Tree) => {
      const flow = treeToFlowNodes(tree)
      const laid = layoutWithDagre(flow, deriveEdges(flow))
      const initCollapsed = defaultCollapsedFor(laid, tree.rootNodeId)
      setNodes(laid)
      nodesRef.current = laid
      setCollapsed(initCollapsed)
      collapsedRef.current = initCollapsed
      setSelectedId(null)
      setSelectedEdge(null)
      setTracedDestId(null)
      setSaveResult(null)
      setActiveMeta({ treeId: tree.treeId, rootNodeId: tree.rootNodeId })
      rootIdRef.current = tree.rootNodeId
      saveTree(tree) // Runner uses whichever tree is currently active
      void runLayout(initCollapsed)
    },
    [setNodes, saveTree, runLayout],
  )
  const loadTreeFromDb = useCallback(
    async (treeId: string) => {
      try {
        const tree = await fetchTree(treeId)
        loadTree(tree)
      } catch (err) {
        console.error('Failed to load tree:', err)
        alert('Failed to load tree from database')
      }
    },
    [loadTree],
  )

  const onLoadSimple = useCallback(() => {
    const t = dbTrees.find(t => t.name === 'Sample Tree')
    if (t) loadTreeFromDb(t.id)
    else loadTree(sampleTree)
  }, [dbTrees, loadTreeFromDb, loadTree])
  
  const onLoadDuke = useCallback(() => {
    const t = dbTrees.find(t => t.name === 'Duke Nerve Tree')
    if (t) loadTreeFromDb(t.id)
    else loadTree(dukeNerveTree)
  }, [dbTrees, loadTreeFromDb, loadTree])

  // Convert the canvas back into a Tree, validate with Zod + soft graph checks,
  // log the serialized schema, and store it for the Runner.
  const onSave = useCallback(() => {
    const tree = flowNodesToTree(nodesRef.current, activeMeta.treeId, rootIdRef.current)
    const warnings = validateTreeGraph(tree)

    const parsed = TreeSchema.safeParse(tree)
    if (!parsed.success) {
      console.error('[Blume] Tree failed Zod validation:', parsed.error.issues)
      setSaveResult({
        ok: false,
        warnings: [
          {
            id: 'zod',
            message: `Schema error: ${parsed.error.issues[0]?.message ?? 'invalid tree'} — not saved.`,
          },
          ...warnings,
        ],
      })
      return
    }

    // Proof it's the real schema, not raw React Flow geometry.
    console.log('[Blume] Saved Tree JSON:\n' + JSON.stringify(parsed.data, null, 2))

    saveTree(parsed.data)
    setSaveResult({ ok: true, warnings })
  }, [saveTree, activeMeta])

  const onBucketHover = useCallback(
    (key: { nodeId: string; branchIndex: number } | null) => setHoveredBucket(key),
    [],
  )
  const actions = useMemo(
    () => ({ deleteNode, onBucketHover, onToggleCollapse }),
    [deleteNode, onBucketHover, onToggleCollapse],
  )

  return (
    <BuilderActionsContext.Provider value={actions}>
      <div className="flex h-full bg-bg">
        <LeftColumn
          onAdd={addAtCenter}
          destinations={destinations}
          tracedDestId={tracedDestId}
          onTraceDest={onTraceDest}
        />

        {/* Canvas region: a document-style toolbar sits above the surface (like
            the toolbar above a page in Word / Google Docs). */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <CanvasToolbar
            onLoadSimple={onLoadSimple}
            onLoadDuke={onLoadDuke}
            onSave={onSave}
            onExpandAll={onExpandAll}
            onCollapseAll={onCollapseAll}
            onAutoLayout={onAutoLayout}
            onClear={onClear}
          />
          <div
            ref={wrapperRef}
            className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] border border-line bg-canvas shadow-[0_1px_2px_rgba(31,36,33,0.04)]"
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_, node) => {
                setSelectedId(node.id)
                setSelectedEdge(null)
                setTracedDestId(null)
              }}
              onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
              onNodeMouseLeave={() => setHoveredNodeId(null)}
              onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
              onEdgeMouseLeave={() => setHoveredEdgeId(null)}
              onEdgeClick={(_, edge) => {
                const d = edge.data as BuilderEdgeData | undefined
                if (d) setSelectedEdge({ id: edge.id, source: d.sourceNodeId, branchIndex: d.branchIndex })
                setSelectedId(null)
                setTracedDestId(null)
              }}
              onPaneClick={() => {
                setSelectedId(null)
                setSelectedEdge(null)
                setTracedDestId(null)
              }}
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.2}
              connectionLineStyle={{ stroke: '#3B82F6', strokeWidth: 2 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#E5EAF1" />
              <Controls showInteractive={false} />
              {/* MiniMap lives in the left column now (see LeftColumn), not here. */}

              {saveResult && (
                <Panel position="bottom-center">
                  <SaveResultBanner
                    result={saveResult}
                    onDismiss={() => setSaveResult(null)}
                  />
                </Panel>
              )}
            </ReactFlow>
          </div>
        </div>

        {selectedNode && (
          <EditorPanel
            key={selectedNode.id}
            treeNode={selectedNode.data.treeNode}
            onUpdate={(updater) => updateTreeNode(selectedNode.id, updater)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </BuilderActionsContext.Provider>
  )
}

/**
 * Self-contained overview minimap for the LEFT COLUMN. React Flow's own
 * <MiniMap> doesn't render reliably outside the <ReactFlow> element, so this
 * draws the whole tree from the live store (useNodes) into a single SVG and
 * overlays the current viewport rectangle (useViewport + store dimensions).
 * Click anywhere to re-center the canvas there. Read-only — no tree changes.
 */
function OverviewMap() {
  const nodes = useNodes()
  const { x: vx, y: vy, zoom } = useViewport()
  const flowW = useStore((s) => s.width)
  const flowH = useStore((s) => s.height)
  const { setCenter } = useReactFlow()

  if (nodes.length === 0) {
    return (
      <div className="grid h-[120px] place-items-center rounded-lg border border-line bg-bg text-[11px] text-muted">
        No nodes yet
      </div>
    )
  }

  const rects = nodes.map((n) => ({
    id: n.id,
    type: n.type ?? '',
    x: n.position.x,
    y: n.position.y,
    w: n.measured?.width ?? NODE_WIDTH,
    h: n.measured?.height ?? 120,
  }))
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  const pad = 60
  const bx = minX - pad
  const by = minY - pad
  const bw = Math.max(maxX - minX + pad * 2, 1)
  const bh = Math.max(maxY - minY + pad * 2, 1)

  // Current viewport rectangle, expressed in flow coordinates.
  const visX = -vx / zoom
  const visY = -vy / zoom
  const visW = (flowW || 1) / zoom
  const visH = (flowH || 1) / zoom

  // Map a click (anywhere on the SVG) to flow coords and re-center the canvas.
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const loc = pt.matrixTransform(ctm.inverse())
    setCenter(loc.x, loc.y, { zoom, duration: prefersReducedMotion() ? 0 : 300 })
  }

  return (
    <svg
      viewBox={`${bx} ${by} ${bw} ${bh}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={onClick}
      className="block w-full cursor-pointer rounded-lg border border-line bg-bg"
      style={{ height: 120 }}
      aria-label="Tree overview"
    >
      {rects.map((r) => (
        <rect
          key={r.id}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={10}
          fill={MINIMAP_COLORS[r.type] ?? '#C9CCC4'}
          fillOpacity={0.9}
        />
      ))}
      <rect
        x={visX}
        y={visY}
        width={visW}
        height={visH}
        rx={2}
        fill="rgba(37,99,235,0.10)"
        stroke="#2563EB"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function LeftColumn({
  onAdd,
  destinations,
  tracedDestId,
  onTraceDest,
}: {
  onAdd: (kind: NodeKind) => void
  destinations: Destination[]
  tracedDestId: string | null
  onTraceDest: (id: string) => void
}) {
  const onDragStart = (event: DragEvent<HTMLDivElement>, kind: NodeKind) => {
    event.dataTransfer.setData(DRAG_MIME, kind)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="omari-enter-side flex w-[260px] shrink-0 flex-col border-r border-line bg-canvas">
      {/* ── Add node ────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pb-2 pt-4">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-accent-strong">
          Add node
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted">
          Drag onto the canvas, or click a row to add.
        </p>
      </div>

      <div className="shrink-0 space-y-1 px-2.5">
        {PALETTE.map((item) => (
          <div
            key={item.kind}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => onDragStart(e, item.kind)}
            onClick={() => onAdd(item.kind)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onAdd(item.kind)
              }
            }}
            className="group flex cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-all duration-150 hover:-translate-y-px hover:border-line hover:bg-sky hover:shadow-sm active:translate-y-0 active:bg-sky active:cursor-grabbing"
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.dot}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[13px] font-medium text-ink">
                {item.label}
              </span>
              <span className="block text-[10.5px] leading-tight text-muted">{item.hint}</span>
            </span>
            <span
              aria-hidden
              className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-accent-strong/40 bg-canvas text-[14px] leading-none text-accent-strong transition-colors group-hover:border-accent-strong group-hover:bg-accent-strong group-hover:text-white"
            >
              +
            </span>
          </div>
        ))}
      </div>

      {/* ── Path Explorer (view-only) ───────────────────────────────────── */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-line pt-3">
        <div className="flex items-center justify-between px-4">
          <p className="font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-accent-strong">
            Trace a path
          </p>
          {tracedDestId && (
            <button
              onClick={() => onTraceDest(tracedDestId)}
              className="rounded text-[10px] font-semibold uppercase tracking-[0.06em] text-accent hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <p className="mt-1 px-4 text-[11px] leading-snug text-muted">
          Click a destination to light up every route patients take to reach it.
        </p>

        <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 pb-2">
          {destinations.length === 0 && (
            <li className="px-2 py-1 text-[11px] text-muted">No destinations in this tree yet.</li>
          )}
          {destinations.map((d) => {
            const active = tracedDestId === d.id
            return (
              <li key={d.id}>
                <button
                  onClick={() => onTraceDest(d.id)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all duration-150 ${
                    active
                      ? 'border-accent bg-sky shadow-sm'
                      : 'border-transparent hover:border-line hover:bg-bg'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      d.kind === 'specialist' ? 'bg-nodespec' : 'bg-nodeesc'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[12px] font-medium ${active ? 'text-accent' : 'text-ink'}`}
                    >
                      {d.primary}
                    </span>
                    <span className="block truncate text-[10.5px] leading-tight text-muted">
                      {d.secondary}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* ── Overview minimap (moved here from the canvas corner) ─────────── */}
      <div className="shrink-0 border-t border-line px-3 pb-4 pt-3">
        <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-accent-strong">
          Overview
        </p>
        <OverviewMap />
      </div>
    </aside>
  )
}

function Builder() {
  return (
    <div className="h-full">
      <ReactFlowProvider>
        <BuilderCanvas />
      </ReactFlowProvider>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Document-style toolbar (above the canvas, à la Word / Google Docs)         */
/* -------------------------------------------------------------------------- */

/** Tiny stroke icon wrapper for the toolbar buttons. */
function TBIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  )
}

/**
 * The Builder's tree actions, grouped into a calm white toolbar that sits just
 * above the canvas. Inverted style: white buttons with a deep-blue outline +
 * label (hover fills a faint blue). Tooltips carry the longer descriptions so
 * the labels can stay short.
 */
function CanvasToolbar({
  onLoadSimple,
  onLoadDuke,
  onSave,
  onExpandAll,
  onCollapseAll,
  onAutoLayout,
  onClear,
}: {
  onLoadSimple: () => void
  onLoadDuke: () => void
  onSave: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onAutoLayout: () => void
  onClear: () => void
}) {
  const btn =
    'inline-flex items-center gap-1.5 rounded-md border border-accent-strong/40 bg-canvas px-2.5 py-1.5 text-[12.5px] font-medium text-accent-strong transition-colors hover:border-accent-strong/70 hover:bg-sky'
  const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-line" aria-hidden />

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-canvas px-2 py-1.5 shadow-[0_1px_2px_rgba(31,36,33,0.04)]">
      <button className={btn} onClick={onLoadSimple} title="Load the simple seeded sample tree">
        <TBIcon>
          <circle cx="12" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="19" r="2" />
          <path d="M12 7v3M12 10l-5 6M12 10l5 6" />
        </TBIcon>
        Sample
      </button>
      <button className={btn} onClick={onLoadDuke} title="Load the deep Duke Nerve Center tree">
        <TBIcon>
          <path d="M12 2 2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </TBIcon>
        Duke
      </button>

      <Divider />

      <button className={btn} onClick={onSave} title="Save this tree">
        <TBIcon>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M17 21v-8H7v8M7 3v5h8" />
        </TBIcon>
        Save
      </button>

      <Divider />

      <button className={btn} onClick={onExpandAll} title="Reveal every collapsed branch at once">
        <TBIcon>
          <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
        </TBIcon>
        Expand all
      </button>
      <button className={btn} onClick={onCollapseAll} title="Collapse every branch down to the root">
        <TBIcon>
          <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3" />
        </TBIcon>
        Collapse all
      </button>
      <button className={btn} onClick={onAutoLayout} title="Auto-layout the tree">
        <TBIcon>
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="11" rx="1" />
        </TBIcon>
        Auto-layout
      </button>

      <Divider />

      <button className={btn} onClick={onClear} title="Clear the canvas and start over">
        <TBIcon>
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </TBIcon>
        Clear
      </button>
    </div>
  )
}

function SaveResultBanner({
  result,
  onDismiss,
}: {
  result: { ok: boolean; warnings: TreeWarning[] }
  onDismiss: () => void
}) {
  const { ok, warnings } = result
  const clean = ok && warnings.length === 0

  const headTone = clean ? 'bg-accent/8' : ok ? 'bg-nodeesc/10' : 'bg-danger/8'
  const textTone = clean ? 'text-accent' : ok ? 'text-nodeesc' : 'text-danger'

  return (
    <div className="mb-3 w-[440px] max-w-[80vw] overflow-hidden rounded-[10px] border border-line bg-canvas shadow-[0_6px_20px_rgba(31,36,33,0.10)]">
      <div className={`flex items-center justify-between px-3 py-2 ${headTone}`}>
        <span className={`font-display text-[12.5px] font-medium ${textTone}`}>
          {clean
            ? 'Saved — tree is valid and stored for the Runner.'
            : ok
              ? `Saved with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`
              : 'Not saved — fix the schema error below.'}
        </span>
        <button
          onClick={onDismiss}
          className="rounded px-1.5 text-muted hover:text-ink"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {warnings.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto px-3 py-2 text-[11.5px] text-muted">
          {warnings.map((w) => (
            <li key={w.id} className="flex gap-1.5">
              <span aria-hidden className="text-nodeesc">
                ⚠
              </span>
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Builder
