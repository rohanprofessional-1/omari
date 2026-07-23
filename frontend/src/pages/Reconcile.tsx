import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SpecialistNode, Tree, Urgency } from '../types/tree'
import { fetchSpecialists, fetchTrees, type TreeSummary } from '../lib/api'
import {
  createDeltas,
  deleteDelta,
  fetchTreeBase,
  listDeltas,
  reconcileTree,
  type DeltaDraft,
} from '../lib/deltas/api'
import { compile, type BaseTreeInput } from '../lib/deltas/compile'
import { anchorForNode, baseTreeHash, type ResolveContext } from '../lib/deltas/resolve'
import type { Delta, DeltaOp, DeltaResult, NodeAnchor } from '../lib/deltas/schema'
import DeltaList from '../components/reconcile/DeltaList'
import TerminalMappingTable, { type MapTarget, type RosterEntry } from '../components/reconcile/TerminalMappingTable'
import ScopeChecklist, { type ScopeCut } from '../components/reconcile/ScopeChecklist'
import ThresholdQueue, { type ThresholdDecision } from '../components/reconcile/ThresholdQueue'
import WorkupReview, { type WorkupChange } from '../components/reconcile/WorkupReview'

/**
 * Blume — the RECONCILE session: guideline tree → this clinic's tree.
 *
 * The surgeon reviews and corrects; the surgeon never constructs. Every
 * screen presents something to accept, reject, or adjust. Edits are recorded
 * as DELTAS (semantic, replayable clinic decisions), compiled onto the CPG
 * base with lib/deltas/compile, and the compiled tree is saved back through
 * /reconcile — the Builder canvas stays a read-mostly visualization.
 *
 * Stages (60-minute budget): scope → map endpoints → thresholds → workup →
 * validate → gap sweep. This shell ships with "Map endpoints" first — the
 * biggest block of the session.
 */

type Stage = 'map' | 'scope' | 'thresholds' | 'workup' | 'validate' | 'gaps'

const STAGES: Array<{ id: Stage; label: string; ready: boolean }> = [
  { id: 'scope', label: 'Scope', ready: true },
  { id: 'map', label: 'Map endpoints', ready: true },
  { id: 'thresholds', label: 'Thresholds', ready: true },
  { id: 'workup', label: 'Workup', ready: true },
  { id: 'validate', label: 'Validate', ready: false },
  { id: 'gaps', label: 'Gap sweep', ready: false },
]

const OPEN_KEY = 'omari:reconcileTreeId'

interface LoadedTree {
  treeId: string
  name: string
  base: BaseTreeInput
  ctx: ResolveContext
  baseHash: string
}

export default function Reconcile({ onOpenBuilder }: { onOpenBuilder: () => void }) {
  const [loaded, setLoaded] = useState<LoadedTree | null>(null)
  const [deltas, setDeltas] = useState<Delta[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [stage, setStage] = useState<Stage>('map')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerTrees, setPickerTrees] = useState<TreeSummary[] | null>(null)

  /* ---------------- Loading ---------------- */

  const openTree = useCallback(async (treeId: string, name: string) => {
    setError(null)
    setBusy(true)
    try {
      const { baseTree, baseMeta } = await fetchTreeBase(treeId)
      if (!baseTree) {
        setError('This tree has no CPG base stored — it predates the delta layer. Open it in the Builder instead.')
        return
      }
      const base = baseTree as BaseTreeInput
      const metas: Array<{ docId?: string; documentName?: string }> = Array.isArray((baseMeta as any)?.docs)
        ? (baseMeta as any).docs
        : baseMeta
          ? [baseMeta]
          : []
      const docs: Record<string, string> = {}
      for (const m of metas) {
        if (m.documentName && m.docId) docs[m.documentName] = m.docId
      }
      const treeDeltas = await listDeltas(treeId)
      setLoaded({ treeId, name, base, ctx: { docs }, baseHash: baseTreeHash(compile(base, []).tree) })
      setDeltas(treeDeltas)
      localStorage.setItem(OPEN_KEY, treeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    fetchSpecialists()
      .then((rows: Array<{ id: string; name: string; specialty?: string | null; is_active?: boolean }>) =>
        setRoster(rows.filter((r) => r.is_active !== false)),
      )
      .catch(() => setRoster([]))
  }, [])

  useEffect(() => {
    const storedId = localStorage.getItem(OPEN_KEY)
    fetchTrees()
      .then((trees) => {
        setPickerTrees(trees)
        const match = storedId ? trees.find((t) => t.id === storedId) : undefined
        if (match) void openTree(match.id, match.name)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [openTree])

  /* ---------------- Compile (pure, in-memory) ---------------- */

  const compiledState: { compiled: { tree: Tree; results: DeltaResult[] } | null; compileError: string | null } =
    useMemo(() => {
      if (!loaded) return { compiled: null, compileError: null }
      try {
        return { compiled: compile(loaded.base, deltas, { ctx: loaded.ctx }), compileError: null }
      } catch (e) {
        return { compiled: null, compileError: e instanceof Error ? e.message : String(e) }
      }
    }, [loaded, deltas])
  const { compiled, compileError } = compiledState

  /* ---------------- Mutations: add / undo deltas, then persist ---------------- */

  /** Recompile with the given deltas and save compiled tree + verdicts. */
  const persist = useCallback(
    async (nextDeltas: Delta[]) => {
      if (!loaded) return
      const out = compile(loaded.base, nextDeltas, { ctx: loaded.ctx })
      await reconcileTree(loaded.treeId, out.tree, out.results, { baseHash: loaded.baseHash })
      setDeltas(await listDeltas(loaded.treeId))
    },
    [loaded],
  )

  const addDeltas = useCallback(
    async (drafts: DeltaDraft[]) => {
      if (!loaded) return
      setBusy(true)
      setError(null)
      try {
        await createDeltas(loaded.treeId, drafts)
        await persist(await listDeltas(loaded.treeId))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [loaded, persist],
  )

  const undoDelta = useCallback(
    async (deltaId: string) => {
      if (!loaded) return
      setBusy(true)
      setError(null)
      try {
        await deleteDelta(loaded.treeId, deltaId)
        await persist(await listDeltas(loaded.treeId))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [loaded, persist],
  )

  /* ---------------- Stage: terminal mapping ---------------- */

  const terminals: SpecialistNode[] = useMemo(() => {
    if (!compiled) return []
    return compiled.tree.nodes.filter((n): n is SpecialistNode => n.type === 'specialist')
  }, [compiled])

  const handleMap = useCallback(
    (nodes: SpecialistNode[], target: MapTarget, urgency: Urgency | null) => {
      const anchors: NodeAnchor[] = nodes.map((n) => anchorForNode(n))
      const drafts: DeltaDraft[] = []
      // Urgency FIRST (lower seq): it anchors by the pre-bind identity, which
      // is still unique; post-bind several endpoints may share the new name.
      if (urgency && target.kind === 'specialist') {
        drafts.push({
          payload: { op: 'set_urgency', anchors, urgency } satisfies DeltaOp,
          provenance: { author: '', rationale: '', deviatesFromCpg: false, sessionStage: 'mapping' },
        })
      }
      drafts.push({
        payload:
          target.kind === 'specialist'
            ? ({
                op: 'bind_terminal',
                anchors,
                target: {
                  kind: 'specialist',
                  specialistId: target.specialistId,
                  specialistName: target.specialistName!,
                  specialty: target.specialty,
                },
              } satisfies DeltaOp)
            : ({
                op: 'bind_terminal',
                anchors,
                target: { kind: 'escalation', reason: target.reason ?? 'No local specialist' },
              } satisfies DeltaOp),
        provenance: { author: '', rationale: '', deviatesFromCpg: false, sessionStage: 'mapping' },
        specialistId: target.specialistId,
      })
      void addDeltas(drafts)
    },
    [addDeltas],
  )

  /* ---------------- Stage: scope, thresholds, workup ---------------- */

  const handleScope = useCallback(
    (cuts: ScopeCut[]) => {
      void addDeltas(
        cuts.map((cut) => ({
          payload: { op: 'set_scope', branch: cut.anchor, reason: cut.reason } satisfies DeltaOp,
          provenance: { author: '', rationale: cut.reason, deviatesFromCpg: false, sessionStage: 'scope' },
        })),
      )
    },
    [addDeltas],
  )

  const handleThreshold = useCallback(
    (decision: ThresholdDecision) => {
      const answerTypeChange = decision.candidate.kind === 'ambiguous_equals' ? 'string_to_number' : 'none'
      const payload: DeltaOp =
        decision.action === 'replace'
          ? {
              op: 'set_threshold',
              branch: decision.candidate.anchor,
              mode: 'replace',
              replacement: decision.replacement!,
              answerTypeChange,
            }
          : {
              op: 'set_threshold',
              branch: decision.candidate.anchor,
              mode: 'split',
              split: decision.bands!.map((b) => ({ label: b.label, condition: b.condition, target: 'same' as const })),
              answerTypeChange,
            }
      void addDeltas([
        {
          payload,
          provenance: {
            author: '',
            rationale: decision.rationale,
            deviatesFromCpg: decision.deviates,
            cpgBasis: decision.candidate.clinicalBasis,
            sessionStage: 'thresholds',
          },
        },
      ])
    },
    [addDeltas],
  )

  const handleWorkup = useCallback(
    (change: WorkupChange) => {
      const payload: DeltaOp =
        change.kind === 'add'
          ? {
              op: 'add_workup',
              anchor: change.anchor,
              item: {
                name: change.itemName,
                ...(change.protocol ? { protocol: change.protocol } : {}),
                ...(change.rationale ? { rationale: change.rationale } : {}),
              },
              ...(change.when ? { when: change.when, reason: change.rationale ?? '' } : {}),
            }
          : change.kind === 'guard'
            ? { op: 'remove_workup', anchor: change.anchor, itemName: change.itemName, guardInstead: change.when! }
            : { op: 'remove_workup', anchor: change.anchor, itemName: change.itemName }
      void addDeltas([
        {
          payload,
          provenance: { author: '', rationale: change.rationale ?? '', deviatesFromCpg: false, sessionStage: 'workup' },
        },
      ])
    },
    [addDeltas],
  )

  /* ---------------- Render ---------------- */

  if (!loaded) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-serif text-[22px] font-semibold text-ink">Reconcile a guideline tree</h1>
        <p className="mt-1 text-[13px] text-muted">
          Pick a CPG-generated tree to map onto how this clinic actually operates.
        </p>
        {error && <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">{error}</p>}
        <ul className="mt-5 space-y-2">
          {(pickerTrees ?? []).map((t) => (
            <li key={t.id}>
              <button
                onClick={() => void openTree(t.id, t.name)}
                disabled={busy}
                className="w-full rounded-lg border border-line bg-canvas px-4 py-3 text-left hover:border-accent/60 disabled:opacity-50"
              >
                <span className="block text-[13.5px] font-medium text-ink">{t.name}</span>
                <span className="mt-0.5 block text-[11.5px] text-muted">v{t.version} · updated {new Date(t.updated_at).toLocaleDateString()}</span>
              </button>
            </li>
          ))}
          {pickerTrees?.length === 0 && (
            <p className="text-[13px] text-muted">No trees yet — generate one from a guideline first.</p>
          )}
        </ul>
      </div>
    )
  }

  const unmapped = terminals.filter((t) => t.specialistName.startsWith('[Assign')).length

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header + stage stepper */}
        <div className="border-b border-line bg-canvas px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-serif text-[17px] font-semibold text-ink">{loaded.name}</h1>
              <p className="text-[11.5px] text-muted">
                {unmapped === 0 ? 'All endpoints assigned' : `${unmapped} endpoint${unmapped === 1 ? '' : 's'} still need a specialist`}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  localStorage.setItem('omari:builderOpenTreeId', loaded.treeId)
                  onOpenBuilder()
                }}
                className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-ink"
              >
                View in Builder
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem(OPEN_KEY)
                  setLoaded(null)
                  setDeltas([])
                }}
                className="rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-ink"
              >
                Switch tree
              </button>
            </div>
          </div>
          <nav className="mt-2.5 flex gap-1">
            {STAGES.map((s) => (
              <button
                key={s.id}
                onClick={() => s.ready && setStage(s.id)}
                disabled={!s.ready}
                title={s.ready ? undefined : 'Coming in a later step'}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  stage === s.id
                    ? 'bg-accent-strong text-white'
                    : s.ready
                      ? 'text-muted hover:text-ink'
                      : 'cursor-not-allowed text-muted/40'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        {(error || compileError) && (
          <div className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-[12.5px] text-danger">
            {error ?? compileError}
            {error && (
              <button className="ml-3 underline" onClick={() => setError(null)}>
                dismiss
              </button>
            )}
          </div>
        )}

        {compiled &&
          (stage === 'map' ? (
            <TerminalMappingTable terminals={terminals} roster={roster} busy={busy} onMap={handleMap} />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {stage === 'scope' ? (
                <ScopeChecklist tree={compiled.tree} busy={busy} onApply={handleScope} />
              ) : stage === 'thresholds' ? (
                <ThresholdQueue tree={compiled.tree} busy={busy} onDecide={handleThreshold} />
              ) : stage === 'workup' ? (
                <WorkupReview tree={compiled.tree} busy={busy} onChange={handleWorkup} />
              ) : null}
            </div>
          ))}
      </div>

      <DeltaList deltas={deltas} results={compiled?.results ?? []} onUndo={(id) => void undoDelta(id)} busy={busy} />
    </div>
  )
}
