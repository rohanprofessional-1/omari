import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node as RFNode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { sampleTree } from '../data/sampleTree'
import {
  createTreeNode,
  deriveEdges,
  layoutWithDagre,
  nodeDisplayName,
  treeToFlowNodes,
  type BuilderEdgeData,
  type BuilderFlowNode,
  type NodeKind,
} from '../lib/treeToFlow'
import { TreeSchema, type Node as TreeNode } from '../types/tree'
import { flowNodesToTree, validateTreeGraph, type TreeWarning } from '../lib/buildTree'
import { useTreeStore } from '../store/treeStore'
import { useBuilderToolbar } from '../components/BuilderToolbarContext'
import VariableNodeCard from '../components/nodes/VariableNodeCard'
import SpecialistNodeCard from '../components/nodes/SpecialistNodeCard'
import EscalationNodeCard from '../components/nodes/EscalationNodeCard'
import EditorPanel from '../components/EditorPanel'
import BuilderActionsContext from '../components/BuilderActionsContext'

const nodeTypes = {
  variable: VariableNodeCard,
  specialist: SpecialistNodeCard,
  escalation: EscalationNodeCard,
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
const ROOT_ID = sampleTree.rootNodeId

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

  // Edges are DERIVED from branch wiring (plus which edge is selected).
  const edges = useMemo(() => deriveEdges(nodes, selectedEdge?.id), [nodes, selectedEdge])

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null

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
      const before = reachableFrom(current, ROOT_ID)
      const afterNodes = current.filter((n) => n.id !== id)
      const after = reachableFrom(afterNodes, ROOT_ID)
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
    }
  }, [setNodes])

  // Convert the canvas back into a Tree, validate with Zod + soft graph checks,
  // log the serialized schema, and store it for the Runner.
  const onSave = useCallback(() => {
    const tree = flowNodesToTree(nodesRef.current, sampleTree.treeId, ROOT_ID)
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
  }, [saveTree])

  // Publish the global actions to the top app bar (and clear on unmount).
  useEffect(() => {
    register({ onSave, onAutoLayout, onClear, treeId: sampleTree.treeId })
    return () => register(null)
  }, [register, onSave, onAutoLayout, onClear])

  const actions = useMemo(() => ({ deleteNode }), [deleteNode])

  return (
    <BuilderActionsContext.Provider value={actions}>
      <div className="flex h-full bg-bg">
        <Palette onAdd={addAtCenter} />

        {/* Canvas region: padded so the warm app background frames the surface. */}
        <div className="min-w-0 flex-1 p-3">
          <div
            ref={wrapperRef}
            className="relative h-full overflow-hidden rounded-[12px] border border-line bg-canvas shadow-[0_1px_2px_rgba(31,36,33,0.04)]"
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={(_, node) => {
                setSelectedId(node.id)
                setSelectedEdge(null)
              }}
              onEdgeClick={(_, edge) => {
                const d = edge.data as BuilderEdgeData | undefined
                if (d) setSelectedEdge({ id: edge.id, source: d.sourceNodeId, branchIndex: d.branchIndex })
                setSelectedId(null)
              }}
              onPaneClick={() => {
                setSelectedId(null)
                setSelectedEdge(null)
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
              <MiniMap
                pannable
                zoomable
                nodeColor={(n: RFNode) => MINIMAP_COLORS[n.type ?? ''] ?? '#C9CCC4'}
                nodeStrokeWidth={2}
                maskColor="rgba(31,36,33,0.06)"
              />

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

function Palette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  const onDragStart = (event: DragEvent<HTMLDivElement>, kind: NodeKind) => {
    event.dataTransfer.setData(DRAG_MIME, kind)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="omari-enter-side flex w-[260px] shrink-0 flex-col border-r border-line bg-canvas">
      <div className="px-4 pb-2 pt-4">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
          Add node
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted">
          Drag onto the canvas, or click a row to add.
        </p>
      </div>

      <div className="space-y-1 px-2.5">
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

      <div className="mt-auto border-t border-line px-4 py-3">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
          How to connect
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          Drag from a bucket's dot to the next node. Select a node or edge and press{' '}
          <kbd className="rounded border border-line bg-bg px-1 font-sans text-[10px] text-ink">
            Delete
          </kbd>{' '}
          to remove it.
        </p>
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
