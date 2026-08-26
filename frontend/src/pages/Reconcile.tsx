import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tree } from '../types/tree'
import { fetchSpecialists, fetchTrees, type TreeSummary } from '../lib/api'
import {
  createDeltas,
  deleteDelta,
  fetchTreeBase,
  listDeltas,
  rebaseTree,
  reconcileTree,
  type DeltaDraft,
} from '../lib/deltas/api'
import { compile, type BaseTreeInput } from '../lib/deltas/compile'
import { baseTreeHash, type ResolveContext } from '../lib/deltas/resolve'
import type { Delta, DeltaOp, DeltaResult } from '../lib/deltas/schema'
import { listCases } from '../lib/genApi'
import type { GenCase } from '../lib/generator/types'
import type { FlowInput, RosterEntry } from '../lib/reconcile/types'
import SetupFlow from '../components/reconcile/flow/SetupFlow'
import ReconcileChat from '../components/reconcile/ReconcileChat'
import { describeDeltas } from '../lib/deltas/describe'
import { publishTree } from '../lib/api'

/**
 * Blume — the clinic setup session: guideline draft → how this clinic works.
 *
 * The surgeon reviews and corrects; the surgeon never constructs. It is an
 * INTERVIEW — one question per screen, every one answerable in a single click
 * by keeping the guideline, with an explicit beginning and an explicit end.
 * `SetupFlow` owns that flow entirely.
 *
 * This page owns the DATA and nothing else: loading the guideline draft,
 * compiling clinic decisions onto it with lib/deltas/compile, saving through
 * /reconcile, and signing off. Edits are recorded as DELTAS (semantic,
 * replayable clinic decisions) exactly as before — the delta model, the
 * engine, and the tree schema are untouched by the rework.
 */

const OPEN_KEY = 'omari:reconcileTreeId'

/** Base metadata → resolve context inputs (single doc or {docs:[…]} shape). */
function parseBaseMeta(baseMeta: unknown): {
  docs: Record<string, string>
  subspecialty: string | null
  documentName: string | null
} {
  const metas: Array<{ docId?: string; documentName?: string; subspecialty?: string }> = Array.isArray(
    (baseMeta as any)?.docs,
  )
    ? (baseMeta as any).docs
    : baseMeta
      ? [baseMeta as any]
      : []
  const docs: Record<string, string> = {}
  for (const m of metas) {
    if (m.documentName && m.docId) docs[m.documentName] = m.docId
  }
  return {
    docs,
    subspecialty: metas.find((m) => m.subspecialty)?.subspecialty ?? null,
    documentName: metas.find((m) => m.documentName)?.documentName ?? null,
  }
}

interface LoadedTree {
  treeId: string
  name: string
  documentName: string | null
  base: BaseTreeInput
  ctx: ResolveContext
  baseHash: string
  subspecialty: string | null
}

export default function Reconcile({ onOpenBuilder }: { onOpenBuilder: () => void }) {
  const [loaded, setLoaded] = useState<LoadedTree | null>(null)
  const [deltas, setDeltas] = useState<Delta[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [cases, setCases] = useState<GenCase[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerTrees, setPickerTrees] = useState<TreeSummary[] | null>(null)
  const [published, setPublished] = useState<string | null>(null)

  /* ---------------- Loading ---------------- */

  const openTree = useCallback(async (treeId: string, name: string) => {
    setError(null)
    setBusy(true)
    try {
      const { baseTree, baseMeta } = await fetchTreeBase(treeId)
      if (!baseTree) {
        setError(
          'This guideline has no draft stored — it predates the current setup flow. Open it in the Builder instead.',
        )
        return
      }
      const base = baseTree as BaseTreeInput
      const { docs, subspecialty, documentName } = parseBaseMeta(baseMeta)
      const treeDeltas = await listDeltas(treeId)
      setLoaded({
        treeId,
        name,
        documentName,
        base,
        ctx: { docs },
        baseHash: baseTreeHash(compile(base, []).tree),
        subspecialty,
      })
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

  // Example referrals are fetched the moment a guideline opens, so the
  // "check it against real patients" section already has them by the time
  // anyone reaches it — no empty screen with a "generate" button on it.
  useEffect(() => {
    if (!loaded?.subspecialty) {
      setCases([])
      return
    }
    let cancelled = false
    listCases(loaded.subspecialty)
      .then((rows) => {
        if (!cancelled) setCases(rows)
      })
      .catch(() => {
        if (!cancelled) setCases([])
      })
    return () => {
      cancelled = true
    }
  }, [loaded?.subspecialty])

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
      if (!loaded || drafts.length === 0) return
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

  /* ---------------- Rebase: updated guideline, decisions replay ---------------- */

  const handleRebaseFile = useCallback(
    async (file: File) => {
      if (!loaded) return
      setBusy(true)
      setError(null)
      try {
        await rebaseTree(loaded.treeId, file)
        // Reload the fresh base, replay ALL decisions against it, and persist
        // the compiled result + per-decision verdicts in one pass — stale ones
        // surface for re-review, never dropped.
        const { baseTree, baseMeta } = await fetchTreeBase(loaded.treeId)
        const base = baseTree as BaseTreeInput
        const { docs, subspecialty, documentName } = parseBaseMeta(baseMeta)
        const ctx = { docs }
        const baseHash = baseTreeHash(compile(base, []).tree)
        const ds = await listDeltas(loaded.treeId)
        const out = compile(base, ds, { ctx })
        await reconcileTree(loaded.treeId, out.tree, out.results, { baseHash })
        setLoaded({ ...loaded, base, ctx, baseHash, subspecialty, documentName })
        setDeltas(await listDeltas(loaded.treeId))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [loaded],
  )

  /* ---------------- Freeform (Sprout) & sign-off ---------------- */

  const handleChatApply = useCallback(
    (payloads: DeltaOp[]) => {
      void addDeltas(
        payloads.map((payload) => ({
          payload,
          provenance: { author: '', rationale: '', deviatesFromCpg: false, sessionStage: 'freeform' as const },
        })),
      )
    },
    [addDeltas],
  )

  const handleSignOff = useCallback(
    async (signedBy: string) => {
      if (!loaded || !compiled) return
      setBusy(true)
      setError(null)
      try {
        const appliedIds = compiled.results.filter((r) => r.status === 'applied').map((r) => r.deltaId)
        const version = await publishTree(loaded.treeId, {
          signedBy,
          validationSummary: {
            appliedDeltaIds: appliedIds,
            baseHash: loaded.baseHash,
            deviationRegister: describeDeltas(deltas.filter((d) => appliedIds.includes(d.id))),
            deviationCount: deltas.filter((d) => appliedIds.includes(d.id) && d.provenance.deviatesFromCpg)
              .length,
          },
        })
        setPublished(`Signed and live — version ${version.version_no}.`)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [loaded, compiled, deltas],
  )

  const flowInput: FlowInput | null = useMemo(
    () =>
      compiled && loaded
        ? { tree: compiled.tree, roster, subspecialty: loaded.subspecialty, cases }
        : null,
    [compiled, loaded, roster, cases],
  )

  /* ---------------- Render ---------------- */

  if (!loaded) {
    return (
      /* Reached directly at /admin/generate/setup — open with the draft picker
         rather than a title, since there's no longer a step nav above it. */
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
        <h2 className="font-display text-[14px] font-semibold text-ink">
          Which guideline are you setting up?
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          Pick a draft, and tell us where your clinic differs from it.
        </p>
        {error && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}
        <ul className="mt-5 space-y-2">
          {(pickerTrees ?? []).map((t) => (
            <li key={t.id}>
              <button
                onClick={() => void openTree(t.id, t.name)}
                disabled={busy}
                className="w-full rounded-lg border border-line bg-canvas px-4 py-3 text-left hover:border-accent/60 disabled:opacity-50"
              >
                <span className="block text-[13.5px] font-medium text-ink">{t.name}</span>
                <span className="mt-0.5 block text-[11.5px] text-muted">
                  v{t.version} · updated {new Date(t.updated_at).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
          {pickerTrees?.length === 0 && (
            <p className="text-[13px] text-muted">
              Nothing here yet — draft one from a guideline in step 1 first.
            </p>
          )}
        </ul>
        </div>
      </div>
    )
  }

  const guidelineName = loaded.documentName ?? loaded.name

  const menu = (
    <div className="flex items-center gap-3">
      <label
        className={`cursor-pointer text-[13px] text-muted hover:text-ink ${busy ? 'pointer-events-none opacity-50' : ''}`}
        title="Upload a newer version of the guideline — your clinic's answers carry over"
      >
        Update the guideline
        <input
          type="file"
          accept=".pdf,.txt,.epub"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void handleRebaseFile(f)
          }}
        />
      </label>
      <button
        onClick={() => {
          localStorage.setItem('omari:builderOpenTreeId', loaded.treeId)
          onOpenBuilder()
        }}
        className="text-[13px] text-muted hover:text-ink"
      >
        See the whole picture
      </button>
      <button
        onClick={() => {
          localStorage.removeItem(OPEN_KEY)
          setLoaded(null)
          setDeltas([])
          setPublished(null)
        }}
        className="text-[13px] text-muted hover:text-ink"
      >
        Switch guideline
      </button>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline gap-3 border-b border-line bg-canvas px-5 py-2.5">
        <h1 className="truncate font-serif text-[15px] font-semibold text-ink">{guidelineName}</h1>
        <span className="shrink-0 rounded bg-line/60 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">
          Draft — not live
        </span>
      </div>

      {(error || compileError) && (
        <div className="border-b border-danger/30 bg-danger/5 px-5 py-2 text-[12.5px] text-danger">
          {error ?? compileError}
          {error && (
            <button className="ml-3 underline" onClick={() => setError(null)}>
              dismiss
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {flowInput && (
          <SetupFlow
            treeId={loaded.treeId}
            guidelineName={guidelineName}
            input={flowInput}
            busy={busy}
            deltas={deltas}
            results={compiled?.results ?? []}
            onAddDeltas={(drafts) => void addDeltas(drafts)}
            onUndoDelta={(id) => void undoDelta(id)}
            onSignOff={(signedBy) => void handleSignOff(signedBy)}
            menu={menu}
          />
        )}
      </div>

      {compiled && <ReconcileChat tree={compiled.tree} busy={busy} onApply={handleChatApply} />}

      {published && (
        <div className="fixed bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-[13px] font-medium text-accent-strong shadow-lg">
          {published}
          <button className="ml-3 text-muted hover:text-ink" onClick={() => setPublished(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
