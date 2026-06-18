import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
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
import {
  createTreeNode,
  deriveEdges,
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
import { useBuilderToolbar } from '../components/BuilderToolbarContext'
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
  escalation: '#D08A2C',
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
  const [saveResult, setSaveResult] = useState<{
    ok: boolean
    warnings: TreeWarning[]
  } | null>(null)
  const { fitView, screenToFlowPosition } = useReactFlow()
  const { saveTree } = useTreeStore()
  const { register } = useBuilderToolbar()

  // Keep a ref to the latest nodes for event handlers (keydown) that must read
  // current state without being re-bound on every change.
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

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

  // Edges are DERIVED from branch wiring (selection + isolation state applied).
  const edges = useMemo(
    () => deriveEdges(nodes, { selectedEdgeId: selectedEdge?.id, activeEdgeIds: focus?.activeEdges ?? null }),
    [nodes, selectedEdge, focus],
  )

  // Nodes for rendering: dim any node not on the isolated path (handles/positions
  // unchanged — only a className is layered on for the fade).
  const displayNodes = useMemo(() => {
    const active = focus?.activeNodes ?? null
    return nodes.map((n) => {
      const dim = active ? !active.has(n.id) : false
      const base = (n.className ?? '').replace(/\bomari-node-dim\b/g, '').trim()
      const className = dim ? `${base} omari-node-dim`.trim() : base || undefined
      return className === n.className ? n : { ...n, className }
    })
  }, [nodes, focus])

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

  // View-only: pin/unpin a destination to trace its routes. Never edits; clears
  // node/edge selection so the editor doesn't open and the two modes don't mix.
  const onTraceDest = useCallback((id: string) => {
    setTracedDestId((prev) => (prev === id ? null : id))
    setSelectedId(null)
    setSelectedEdge(null)
  }, [])

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
    setNodes((current) =>
      layoutWithDagre(current as BuilderFlowNode[], deriveEdges(current as BuilderFlowNode[])),
    )
    window.requestAnimationFrame(() => fitView({ duration: 400, padding: 0.15 }))
  }, [setNodes, fitView])

  const onClear = useCallback(() => {
    if (window.confirm('Clear the entire canvas and start over? This cannot be undone.')) {
      setNodes([])
      setSelectedId(null)
      setSelectedEdge(null)
      setTracedDestId(null)
    }
  }, [setNodes])

  // Load a tree onto the canvas AND make it the active tree for the Runner.
  // Presentation/data only: it just renders an existing validated Tree; the
  // engine and Runner are unchanged. The simple sample stays the safe fallback.
  const loadTree = useCallback(
    (tree: Tree) => {
      const flow = treeToFlowNodes(tree)
      setNodes(layoutWithDagre(flow, deriveEdges(flow)))
      setSelectedId(null)
      setSelectedEdge(null)
      setTracedDestId(null)
      setSaveResult(null)
      setActiveMeta({ treeId: tree.treeId, rootNodeId: tree.rootNodeId })
      rootIdRef.current = tree.rootNodeId
      saveTree(tree) // Runner uses whichever tree is currently active
      window.requestAnimationFrame(() => fitView({ duration: 400, padding: 0.15 }))
    },
    [setNodes, saveTree, fitView],
  )
  const onLoadSimple = useCallback(() => loadTree(sampleTree), [loadTree])
  const onLoadDuke = useCallback(() => loadTree(dukeNerveTree), [loadTree])

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

  // Publish the global actions to the top app bar (and clear on unmount).
  useEffect(() => {
    register({
      onSave,
      onAutoLayout,
      onClear,
      onLoadSimple,
      onLoadDuke,
      treeId: activeMeta.treeId,
    })
    return () => register(null)
  }, [register, onSave, onAutoLayout, onClear, onLoadSimple, onLoadDuke, activeMeta])

  const onBucketHover = useCallback(
    (key: { nodeId: string; branchIndex: number } | null) => setHoveredBucket(key),
    [],
  )
  const actions = useMemo(() => ({ deleteNode, onBucketHover }), [deleteNode, onBucketHover])

  return (
    <BuilderActionsContext.Provider value={actions}>
      <div className="flex h-full bg-bg">
        <LeftColumn
          onAdd={addAtCenter}
          destinations={destinations}
          tracedDestId={tracedDestId}
          onTraceDest={onTraceDest}
        />

        {/* Canvas region: padded so the warm app background frames the surface. */}
        <div className="min-w-0 flex-1 p-3">
          <div
            ref={wrapperRef}
            className="relative h-full overflow-hidden rounded-[12px] border border-line bg-canvas shadow-[0_1px_2px_rgba(31,36,33,0.04)]"
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
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
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
              className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-line text-[13px] leading-none text-muted transition-colors group-hover:border-accent group-hover:text-accent"
            >
              +
            </span>
          </div>
        ))}
      </div>

      {/* ── Path Explorer (view-only) ───────────────────────────────────── */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-line pt-3">
        <div className="flex items-center justify-between px-4">
          <p className="font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
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
        <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
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
