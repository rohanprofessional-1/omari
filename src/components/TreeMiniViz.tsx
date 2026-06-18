import { useMemo, useState } from 'react'
import dagre from 'dagre'
import { evaluateCondition } from '../lib/engine'
import { confidenceBand, type Extraction, type OrchestratorStep } from '../lib/orchestrator'
import { coreIntakeKeys } from '../lib/escalation'
import { nodeDisplayName } from '../lib/treeToFlow'
import type { FilledVariables, Tree } from '../types/tree'

/**
 * Omari — live decision-tree mini-visualization (DEMO/PRESENTER aid only).
 *
 * Presentation-only: reads the tree the engine is already using + the
 * variables/result the orchestrator already produced, and renders them. It
 * changes NOTHING — no engine, extraction, routing, or intake logic.
 *
 * Reflects the current architecture (intake → decision):
 *   • INTAKE  — core-intake variables light up as answers are captured.
 *   • DECISION — once the engine routes/escalates, the taken PATH is highlighted.
 * It deliberately does NOT depict routing node-by-node during questioning.
 *
 * Gating (visible only in Demo mode AND not Presentation mode) is enforced by
 * the caller — this component is only mounted in the behind-the-scenes panel.
 */

// Builder node colours (kept in sync with the design tokens / Builder cards).
const COLOR = {
  variable: '#2563EB', // --color-nodevar
  specialist: '#4B9CD3', // --color-nodespec
  escalation: '#D08A2C', // --color-nodeesc
  dimEdge: '#CBD5E1',
  takenEdge: '#2563EB',
  line: '#E2E8F0',
  muted: '#64748B',
  ink: '#16202E',
}

const VIEW_KEY = 'omari:treeviz' // remembers path vs tree across the session

type View = 'path' | 'tree'

/** Prettify a camelCase variable key into a short readable label. */
function prettyKey(key: string): string {
  const words = key.replace(/([A-Z])/g, ' $1').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The human branch label for a captured value at a variable (its matching branch). */
function branchLabel(tree: Tree, key: string, value: unknown): string {
  for (const node of tree.nodes) {
    if (node.type !== 'variable' || node.variableKey !== key) continue
    const branch = node.branches.find((b) => evaluateCondition(b.condition, value))
    if (branch) return branch.label
  }
  return String(value)
}

interface VizState {
  litHigh: Set<string> // variable keys captured at high confidence (filled)
  litMed: Set<string> // variable keys captured but unconfirmed (candidates)
  resolved: boolean
  pathSet: Set<string> // node ids on the decided path (only when resolved)
  takenEdges: Set<string> // "source->target" pairs on the decided path
  outcomeId: string | null
}

function deriveVizState(
  filled: FilledVariables,
  candidates: Record<string, Extraction>,
  step: OrchestratorStep | null,
): VizState {
  const resolved = step?.kind === 'route' || step?.kind === 'escalate'
  const path = resolved ? step!.pathTaken : []
  const takenEdges = new Set<string>()
  for (let i = 0; i < path.length - 1; i++) takenEdges.add(`${path[i]}->${path[i + 1]}`)
  return {
    litHigh: new Set(Object.keys(filled)),
    litMed: new Set(Object.keys(candidates)),
    resolved,
    pathSet: new Set(path),
    takenEdges,
    outcomeId: resolved && path.length > 0 ? path[path.length - 1] : null,
  }
}

/* -------------------------------------------------------------------------- */
/* Top-level: header + view toggle + body                                      */
/* -------------------------------------------------------------------------- */

export default function TreeMiniViz({
  tree,
  filled,
  candidates,
  step,
}: {
  tree: Tree
  filled: FilledVariables
  candidates: Record<string, Extraction>
  step: OrchestratorStep | null
}) {
  const [view, setView] = useState<View>(() => {
    try {
      return sessionStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'path'
    } catch {
      return 'path'
    }
  })
  const setAndStore = (v: View) => {
    setView(v)
    try {
      sessionStorage.setItem(VIEW_KEY, v)
    } catch {
      /* ignore */
    }
  }

  const viz = deriveVizState(filled, candidates, step)

  return (
    <div className="rounded-lg border border-line bg-canvas p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Decision tree · live
        </p>
        <div className="inline-flex rounded-md border border-line bg-bg p-0.5">
          {(['path', 'tree'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setAndStore(v)}
              aria-pressed={view === v}
              className={
                'rounded-[5px] px-2 py-0.5 text-[10px] font-medium transition-colors ' +
                (view === v ? 'bg-canvas text-accent shadow-[0_1px_2px_rgba(22,32,46,0.08)]' : 'text-muted hover:text-ink')
              }
            >
              {v === 'path' ? 'Path' : 'Tree'}
            </button>
          ))}
        </div>
      </div>

      {view === 'path' ? (
        <PathStrip tree={tree} filled={filled} candidates={candidates} step={step} viz={viz} />
      ) : (
        <TreeMiniMap tree={tree} viz={viz} />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* PATH STRIP (default) — core-intake chips that fill in, then the outcome      */
/* -------------------------------------------------------------------------- */

function PathStrip({
  tree,
  filled,
  candidates,
  step,
  viz,
}: {
  tree: Tree
  filled: FilledVariables
  candidates: Record<string, Extraction>
  step: OrchestratorStep | null
  viz: VizState
}) {
  const coreKeys = useMemo(() => coreIntakeKeys(tree), [tree])

  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {coreKeys.map((key) => {
        const f = filled[key]
        const c = candidates[key]
        const state: 'high' | 'med' | 'empty' = f ? 'high' : c ? 'med' : 'empty'
        const value = f?.value ?? c?.value
        const confidence = f?.confidence ?? c?.confidence
        return (
          <IntakeChip
            key={key}
            label={prettyKey(key)}
            state={state}
            valueLabel={value !== undefined ? branchLabel(tree, key, value) : undefined}
            confidence={confidence}
          />
        )
      })}
      <span className="self-center text-[10px] text-muted" aria-hidden>
        →
      </span>
      <OutcomeChip step={step} resolved={viz.resolved} />
    </div>
  )
}

function IntakeChip({
  label,
  state,
  valueLabel,
  confidence,
}: {
  label: string
  state: 'high' | 'med' | 'empty'
  valueLabel?: string
  confidence?: number
}) {
  const tone =
    state === 'high'
      ? 'border-accent/40 bg-sky'
      : state === 'med'
        ? 'border-nodeesc/40 bg-nodeesc/5 border-dashed'
        : 'border-line bg-canvas'
  const dot =
    state === 'empty'
      ? 'bg-line'
      : confidence !== undefined && confidenceBand(confidence) === 'high'
        ? 'bg-accent'
        : confidence !== undefined && confidenceBand(confidence) === 'medium'
          ? 'bg-nodeesc'
          : 'bg-danger'
  return (
    <div className={`min-w-[68px] rounded-md border px-2 py-1 transition-colors duration-300 ${tone}`}>
      <div className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="truncate text-[9.5px] font-medium uppercase tracking-wide text-muted">{label}</span>
      </div>
      {valueLabel !== undefined ? (
        // Keyed on the value so it animates in the moment the answer is captured.
        <div key={valueLabel} className="omari-msg mt-0.5">
          <p className="truncate text-[11px] leading-tight text-ink" title={valueLabel}>
            {valueLabel}
          </p>
          {confidence !== undefined && (
            <p className="text-[9px] leading-tight text-muted">
              {Math.round(confidence * 100)}%{state === 'med' ? ' · unconfirmed' : ''}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-0.5 text-[10px] leading-tight text-muted/70">—</p>
      )}
    </div>
  )
}

function OutcomeChip({ step, resolved }: { step: OrchestratorStep | null; resolved: boolean }) {
  if (resolved && step?.kind === 'route') {
    return (
      <div key="routed" className="omari-reveal flex min-w-[88px] flex-col justify-center rounded-md border border-nodespec bg-nodespec/10 px-2 py-1">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-carolina-deep">Routed</span>
        <span className="truncate text-[11px] font-medium leading-tight text-ink" title={step.specialist.specialistName}>
          {step.specialist.specialistName}
        </span>
      </div>
    )
  }
  if (resolved && step?.kind === 'escalate') {
    return (
      <div key="escalated" className="omari-reveal flex min-w-[88px] flex-col justify-center rounded-md border border-nodeesc bg-nodeesc/10 px-2 py-1">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-nodeesc">Escalation</span>
        <span className="truncate text-[11px] font-medium leading-tight text-ink">For clinical review</span>
      </div>
    )
  }
  return (
    <div className="flex min-w-[88px] items-center rounded-md border border-dashed border-line bg-canvas px-2 py-1">
      <span className="text-[10px] text-muted/70">Decision pending…</span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* FULL TREE MINI-MAP — the actual tree, taken path highlighted                */
/* -------------------------------------------------------------------------- */

interface MiniNode {
  id: string
  cx: number
  cy: number
  type: 'variable' | 'specialist' | 'escalation'
  variableKey?: string
  short: string
  full: string
}
interface MiniEdge {
  id: string
  source: string
  target: string
  x1: number
  y1: number
  x2: number
  y2: number
}

const MINI_W = 56
const MINI_H = 24

function computeMiniLayout(tree: Tree): {
  nodes: MiniNode[]
  edges: MiniEdge[]
  vb: { x: number; y: number; w: number; h: number }
} {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 18, ranksep: 34, marginx: 10, marginy: 10 })

  const ids = new Set(tree.nodes.map((n) => n.id))
  for (const n of tree.nodes) g.setNode(n.id, { width: MINI_W, height: MINI_H })
  const rawEdges: { source: string; target: string }[] = []
  for (const n of tree.nodes) {
    if (n.type !== 'variable') continue
    for (const b of n.branches) {
      if (b.nextNodeId && ids.has(b.nextNodeId)) {
        g.setEdge(n.id, b.nextNodeId)
        rawEdges.push({ source: n.id, target: b.nextNodeId })
      }
    }
  }
  dagre.layout(g)

  const nodes: MiniNode[] = tree.nodes.map((n) => {
    const gn = g.node(n.id)
    const full = nodeDisplayName(n)
    const short =
      n.type === 'specialist'
        ? n.specialistName.replace(/^Dr\.\s*/, '')
        : n.type === 'escalation'
          ? 'Review'
          : prettyKey(n.variableKey)
    return {
      id: n.id,
      cx: gn.x,
      cy: gn.y,
      type: n.type,
      variableKey: n.type === 'variable' ? n.variableKey : undefined,
      short,
      full,
    }
  })

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges: MiniEdge[] = rawEdges.map((e, i) => {
    const a = byId.get(e.source)!
    const b = byId.get(e.target)!
    return { id: `${e.source}->${e.target}-${i}`, source: e.source, target: e.target, x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy }
  })

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.cx - MINI_W / 2)
    minY = Math.min(minY, n.cy - MINI_H / 2)
    maxX = Math.max(maxX, n.cx + MINI_W / 2)
    maxY = Math.max(maxY, n.cy + MINI_H / 2)
  }
  const pad = 6
  return {
    nodes,
    edges,
    vb: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
  }
}

function TreeMiniMap({ tree, viz }: { tree: Tree; viz: VizState }) {
  const { nodes, edges, vb } = useMemo(() => computeMiniLayout(tree), [tree])

  const nodeLit = (n: MiniNode): 'high' | 'med' | 'path' | 'dim' => {
    if (viz.resolved && viz.pathSet.has(n.id)) return 'path'
    if (n.type === 'variable' && n.variableKey) {
      if (viz.litHigh.has(n.variableKey)) return 'high'
      if (viz.litMed.has(n.variableKey)) return 'med'
    }
    return 'dim'
  }

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-line bg-bg/50" style={{ height: 240 }}>
        <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
          {/* edges first (under nodes) */}
          {edges.map((e) => {
            const taken = viz.takenEdges.has(`${e.source}->${e.target}`)
            return (
              <line
                key={e.id}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={taken ? COLOR.takenEdge : COLOR.dimEdge}
                strokeWidth={taken ? 2.4 : 1}
                strokeOpacity={taken ? 0.95 : 0.5}
                className="omari-mini-edge"
              />
            )
          })}
          {/* nodes */}
          {nodes.map((n) => {
            const lit = nodeLit(n)
            const base = COLOR[n.type]
            const isOutcome = viz.outcomeId === n.id
            const fillOpacity = lit === 'dim' ? 0.06 : lit === 'med' ? 0.14 : 0.2
            const strokeOpacity = lit === 'dim' ? 0.35 : 1
            const strokeWidth = isOutcome ? 2.6 : lit === 'dim' ? 1 : 1.8
            return (
              <g key={n.id} className="omari-mini-node">
                <title>{n.full}</title>
                {isOutcome && (
                  <rect
                    x={n.cx - MINI_W / 2 - 3}
                    y={n.cy - MINI_H / 2 - 3}
                    width={MINI_W + 6}
                    height={MINI_H + 6}
                    rx={7}
                    fill="none"
                    stroke={base}
                    strokeOpacity={0.4}
                    strokeWidth={2}
                  />
                )}
                <rect
                  x={n.cx - MINI_W / 2}
                  y={n.cy - MINI_H / 2}
                  width={MINI_W}
                  height={MINI_H}
                  rx={5}
                  fill={base}
                  fillOpacity={fillOpacity}
                  stroke={base}
                  strokeOpacity={strokeOpacity}
                  strokeWidth={strokeWidth}
                  strokeDasharray={lit === 'med' ? '3 2' : undefined}
                />
                <text
                  x={n.cx}
                  y={n.cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={8}
                  fontWeight={lit === 'dim' ? 400 : 600}
                  fill={lit === 'dim' ? COLOR.muted : COLOR.ink}
                  fillOpacity={lit === 'dim' ? 0.55 : 1}
                >
                  {n.short.length > 9 ? n.short.slice(0, 8) + '…' : n.short}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <MiniLegend />
    </div>
  )
}

function MiniLegend() {
  const items: { label: string; color: string }[] = [
    { label: 'Variable', color: COLOR.variable },
    { label: 'Specialist', color: COLOR.specialist },
    { label: 'Escalation', color: COLOR.escalation },
  ]
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1 text-[9px] text-muted">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: it.color, opacity: 0.5 }} aria-hidden />
          {it.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1 text-[9px] text-muted">
        <span className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: COLOR.takenEdge }} aria-hidden />
        Path taken
      </span>
    </div>
  )
}
