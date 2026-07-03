import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Urgency } from '../types/tree'
import TreeMiniViz from '../components/TreeMiniViz'
import { createTreeFull, fetchSpecialists } from '../lib/api'
import {
  createGenSession,
  generateCases,
  listCases,
  submitHighlight,
  listCandidateVariables,
  submitDecision,
  persistRules,
  persistDraft,
  persistGaps,
  persistValidation,
  setGapStatus,
  patchGenSession,
  registerVariableSpecs,
  type GenSession,
  type GenHighlight,
  type PersistedGap,
} from '../lib/genApi'
import {
  induceSkeleton,
  flattenRules,
  assembleTree,
  validateTree,
  detectGaps,
  joinDecidedCases,
  type AssembledDraft,
  type GenCandidateVariable,
  type GenCase,
  type GenDecision,
  type GenRosterEntry,
  type ValidationReport,
} from '../lib/generator'

/**
 * Blume — the tree GENERATOR wizard (the upstream layer everything else is
 * downstream of). Three-layer elicitation:
 *
 *   1. HIGHLIGHT (Layer 1) — the surgeon reacts to realistic cases, marking
 *      what matters and tagging each fact: does it change WHERE the patient
 *      goes, WHAT must be done before the visit, or both?
 *   2. DECIDE (Layer 2) — two questions per case: "where does this patient
 *      go?" and "what must be done before they arrive, or the visit is
 *      wasted?" — plus what they would deliberately NOT order.
 *   3. REVIEW (Layer 3) — deterministic induction assembles a draft tree,
 *      gap detection interrogates it, and validation scores it against the
 *      surgeon's own decisions (routing + workup, reported separately).
 *
 * The surgeon authors; the system drafts; the LLM only writes cases and
 * phrases questions. All induction/assembly/validation is the pure TS in
 * src/lib/generator, persisted stage-by-stage to FastAPI.
 */

type Stage = 'setup' | 'highlight' | 'decide' | 'review'

const AXIS_META: Record<'routing' | 'workup' | 'both', { label: string; cls: string }> = {
  routing: { label: 'Where they go', cls: 'bg-accent/12 text-accent-strong border-accent/30' },
  workup: { label: 'Needed before visit', cls: 'bg-nodespec/12 text-nodespec border-nodespec/30' },
  both: { label: 'Both', cls: 'bg-nodeesc/12 text-nodeesc border-nodeesc/30' },
}

export default function Generate({ onOpenBuilder }: { onOpenBuilder: () => void }) {
  const [stage, setStage] = useState<Stage>('setup')
  const [session, setSession] = useState<GenSession | null>(null)
  const [cases, setCases] = useState<GenCase[]>([])
  const [caseIdx, setCaseIdx] = useState(0)
  const [highlights, setHighlights] = useState<GenHighlight[]>([])
  const [candidates, setCandidates] = useState<GenCandidateVariable[]>([])
  const [decisions, setDecisions] = useState<Record<string, GenDecision>>({})
  const [draft, setDraft] = useState<AssembledDraft | null>(null)
  const [report, setReport] = useState<ValidationReport | null>(null)
  const [gaps, setGaps] = useState<PersistedGap[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshCandidates = useCallback(async (sessionId: string) => {
    try {
      setCandidates(await listCandidateVariables(sessionId))
    } catch {
      /* non-fatal */
    }
  }, [])

  /* ── pipeline: decisions → draft → validation → gaps (all deterministic) ── */
  const buildDraft = useCallback(async () => {
    if (!session) return
    setBusy('Inducing logic from your decisions…')
    setError(null)
    try {
      const decided = joinDecidedCases(cases, Object.values(decisions))
      if (decided.length < 2) throw new Error('Decide at least 2 cases before building a draft.')
      const skeleton = induceSkeleton(decided, { candidateVariables: candidates })
      const assembled = assembleTree(skeleton, {
        subspecialty: session.subspecialty,
        roster: session.roster,
        candidateVariables: candidates,
      })
      const rules = flattenRules(skeleton)
      const validation = validateTree(assembled.tree, decided)
      const findings = detectGaps(assembled, decided, session.roster, validation)

      setBusy('Saving the draft, rules, validation and gaps…')
      await persistRules(session.id, rules)
      await persistDraft(session.id, assembled.tree)
      await persistValidation(session.id, assembled.tree, validation)
      const savedGaps = await persistGaps(session.id, findings)

      setDraft(assembled)
      setReport(validation)
      setGaps(savedGaps)
      setStage('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [session, cases, decisions, candidates])

  /* ── save to library + open in the Builder ── */
  const saveAndOpenBuilder = useCallback(async () => {
    if (!session || !draft) return
    setBusy('Saving to the tree library…')
    try {
      const summary = await createTreeFull(
        `${session.subspecialty} — generated draft`,
        draft.tree,
        { description: `Generated by elicitation session ${session.id} · routing accuracy ${(report ? report.summary.routingAccuracy * 100 : 0).toFixed(0)}%` },
      )
      await registerVariableSpecs(draft.variableSpecs)
      await patchGenSession(session.id, { treeId: summary.id, stage: 'done', status: 'completed' })
      // Handoff: the Builder reads this key on mount and opens the tree.
      localStorage.setItem('omari:builderOpenTreeId', summary.id)
      localStorage.setItem('omari:activeTreeId', summary.id) // Runner picks it up too
      onOpenBuilder()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [session, draft, report, onOpenBuilder])

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-5">
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-strong">
            Tree generator
          </p>
          <h1 className="font-display text-xl font-semibold text-ink">
            {stage === 'setup' && 'Set up the elicitation'}
            {stage === 'highlight' && 'Layer 1 — what matters in these cases?'}
            {stage === 'decide' && 'Layer 2 — decide each case'}
            {stage === 'review' && 'Layer 3 — your draft, interrogated and scored'}
          </h1>
          <StageRail stage={stage} />
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
            {error}
            <button className="ml-3 underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}
        {busy && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-muted">
            <Spinner /> {busy}
          </div>
        )}

        {stage === 'setup' && (
          <SetupStage
            onStarted={(s, cs) => {
              setSession(s)
              setCases(cs)
              setCaseIdx(0)
              setStage('highlight')
            }}
            setBusy={setBusy}
            setError={setError}
          />
        )}

        {stage === 'highlight' && session && (
          <HighlightStage
            session={session}
            cases={cases}
            caseIdx={caseIdx}
            setCaseIdx={setCaseIdx}
            highlights={highlights}
            candidates={candidates}
            onHighlight={async (h) => {
              setHighlights((prev) => [...prev, h])
              await refreshCandidates(session.id)
            }}
            onDone={async () => {
              await patchGenSession(session.id, { stage: 'decide' }).catch(() => undefined)
              setCaseIdx(0)
              setStage('decide')
            }}
            setError={setError}
          />
        )}

        {stage === 'decide' && session && (
          <DecideStage
            session={session}
            cases={cases}
            setCases={setCases}
            caseIdx={caseIdx}
            setCaseIdx={setCaseIdx}
            decisions={decisions}
            setDecisions={setDecisions}
            onBuild={buildDraft}
            setBusy={setBusy}
            setError={setError}
          />
        )}

        {stage === 'review' && session && draft && report && (
          <ReviewStage
            session={session}
            draft={draft}
            report={report}
            gaps={gaps}
            setGaps={setGaps}
            onBack={() => setStage('decide')}
            onRebuild={buildDraft}
            onSave={saveAndOpenBuilder}
          />
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────── stage rail ─────────────────────────────── */

function StageRail({ stage }: { stage: Stage }) {
  const steps: { id: Stage; label: string }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'highlight', label: '1 · Highlight' },
    { id: 'decide', label: '2 · Decide' },
    { id: 'review', label: '3 · Review & validate' },
  ]
  const idx = steps.findIndex((s) => s.id === stage)
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {steps.map((s, i) => (
        <span
          key={s.id}
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            i === idx
              ? 'border-accent-strong bg-accent-strong text-white'
              : i < idx
                ? 'border-accent/40 bg-sky text-accent-strong'
                : 'border-line bg-canvas text-muted'
          }`}
        >
          {s.label}
        </span>
      ))}
    </div>
  )
}

/* ────────────────────────────── setup stage ────────────────────────────── */

function SetupStage({
  onStarted,
  setBusy,
  setError,
}: {
  onStarted: (s: GenSession, cases: GenCase[]) => void
  setBusy: (b: string | null) => void
  setError: (e: string | null) => void
}) {
  const [subspecialty, setSubspecialty] = useState('Peripheral nerve surgery')
  const [surgeonName, setSurgeonName] = useState('')
  const [roster, setRoster] = useState<GenRosterEntry[]>([
    { name: '', specialty: '' },
    { name: '', specialty: '' },
  ])
  const [caseCount, setCaseCount] = useState(6)
  const [useAI, setUseAI] = useState(true)

  const setRosterAt = (i: number, patch: Partial<GenRosterEntry>) =>
    setRoster((r) => r.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  const loadDirectory = async () => {
    try {
      const specialists: any[] = await fetchSpecialists()
      if (specialists.length > 0) {
        setRoster(
          specialists
            .filter((s) => s.is_active !== false)
            .map((s) => ({ name: s.name, specialty: s.specialty ?? '' })),
        )
      } else {
        setError('No specialists in the directory yet — enter your roster below.')
      }
    } catch (e) {
      setError('Could not load the specialist directory.')
    }
  }

  const start = async () => {
    const cleanRoster = roster.filter((r) => r.name.trim())
    if (cleanRoster.length < 2) {
      setError('Add at least two specialists — routing needs somewhere to route.')
      return
    }
    setError(null)
    try {
      setBusy('Starting the session…')
      const session = await createGenSession({
        subspecialty: subspecialty.trim(),
        surgeonName: surgeonName.trim() || undefined,
        roster: cleanRoster,
      })

      // Case supply: reuse the reviewed library for this subspecialty, top up
      // with AI generation when allowed, otherwise require hand-authoring.
      setBusy('Gathering cases…')
      let pool = await listCases(session.subspecialty)
      if (pool.length < caseCount && useAI) {
        setBusy(`Writing ${caseCount - pool.length} synthetic cases (AI, ~30s)…`)
        const fresh = await generateCases({
          subspecialty: session.subspecialty,
          count: caseCount - pool.length,
          roster: cleanRoster,
        })
        pool = [...pool, ...fresh]
      }
      if (pool.length === 0) {
        throw new Error(
          'No cases available — enable AI generation or seed cases via the API (POST /api/v1/gen/cases).',
        )
      }
      onStarted(session, pool.slice(0, caseCount))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const input =
    'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/60 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent-strong/15'

  return (
    <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
      <Card title="Who is authoring, and for what?">
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium text-muted">Subspecialty</span>
          <input className={input} value={subspecialty} onChange={(e) => setSubspecialty(e.target.value)} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium text-muted">Authoring surgeon</span>
          <input className={input} placeholder="Dr. Li" value={surgeonName} onChange={(e) => setSurgeonName(e.target.value)} />
        </label>

        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted">
            Specialist roster — the people patients get routed TO
          </span>
          <button onClick={loadDirectory} className="text-[11px] font-medium text-accent-strong hover:underline">
            Load from directory
          </button>
        </div>
        <div className="space-y-2">
          {roster.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={input}
                placeholder="Dr. Chen"
                value={r.name}
                onChange={(e) => setRosterAt(i, { name: e.target.value })}
              />
              <input
                className={input}
                placeholder="Focus (e.g. entrapment / plexus / tumor)"
                value={r.specialty}
                onChange={(e) => setRosterAt(i, { specialty: e.target.value })}
              />
              <button
                onClick={() => setRoster((rr) => rr.filter((_, j) => j !== i))}
                className="shrink-0 rounded px-2 text-[12px] text-muted hover:bg-danger/10 hover:text-danger"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setRoster((r) => [...r, { name: '', specialty: '' }])}
          className="mt-2 rounded-md border border-dashed border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:border-accent/50 hover:text-accent-strong"
        >
          + Add specialist
        </button>
      </Card>

      <Card title="Case supply">
        <p className="mb-3 text-[12.5px] leading-snug text-muted">
          You'll react to realistic synthetic cases — never a blank canvas. Existing reviewed cases
          for this subspecialty are reused; the rest are written by the case generator and marked
          for your quality review.
        </p>
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium text-muted">How many cases (~5 min each pass)</span>
          <input
            type="range"
            min={3}
            max={12}
            value={caseCount}
            onChange={(e) => setCaseCount(Number(e.target.value))}
            className="w-full accent-[#2c56b8]"
          />
          <span className="text-[12px] font-medium text-ink">{caseCount} cases</span>
        </label>
        <label className="mb-4 flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} className="accent-[#2c56b8]" />
          Generate missing cases with AI
        </label>
        <button
          onClick={start}
          className="w-full rounded-md bg-accent-strong px-3 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#24489c]"
        >
          Start elicitation →
        </button>
      </Card>
    </div>
  )
}

/* ──────────────────────────── highlight stage ──────────────────────────── */

function HighlightStage({
  session,
  cases,
  caseIdx,
  setCaseIdx,
  highlights,
  candidates,
  onHighlight,
  onDone,
  setError,
}: {
  session: GenSession
  cases: GenCase[]
  caseIdx: number
  setCaseIdx: (i: number) => void
  highlights: GenHighlight[]
  candidates: GenCandidateVariable[]
  onHighlight: (h: GenHighlight) => Promise<void>
  onDone: () => void
  setError: (e: string | null) => void
}) {
  const current = cases[caseIdx]
  const narrativeRef = useRef<HTMLDivElement>(null)
  const [pendingSpan, setPendingSpan] = useState<{ text: string; x: number; y: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const caseHighlights = highlights.filter((h) => h.caseId === current?.id)

  const onMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!text || text.length < 2 || !narrativeRef.current?.contains(sel!.anchorNode)) {
      setPendingSpan(null)
      return
    }
    setPendingSpan({ text: text.slice(0, 300), x: e.clientX, y: e.clientY })
  }

  const tag = async (axis: 'routing' | 'workup' | 'both') => {
    if (!pendingSpan || !current) return
    setSubmitting(true)
    try {
      const start = current.narrative.indexOf(pendingSpan.text)
      const h = await submitHighlight({
        sessionId: session.id,
        caseId: current.id,
        spanText: pendingSpan.text,
        spanStart: start >= 0 ? start : undefined,
        spanEnd: start >= 0 ? start + pendingSpan.text.length : undefined,
        axis,
      })
      await onHighlight(h)
      window.getSelection()?.removeAllRanges()
      setPendingSpan(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!current) return null

  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
      <div>
        <Card
          title={`Case ${caseIdx + 1} of ${cases.length}`}
          right={
            current.source === 'generated' && !current.qualityReviewed ? (
              <span className="rounded bg-nodeesc/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-nodeesc">
                AI-written · review as you read
              </span>
            ) : undefined
          }
        >
          <p className="mb-2 text-[12px] leading-snug text-muted">
            Select any phrase that would matter to you, then tag it: does it change{' '}
            <em>where the patient goes</em>, <em>what must be done before the visit</em>, or both?
          </p>
          <div
            ref={narrativeRef}
            onMouseUp={onMouseUp}
            className="whitespace-pre-wrap rounded-lg border border-line bg-canvas px-4 py-3 text-[14px] leading-relaxed text-ink selection:bg-accent/20"
          >
            {current.narrative}
          </div>

          {caseHighlights.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Highlights on this case
              </p>
              <div className="flex flex-wrap gap-1.5">
                {caseHighlights.map((h) => (
                  <span
                    key={h.id}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${AXIS_META[h.axis].cls}`}
                  >
                    “{h.spanText.slice(0, 40)}
                    {h.spanText.length > 40 ? '…' : ''}”
                    {h.mappedVariableKey && (
                      <span className="font-mono text-[9.5px] opacity-70">→ {h.mappedVariableKey}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-2">
            <NavButton disabled={caseIdx === 0} onClick={() => setCaseIdx(caseIdx - 1)}>
              ← Previous
            </NavButton>
            <NavButton disabled={caseIdx >= cases.length - 1} onClick={() => setCaseIdx(caseIdx + 1)}>
              Next case →
            </NavButton>
          </div>
          <button
            onClick={onDone}
            className="rounded-md bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[#24489c]"
          >
            Done highlighting → decide cases
          </button>
        </div>
      </div>

      <Card title={`Vocabulary so far · ${candidates.length} variables`}>
        {candidates.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            Nothing yet — highlight phrases in the case to surface the clinical facts your tree will
            ask about.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {candidates.map((v) => (
              <li key={v.key} className="rounded-md border border-line bg-canvas px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-medium text-ink">{v.key}</span>
                  <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-semibold ${AXIS_META[v.axis].cls}`}>
                    {AXIS_META[v.axis].label}
                  </span>
                  <span className="ml-auto text-[10px] text-muted">×{v.frequency}</span>
                </div>
                {v.valueSamples.length > 0 && (
                  <p className="mt-0.5 truncate text-[10.5px] text-muted">
                    seen: {v.valueSamples.map((s) => String(s)).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pendingSpan && (
        <div
          className="fixed z-50 flex gap-1 rounded-lg border border-line bg-canvas p-1 shadow-[0_10px_30px_rgba(22,32,46,0.18)]"
          style={{ left: Math.min(pendingSpan.x, window.innerWidth - 340), top: pendingSpan.y + 12 }}
        >
          {(['routing', 'workup', 'both'] as const).map((axis) => (
            <button
              key={axis}
              disabled={submitting}
              onClick={() => tag(axis)}
              className={`rounded-md border px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-50 ${AXIS_META[axis].cls}`}
            >
              {AXIS_META[axis].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── decide stage ────────────────────────────── */

function DecideStage({
  session,
  cases,
  setCases,
  caseIdx,
  setCaseIdx,
  decisions,
  setDecisions,
  onBuild,
  setBusy,
  setError,
}: {
  session: GenSession
  cases: GenCase[]
  setCases: (c: GenCase[]) => void
  caseIdx: number
  setCaseIdx: (i: number) => void
  decisions: Record<string, GenDecision>
  setDecisions: (d: Record<string, GenDecision>) => void
  onBuild: () => void
  setBusy: (b: string | null) => void
  setError: (e: string | null) => void
}) {
  const current = cases[caseIdx]
  const existing = current ? decisions[current.id] : undefined

  const [specialist, setSpecialist] = useState<string | null>(null)
  const [escalate, setEscalate] = useState(false)
  const [urgency, setUrgency] = useState<Urgency>('routine')
  const [workup, setWorkup] = useState<{ name: string; protocol: string }[]>([])
  const [wouldNot, setWouldNot] = useState<string[]>([])
  const [wouldNotDraft, setWouldNotDraft] = useState('')
  const [counterfactual, setCounterfactual] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset the form when the case changes (pre-fill from an earlier decision).
  useEffect(() => {
    setSpecialist(existing?.routedSpecialistName ?? null)
    setEscalate(existing?.escalated ?? false)
    setUrgency((existing?.urgency as Urgency) ?? 'routine')
    setWorkup(existing?.workup.map((w) => ({ name: w.name, protocol: w.protocol ?? '' })) ?? [])
    setWouldNot(existing?.wouldNotOrder ?? [])
    setCounterfactual(existing?.workupCounterfactual ?? '')
    setWouldNotDraft('')
  }, [current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const previouslyUsedTests = useMemo(() => {
    const names = new Set<string>()
    for (const d of Object.values(decisions)) for (const w of d.workup) names.add(w.name)
    return [...names].filter((n) => !workup.some((w) => w.name === n))
  }, [decisions, workup])

  const decidedCount = Object.keys(decisions).length
  const allDecided = cases.length > 0 && cases.every((c) => decisions[c.id])

  const save = async (advance: boolean) => {
    if (!current) return
    if (!escalate && !specialist) {
      setError("Pick a specialist or mark the case as needing your own review.")
      return
    }
    setSaving(true)
    setError(null)
    const decision: GenDecision = {
      caseId: current.id,
      routedSpecialistName: escalate ? undefined : (specialist ?? undefined),
      escalated: escalate,
      urgency,
      workup: workup.filter((w) => w.name.trim()).map((w) => ({ name: w.name.trim(), protocol: w.protocol.trim() })),
      workupCounterfactual: counterfactual.trim() || undefined,
      wouldNotOrder: wouldNot,
      caseVariables: {},
    }
    try {
      await submitDecision(session.id, decision)
      setDecisions({ ...decisions, [current.id]: decision })
      if (advance && caseIdx < cases.length - 1) setCaseIdx(caseIdx + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const makeMinimalPairs = async () => {
    if (!current) return
    setBusy('Writing minimal-pair variants (one variable flipped each)…')
    try {
      const fresh = await generateCases({
        subspecialty: session.subspecialty,
        count: 2,
        roster: session.roster,
        minimalPairOf: current.id,
      })
      setCases([...cases, ...fresh])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!current) return null

  const input =
    'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/60 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent-strong/15'

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <div>
        <Card
          title={`Case ${caseIdx + 1} of ${cases.length} · ${decidedCount} decided`}
          right={
            <button onClick={makeMinimalPairs} className="text-[11px] font-medium text-accent-strong hover:underline">
              + minimal pairs of this case
            </button>
          }
        >
          <div className="whitespace-pre-wrap rounded-lg border border-line bg-canvas px-4 py-3 text-[13.5px] leading-relaxed text-ink">
            {current.narrative}
          </div>
          {Object.keys(current.groundTruth).length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-medium text-muted">
                The facts this case establishes (what the tree will learn from)
              </summary>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(current.groundTruth).map(([k, v]) => (
                  <span key={k} className="rounded-full border border-line bg-bg px-2 py-0.5 font-mono text-[10.5px] text-muted">
                    {k} = {String(v)}
                  </span>
                ))}
              </div>
            </details>
          )}
        </Card>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-2">
            <NavButton disabled={caseIdx === 0} onClick={() => setCaseIdx(caseIdx - 1)}>
              ← Previous
            </NavButton>
            <NavButton disabled={caseIdx >= cases.length - 1} onClick={() => setCaseIdx(caseIdx + 1)}>
              Skip →
            </NavButton>
          </div>
          {allDecided && (
            <button
              onClick={onBuild}
              className="rounded-md bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[#24489c]"
            >
              All cases decided — build the draft tree →
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <Card title="1 · Where does this patient go?">
          <div className="flex flex-wrap gap-1.5">
            {session.roster.map((r) => (
              <button
                key={r.name}
                onClick={() => {
                  setSpecialist(r.name)
                  setEscalate(false)
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                  specialist === r.name && !escalate
                    ? 'border-accent-strong bg-sky font-semibold text-accent-strong'
                    : 'border-line bg-canvas text-ink hover:border-accent/50'
                }`}
              >
                {r.name}
                {r.specialty && <span className="block text-[10.5px] font-normal text-muted">{r.specialty}</span>}
              </button>
            ))}
            <button
              onClick={() => {
                setEscalate(true)
                setSpecialist(null)
              }}
              className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${
                escalate
                  ? 'border-nodeesc bg-nodeesc/10 font-semibold text-nodeesc'
                  : 'border-line bg-canvas text-ink hover:border-nodeesc/50'
              }`}
            >
              ⚠ I'd want to see this myself
              <span className="block text-[10.5px] font-normal text-muted">genuine ambiguity → human review</span>
            </button>
          </div>
          {!escalate && (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="text-[11px] font-medium text-muted">How soon:</span>
              {(['routine', 'expedited', 'urgent'] as Urgency[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUrgency(u)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${
                    urgency === u ? 'border-accent-strong bg-sky text-accent-strong' : 'border-line text-muted'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          )}
        </Card>

        {!escalate && (
          <Card title="2 · What must be done BEFORE they arrive?">
            <p className="mb-2 text-[11.5px] leading-snug text-muted">
              …or the first visit is wasted. Name the tests; skip anything you'd only order later.
            </p>
            <div className="space-y-2">
              {workup.map((w, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    className={input}
                    placeholder="Test (e.g. EMG/NCS)"
                    value={w.name}
                    onChange={(e) => setWorkup(workup.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <input
                    className={input}
                    placeholder="Protocol (optional)"
                    value={w.protocol}
                    onChange={(e) => setWorkup(workup.map((x, j) => (j === i ? { ...x, protocol: e.target.value } : x)))}
                  />
                  <button
                    onClick={() => setWorkup(workup.filter((_, j) => j !== i))}
                    className="shrink-0 rounded px-1.5 text-[12px] text-muted hover:bg-danger/10 hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setWorkup([...workup, { name: '', protocol: '' }])}
                className="rounded-md border border-dashed border-line px-2 py-0.5 text-[11.5px] font-medium text-muted hover:border-accent/50 hover:text-accent-strong"
              >
                + Add test
              </button>
              {previouslyUsedTests.map((t) => (
                <button
                  key={t}
                  onClick={() => setWorkup([...workup, { name: t, protocol: '' }])}
                  className="rounded-full border border-line bg-bg px-2 py-0.5 text-[10.5px] text-muted hover:border-accent/40 hover:text-ink"
                >
                  + {t}
                </button>
              ))}
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-medium text-muted">
                …and if they showed up WITHOUT it? (why the workup matters)
              </span>
              <input
                className={input}
                placeholder="e.g. Without the EMG the visit is a repeat exam, not a surgical plan."
                value={counterfactual}
                onChange={(e) => setCounterfactual(e.target.value)}
              />
            </label>

            <div className="mt-3">
              <span className="mb-1 block text-[11px] font-medium text-muted">
                Anything you would deliberately NOT order here? (protects patients from unneeded tests)
              </span>
              <div className="flex gap-1.5">
                <input
                  className={input}
                  placeholder="e.g. MRI brachial plexus"
                  value={wouldNotDraft}
                  onChange={(e) => setWouldNotDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && wouldNotDraft.trim()) {
                      setWouldNot([...wouldNot, wouldNotDraft.trim()])
                      setWouldNotDraft('')
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (wouldNotDraft.trim()) {
                      setWouldNot([...wouldNot, wouldNotDraft.trim()])
                      setWouldNotDraft('')
                    }
                  }}
                  className="shrink-0 rounded-md border border-line px-2.5 text-[12px] font-medium text-muted hover:text-ink"
                >
                  Add
                </button>
              </div>
              {wouldNot.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {wouldNot.map((t, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/5 px-2 py-0.5 text-[11px] text-danger">
                      not: {t}
                      <button onClick={() => setWouldNot(wouldNot.filter((_, j) => j !== i))}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        <button
          disabled={saving}
          onClick={() => save(true)}
          className="w-full rounded-md bg-accent-strong px-3 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#24489c] disabled:opacity-50"
        >
          {existing ? 'Update decision' : 'Save decision'} {caseIdx < cases.length - 1 ? '& next case →' : ''}
        </button>
      </div>
    </div>
  )
}

/* ───────────────────────────── review stage ────────────────────────────── */

function ReviewStage({
  session,
  draft,
  report,
  gaps,
  setGaps,
  onBack,
  onRebuild,
  onSave,
}: {
  session: GenSession
  draft: AssembledDraft
  report: ValidationReport
  gaps: PersistedGap[]
  setGaps: (g: PersistedGap[]) => void
  onBack: () => void
  onRebuild: () => void
  onSave: () => void
}) {
  const s = report.summary
  const openGaps = gaps.filter((g) => g.status === 'open')
  const mismatches = report.results.filter(
    (r) => !r.routingMatch || r.underOrdered.length > 0 || r.overOrdered.length > 0,
  )

  const resolveGap = async (gap: PersistedGap, status: 'resolved' | 'dismissed') => {
    try {
      await setGapStatus(gap.id, status)
      setGaps(gaps.map((g) => (g.id === gap.id ? { ...g, status } : g)))
    } catch {
      /* non-fatal */
    }
  }

  return (
    <div className="space-y-4">
      {/* The proof numbers — routing and workup, NEVER collapsed into one. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Routing agreement"
          value={`${Math.round(s.routingAccuracy * 100)}%`}
          sub={`${s.routingMatches}/${s.totalCases} cases route to your choice`}
          good={s.routingAccuracy >= 0.9}
        />
        <Metric
          label="Under-ordering"
          value={`${Math.round(s.underOrderRate * 100)}%`}
          sub="missed tests — wastes the visit"
          good={s.underOrderRate === 0}
        />
        <Metric
          label="Over-ordering"
          value={`${Math.round(s.overOrderRate * 100)}%`}
          sub="unneeded tests — wastes money & trust"
          good={s.overOrderRate === 0}
        />
        <Metric
          label="Refused tests ordered"
          value={String(s.refusedOrderCases)}
          sub="must be 0 before sign-off"
          good={s.refusedOrderCases === 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Card title={`Gaps the draft was interrogated for · ${openGaps.length} open`}>
            {openGaps.length === 0 ? (
              <p className="text-[13px] text-muted">
                No open gaps — the draft covers every decided case on both axes.
              </p>
            ) : (
              <ul className="space-y-2">
                {openGaps.map((g) => (
                  <li key={g.id} className="rounded-lg border border-line bg-canvas px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded bg-nodeesc/12 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-nodeesc">
                        {g.kind.replace(/_/g, ' ')}
                      </span>
                      <span className="ml-auto flex gap-1.5">
                        <button
                          onClick={() => resolveGap(g, 'resolved')}
                          className="text-[11px] font-medium text-accent-strong hover:underline"
                        >
                          Resolved
                        </button>
                        <button
                          onClick={() => resolveGap(g, 'dismissed')}
                          className="text-[11px] font-medium text-muted hover:underline"
                        >
                          Intentional
                        </button>
                      </span>
                    </div>
                    <p className="text-[12.5px] leading-snug text-ink">{g.question}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {mismatches.length > 0 && (
            <Card title={`Disagreements with your decisions · ${mismatches.length}`}>
              <ul className="space-y-2">
                {mismatches.map((r) => (
                  <li key={r.caseId} className="rounded-lg border border-line bg-canvas px-3 py-2 text-[12px]">
                    <p className="text-ink">
                      <span className="font-medium">You:</span>{' '}
                      {r.expected.escalated ? 'escalate' : r.expected.specialistName}
                      {r.expected.workup.length > 0 && ` + ${r.expected.workup.join(', ')}`}
                    </p>
                    <p className="text-muted">
                      <span className="font-medium">Draft:</span>{' '}
                      {r.engine.outcome === 'routed' ? r.engine.specialistName : r.engine.outcome}
                      {r.engine.workup.length > 0 && ` + ${r.engine.workup.join(', ')}`}
                    </p>
                    {r.underOrdered.length > 0 && (
                      <p className="text-danger">Missing: {r.underOrdered.join(', ')}</p>
                    )}
                    {r.overOrdered.length > 0 && (
                      <p className="text-nodeesc">Extra: {r.overOrdered.join(', ')}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <TreeMiniViz tree={draft.tree} filled={{}} candidates={{}} step={null} />
          <Card title="What happens next">
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              This draft is <span className="font-medium text-ink">yours to interrogate, correct and sign</span> —
              open it in the Builder to tweak wording, branches and workup, then publish a signed
              version when the numbers satisfy you. Decide more cases any time to strengthen thin
              branches.
            </p>
            <div className="space-y-2">
              <button
                onClick={onSave}
                className="w-full rounded-md bg-accent-strong px-3 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#24489c]"
              >
                Save to library & open in Builder →
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onBack}
                  className="flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-bg"
                >
                  ← Decide more cases
                </button>
                <button
                  onClick={onRebuild}
                  className="flex-1 rounded-md border border-line bg-canvas px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-bg"
                >
                  Re-run induction
                </button>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-snug text-muted">
              Session {session.id.slice(0, 8)} · {session.subspecialty}
              {session.surgeonName ? ` · ${session.surgeonName}` : ''} · every decision, rule, gap and
              validation run is persisted and auditable.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── shared primitives ─────────────────────────── */

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-canvas p-4 shadow-[0_1px_2px_rgba(22,32,46,0.05)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.09em] text-muted">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value, sub, good }: { label: string; value: string; sub: string; good: boolean }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        good ? 'border-accent/30 bg-sky/50' : 'border-nodeesc/40 bg-nodeesc/8'
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className={`font-display text-2xl font-semibold ${good ? 'text-accent-strong' : 'text-nodeesc'}`}>
        {value}
      </p>
      <p className="text-[11px] leading-snug text-muted">{sub}</p>
    </div>
  )
}

function NavButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line bg-canvas px-3 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-bg disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-strong border-t-transparent"
      aria-hidden
    />
  )
}
