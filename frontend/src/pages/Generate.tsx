import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Urgency } from '../types/tree'
import TreeMiniViz from '../components/TreeMiniViz'
import { createTreeFull, fetchSpecialists } from '../lib/api'
import {
  createGenSession,
  generateCases,
  listCases,
  ingestReferralLetters,
  checkConsistency,
  structureWorkupText,
  submitHighlight,
  updateHighlightObservations,
  listCandidateVariables,
  submitDecision,
  persistRules,
  type ConsistencyFlag,
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
  discoverThresholds,
  type AssembledDraft,
  type DiscoveredThreshold,
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
      {/* The setup wizard is a single narrow column — center IT (header included)
          rather than leaving a 2xl column stranded inside a 6xl container. The
          working stages (highlight/decide/review) keep the wide canvas. */}
      <div className={`mx-auto px-6 py-8 ${stage === 'setup' ? 'max-w-3xl' : 'max-w-6xl'}`}>
        <header className="mb-6">
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-strong">
            Tree generator
          </p>
          <h1 className="font-display text-xl font-semibold text-ink">
            {stage === 'setup' && 'Before we start'}
            {stage === 'highlight' && 'What matters in these cases?'}
            {stage === 'decide' && 'Decide each case'}
            {stage === 'review' && 'Your draft, interrogated and scored'}
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
            onHighlightUpdated={async (h) => {
              setHighlights((prev) => prev.map((x) => (x.id === h.id ? h : x)))
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
            cases={cases}
            decisions={decisions}
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
    { id: 'setup', label: '1 · Set up' },
    { id: 'highlight', label: '2 · Highlight' },
    { id: 'decide', label: '3 · Decide' },
    { id: 'review', label: '4 · Review & sign' },
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
  const [roster, setRoster] = useState<GenRosterEntry[]>([{ name: '', specialty: '' }])
  const [caseCount, setCaseCount] = useState(6)
  const [useAI, setUseAI] = useState(true)
  const [letters, setLetters] = useState('')
  const [loadingDirectory, setLoadingDirectory] = useState(false)

  const setRosterAt = (i: number, patch: Partial<GenRosterEntry>) =>
    setRoster((r) => r.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  const filledRoster = roster.filter((r) => r.name.trim())
  const canStart = subspecialty.trim().length > 0 && filledRoster.length >= 2
  const startHint = !subspecialty.trim()
    ? 'Name the subspecialty to begin.'
    : filledRoster.length < 2
      ? 'Add at least two specialists to begin — routing needs at least two destinations to tell apart.'
      : null

  const loadDirectory = async () => {
    setLoadingDirectory(true)
    try {
      const specialists: any[] = await fetchSpecialists()
      const active = specialists.filter((s) => s.is_active !== false)
      if (active.length > 0) {
        setRoster(active.map((s) => ({ name: s.name, specialty: s.specialty ?? '' })))
        setError(null)
      } else {
        setError('No specialists in the directory yet — add your roster below.')
      }
    } catch {
      setError('Could not load the specialist directory.')
    } finally {
      setLoadingDirectory(false)
    }
  }

  const start = async () => {
    if (!canStart) return
    setError(null)
    try {
      setBusy('Starting your session…')
      const session = await createGenSession({
        subspecialty: subspecialty.trim(),
        surgeonName: surgeonName.trim() || undefined,
        roster: filledRoster,
      })

      // Case supply, in value order: (1) cases derived from the clinic's own
      // de-identified referral letters — the richest source, (2) the existing
      // library, (3) drafted cases to top up (unless turned off under Advanced).
      if (letters.trim()) {
        setBusy('Converting your referral letters into cases…')
        await ingestReferralLetters({ subspecialty: session.subspecialty, letters })
      }
      setBusy('Gathering cases…')
      let pool = await listCases(session.subspecialty)
      // Letter-derived cases first — they carry the real-world messiness.
      pool = [
        ...pool.filter((c) => c.source === 'real_deidentified'),
        ...pool.filter((c) => c.source !== 'real_deidentified'),
      ]
      if (pool.length < caseCount && useAI) {
        setBusy(`Drafting ${caseCount - pool.length} cases for you to review (~30s)…`)
        const fresh = await generateCases({
          subspecialty: session.subspecialty,
          count: caseCount - pool.length,
          roster: filledRoster,
        })
        pool = [...pool, ...fresh]
      }
      if (pool.length === 0) {
        throw new Error(
          'No cases available for this subspecialty yet — turn automatic case drafting back on (under Advanced), or seed cases via the API.',
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
    <div className="space-y-5">
      {/* 1 · Session basics */}
      <SetupSection step={1} title="Your session">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">Subspecialty</span>
            <input className={input} value={subspecialty} onChange={(e) => setSubspecialty(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">Authoring surgeon</span>
            <input
              className={input}
              placeholder="Your name"
              value={surgeonName}
              onChange={(e) => setSurgeonName(e.target.value)}
            />
          </label>
        </div>
      </SetupSection>

      {/* 2 · The roster — the hero: these become the tree's routing destinations. */}
      <SetupSection
        step={2}
        title="Specialists patients can be routed to"
        why="These are the destinations Omari can route patients to — the endpoints of your tree. Add everyone a referral could realistically land with."
      >
        <button
          onClick={loadDirectory}
          disabled={loadingDirectory}
          className="mb-3 w-full rounded-md border border-accent-strong/50 bg-sky px-3 py-2 text-[13px] font-semibold text-accent-strong transition-colors hover:border-accent-strong hover:bg-sky/70 disabled:opacity-60"
        >
          {loadingDirectory ? 'Loading your directory…' : 'Load from your directory'}
        </button>

        <div className="space-y-2">
          {roster.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={input}
                placeholder="Specialist name"
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
                onClick={() =>
                  setRoster((rr) => (rr.length > 1 ? rr.filter((_, j) => j !== i) : [{ name: '', specialty: '' }]))
                }
                className="shrink-0 rounded px-2 text-[12px] text-muted hover:bg-danger/10 hover:text-danger"
                aria-label="Remove specialist"
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
          + Add another specialist
        </button>
        {filledRoster.length > 0 && filledRoster.length < 2 && (
          <p className="mt-2 text-[11.5px] text-muted">
            One more to go — with a single destination there's nothing to route between.
          </p>
        )}
      </SetupSection>

      {/* 3 · Cases */}
      <SetupSection step={3} title="The cases you'll review">
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          You'll review realistic cases and make routing calls — never a blank page. We reuse cases
          already validated for {subspecialty.trim() ? subspecialty.trim().toLowerCase() : 'your subspecialty'} and
          draft the rest for you to check.
        </p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted">How many cases</span>
          <input
            type="range"
            min={3}
            max={12}
            value={caseCount}
            onChange={(e) => setCaseCount(Number(e.target.value))}
            className="w-full accent-[#2c56b8]"
          />
          <span className="text-[12px] font-medium text-ink">{caseCount} cases · roughly a minute each</span>
        </label>
        <details className="mt-3" open={letters.length > 0}>
          <summary className="cursor-pointer text-[11.5px] font-medium text-accent-strong hover:underline">
            Import from your own referral letters (recommended)
          </summary>
          <p className="mb-1.5 mt-2 text-[11.5px] leading-snug text-muted">
            Paste <span className="font-medium text-ink">de-identified</span> referral letters —
            no names, dates of birth, MRNs, or identifying details. Each is rewritten into a
            fresh case carrying your clinic's real presentations, which makes the elicited
            tree far richer than drafted cases alone.
          </p>
          <textarea
            value={letters}
            onChange={(e) => setLetters(e.target.value)}
            rows={5}
            placeholder={'Paste one or more de-identified referral letters, separated by blank lines…'}
            className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-muted/60 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent-strong/15"
          />
        </details>
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-medium text-muted hover:text-ink">
            Advanced
          </summary>
          <label className="mt-2 flex items-center gap-2 text-[12.5px] text-ink">
            <input
              type="checkbox"
              checked={useAI}
              onChange={(e) => setUseAI(e.target.checked)}
              className="accent-[#2c56b8]"
            />
            Draft missing cases automatically (you review every one before it's used)
          </label>
        </details>
      </SetupSection>

      {/* Expectations + the gated CTA */}
      <div className="rounded-xl border border-line bg-canvas p-4 shadow-[0_1px_2px_rgba(22,32,46,0.05)]">
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          About 15 minutes. You'll produce a draft tree that <span className="font-medium text-ink">you review and sign</span> —
          your logic, your sign-off.
        </p>
        <button
          onClick={start}
          disabled={!canStart}
          className="w-full rounded-md bg-accent-strong px-3 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#24489c] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start session →
        </button>
        {startHint && <p className="mt-2 text-center text-[11.5px] text-muted">{startHint}</p>}
      </div>
    </div>
  )
}

/** Numbered, sentence-case section for the setup column (calmer than the
 * all-caps Card used in the working stages). */
function SetupSection({
  step,
  title,
  why,
  children,
}: {
  step: number
  title: string
  why?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-canvas p-5 shadow-[0_1px_2px_rgba(22,32,46,0.05)]">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-strong/10 font-display text-[11px] font-semibold text-accent-strong">
          {step}
        </span>
        <h2 className="font-display text-[14px] font-semibold text-ink">{title}</h2>
      </div>
      {/* Everything below the title shares ONE left edge (indented past the
          step number) so the card reads as a single aligned column. */}
      {why && <p className="mb-3 ml-7 text-[12px] leading-snug text-muted">{why}</p>}
      <div className={`ml-7 ${why ? '' : 'mt-2.5'}`}>{children}</div>
    </section>
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
  onHighlightUpdated,
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
  onHighlightUpdated: (h: GenHighlight) => Promise<void>
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

  // Chip removal — the surgeon curates what a loose highlight actually meant.
  const removeObservation = async (h: GenHighlight, index: number) => {
    try {
      const next = h.observations.filter((_, i) => i !== index)
      const updated = await updateHighlightObservations(h.id, next)
      await onHighlightUpdated(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
                What we heard in your highlights — remove anything you didn't mean
              </p>
              <div className="space-y-2">
                {caseHighlights.map((h) => (
                  <div key={h.id} className="rounded-lg border border-line/70 bg-canvas px-2.5 py-1.5">
                    <p className="mb-1 text-[11px] italic text-muted">
                      “{h.spanText.slice(0, 90)}
                      {h.spanText.length > 90 ? '…' : ''}”
                    </p>
                    {h.observations.length === 0 ? (
                      <p className="text-[10.5px] text-muted">
                        Nothing kept from this highlight.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {h.observations.map((o, i) => (
                          <span
                            key={`${o.key}-${i}`}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${AXIS_META[o.axis]?.cls ?? AXIS_META[h.axis].cls}`}
                            title={o.source === 'llm' ? 'Suggested — remove if not what you meant' : 'Matched from the case'}
                          >
                            <span className="max-w-[140px] truncate">
                              {String(o.value ?? o.spanText)}
                            </span>
                            <span className="font-mono text-[9.5px] opacity-70">
                              · {(o.label ?? o.key).toString().replace(/_/g, ' ')}
                            </span>
                            {o.source === 'llm' && (
                              <span className="text-[8.5px] uppercase tracking-wide opacity-60">ai</span>
                            )}
                            <button
                              onClick={() => removeObservation(h, i)}
                              className="ml-0.5 rounded-full px-0.5 leading-none opacity-60 hover:opacity-100"
                              aria-label={`Remove ${o.key}`}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
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
  const [workup, setWorkup] = useState<{ name: string; protocol: string; conditionalHint?: string }[]>([])
  const [wouldNot, setWouldNot] = useState<string[]>([])
  const [wouldNotDraft, setWouldNotDraft] = useState('')
  const [counterfactual, setCounterfactual] = useState('')
  const [saving, setSaving] = useState(false)
  // Manual test entry drafts (chips are added, not edited in place).
  const [testDraft, setTestDraft] = useState({ name: '', protocol: '' })
  // Free-text workup → structured proposal (LLM job 6; surgeon edits everything).
  const [workupText, setWorkupText] = useState('')
  const [structuring, setStructuring] = useState(false)
  // Advisory consistency flags (LLM job 5); dismissed ones stay dismissed locally.
  const [flags, setFlags] = useState<ConsistencyFlag[]>([])
  const [dismissedFlags, setDismissedFlags] = useState<Set<string>>(new Set())
  const [checkingConsistency, setCheckingConsistency] = useState(false)
  // Skip-with-reason menu + the latest derived threshold involving this case.
  const [skipMenuOpen, setSkipMenuOpen] = useState(false)
  const [justDiscovered, setJustDiscovered] = useState<DiscoveredThreshold | null>(null)

  // Reset the form when the case changes (pre-fill from an earlier decision).
  useEffect(() => {
    setSpecialist(existing?.routedSpecialistName ?? null)
    setEscalate(existing?.escalated ?? false)
    setUrgency((existing?.urgency as Urgency) ?? 'routine')
    setWorkup(
      existing?.workup.map((w) => ({
        name: w.name,
        protocol: w.protocol ?? '',
        conditionalHint: w.conditionalHint,
      })) ?? [],
    )
    setWouldNot(existing?.wouldNotOrder ?? [])
    setCounterfactual(existing?.workupCounterfactual ?? '')
    setWouldNotDraft('')
    setTestDraft({ name: '', protocol: '' })
    setSkipMenuOpen(false)
    setJustDiscovered(null)
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
      workup: workup
        .filter((w) => w.name.trim())
        .map((w) => ({
          name: w.name.trim(),
          protocol: w.protocol.trim(),
          ...(w.conditionalHint ? { conditionalHint: w.conditionalHint } : {}),
        })),
      workupCounterfactual: counterfactual.trim() || undefined,
      wouldNotOrder: wouldNot,
      caseVariables: {},
    }
    try {
      await submitDecision(session.id, decision)
      const nextDecisions = { ...decisions, [current.id]: decision }
      setDecisions(nextDecisions)
      // Threshold discovery — DERIVED via the same comparison induction uses
      // (one function, two consumers). If this decision completed a minimal
      // pair whose outcome flipped, tell the surgeon the boundary was found.
      const found = discoverThresholds(cases, Object.values(nextDecisions)).find(
        (t) => t.variantCaseId === current.id || t.parentCaseId === current.id,
      )
      setJustDiscovered(found ?? null)
      if (advance && !found && caseIdx < cases.length - 1) setCaseIdx(caseIdx + 1)
      // Live coaching (advisory): with 3+ decisions, look for similar cases
      // decided differently. Fire-and-forget — never blocks the flow.
      if (Object.keys(nextDecisions).length >= 3) {
        setCheckingConsistency(true)
        void checkConsistency(session.id)
          .then(setFlags)
          .catch(() => undefined)
          .finally(() => setCheckingConsistency(false))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // Skip-with-reason: handled, not decided. Excluded from induction by the
  // shared joinDecidedCases filter; the reason itself is signal.
  const saveSkip = async (reason: string) => {
    if (!current) return
    setSkipMenuOpen(false)
    setSaving(true)
    const decision: GenDecision = {
      caseId: current.id,
      escalated: false,
      skipped: true,
      skipReason: reason,
      workup: [],
      wouldNotOrder: [],
      caseVariables: {},
    }
    try {
      await submitDecision(session.id, decision)
      setDecisions({ ...decisions, [current.id]: decision })
      if (caseIdx < cases.length - 1) setCaseIdx(caseIdx + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  // "Structure my words" — transcribe free text into workup rows the surgeon edits.
  const structureWorkup = async () => {
    if (!workupText.trim()) return
    setStructuring(true)
    try {
      const known = [...new Set(Object.values(decisions).flatMap((d) => d.workup.map((w) => w.name)))]
      const out = await structureWorkupText(workupText, known)
      if (out.items.length > 0) {
        setWorkup((prev) => [
          ...prev,
          ...out.items
            .filter((i) => i.name && !prev.some((w) => w.name.toLowerCase() === i.name.toLowerCase()))
            .map((i: any) => ({
              name: i.name,
              protocol: i.protocol ?? '',
              // Stated condition = a LEAD for induction to confirm, surfaced
              // in Review; never binding logic.
              conditionalHint: i.conditionalHint || undefined,
            })),
        ])
      }
      if (out.wouldNotOrder.length > 0) {
        setWouldNot((prev) => [...prev, ...out.wouldNotOrder.filter((t) => !prev.includes(t))])
      }
      setWorkupText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStructuring(false)
    }
  }

  const makeMinimalPairs = async () => {
    if (!current) return
    const parentDecision = decisions[current.id]
    setBusy('Writing boundary probes (same case, one variable flipped)…')
    try {
      const fresh = await generateCases({
        subspecialty: session.subspecialty,
        count: 2,
        roster: session.roster,
        minimalPairOf: current.id,
        // Boundary-targeting: how the surgeon decided the seed steers WHICH
        // variable gets flipped — the LLM never predicts the new decision.
        parentDecision:
          parentDecision && !parentDecision.skipped
            ? {
                routedTo: parentDecision.routedSpecialistName,
                escalated: parentDecision.escalated,
                workup: parentDecision.workup.map((w) => w.name),
              }
            : undefined,
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

  const visibleFlags = flags.filter((f) => !dismissedFlags.has(f.concern))
  const caseNumberById = new Map(cases.map((c, i) => [c.id, i]))

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
      <div>
        {visibleFlags.length > 0 && (
          <div className="mb-3 space-y-2">
            {visibleFlags.map((f) => (
              <div
                key={f.concern}
                className="rounded-lg border border-nodeesc/40 bg-nodeesc/8 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded bg-nodeesc/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nodeesc">
                    Worth a look
                  </span>
                  <p className="flex-1 text-[12.5px] leading-snug text-ink">{f.concern}</p>
                  <button
                    onClick={() => setDismissedFlags((s) => new Set(s).add(f.concern))}
                    className="shrink-0 text-[11px] font-medium text-muted hover:text-ink"
                  >
                    It's intentional
                  </button>
                </div>
                <div className="mt-1 flex gap-1.5 pl-1">
                  {f.caseIds
                    .filter((id) => caseNumberById.has(id))
                    .map((id) => (
                      <button
                        key={id}
                        onClick={() => setCaseIdx(caseNumberById.get(id)!)}
                        className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[10.5px] font-medium text-accent-strong hover:border-accent/50"
                      >
                        Review case {caseNumberById.get(id)! + 1}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <Card
          title={`Case ${caseIdx + 1} of ${cases.length} · ${decidedCount} handled${checkingConsistency ? ' · checking consistency…' : ''}`}
          right={
            current.minimalPairOf ? (
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-accent-strong">
                boundary probe · {String(current.variedVariable ?? 'variant').replace(/_/g, ' ')}
              </span>
            ) : undefined
          }
        >
          {/* Salient-fact strip — DETERMINISTIC, straight from the case's
              human-reviewed ground truth (no live summarization to slip).
              Shows what exists; never fabricates completeness. It supplements
              the narrative below, which remains what the surgeon decides on. */}
          {Object.keys(current.groundTruth).length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {Object.entries(current.groundTruth).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded-full border border-line bg-bg px-2 py-0.5 text-[10.5px] text-muted"
                  title={k}
                >
                  <span className="font-medium text-ink">{k.replace(/_/g, ' ')}:</span> {String(v).replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
          <div className="whitespace-pre-wrap rounded-lg border border-line bg-canvas px-4 py-3 text-[13.5px] leading-relaxed text-ink">
            {current.narrative}
          </div>
        </Card>

        {justDiscovered && (
          <div className="mt-3 rounded-lg border border-accent/40 bg-sky/60 px-3 py-2">
            <p className="text-[12.5px] leading-snug text-ink">
              <span className="font-semibold text-accent-strong">Threshold discovered:</span>{' '}
              your decision {justDiscovered.routingFlip && justDiscovered.workupFlip
                ? 'and workup both flip'
                : justDiscovered.routingFlip
                  ? 'flips'
                  : 'keeps routing but the workup changes'}{' '}
              on <span className="font-mono text-[11.5px]">{justDiscovered.variedVariable.replace(/_/g, ' ')}</span>
              {justDiscovered.parentValue !== undefined && (
                <> ({String(justDiscovered.parentValue)} → {String(justDiscovered.variantValue)})</>
              )}
              : {justDiscovered.parentOutcome} → {justDiscovered.variantOutcome}. This boundary
              feeds the tree.
            </p>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <NavButton disabled={caseIdx === 0} onClick={() => setCaseIdx(caseIdx - 1)}>
              ← Previous
            </NavButton>
            <NavButton disabled={caseIdx >= cases.length - 1} onClick={() => setCaseIdx(caseIdx + 1)}>
              Next case →
            </NavButton>
            {/* Skip is quiet and captures WHY — the reason is signal
                ("not my subspecialty" ≠ "too ambiguous"). Skipped cases count
                as handled but never shape the tree. */}
            {!existing?.skipped && (
              <span className="relative">
                <button
                  onClick={() => setSkipMenuOpen((v) => !v)}
                  className="px-1.5 text-[11.5px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Skip this case
                </button>
                {skipMenuOpen && (
                  <span className="absolute left-0 top-full z-20 mt-1 flex w-56 flex-col rounded-lg border border-line bg-canvas p-1 shadow-[0_10px_30px_rgba(22,32,46,0.14)]">
                    {SKIP_REASONS.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => void saveSkip(r.value)}
                        className="rounded-md px-2 py-1.5 text-left text-[12px] text-ink hover:bg-bg"
                      >
                        {r.label}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
            {existing?.skipped && (
              <span className="text-[11px] text-muted">
                Skipped — {SKIP_REASONS.find((r) => r.value === existing.skipReason)?.label ?? existing.skipReason}
              </span>
            )}
          </div>
          {allDecided && (
            <button
              onClick={onBuild}
              className="rounded-md bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-[#24489c]"
            >
              All cases handled — build the draft tree →
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
                className={`rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] normal-case transition-colors ${
                  specialist === r.name && !escalate
                    ? 'border-accent-strong bg-sky font-semibold text-accent-strong'
                    : 'border-line bg-canvas text-ink hover:border-accent/50'
                }`}
              >
                <span className="block whitespace-nowrap font-medium">{r.name}</span>
                {r.specialty && <span className="block text-[10.5px] font-normal text-muted">{r.specialty}</span>}
              </button>
            ))}
          </div>
          {/* Escalation is "no clean answer" — not a third specialist. It sits
              apart, below the roster, deliberately quieter. */}
          <div className="mt-3 border-t border-line pt-2.5">
            <button
              onClick={() => {
                setEscalate(true)
                setSpecialist(null)
              }}
              className={`w-full rounded-lg border border-dashed px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                escalate
                  ? 'border-nodeesc bg-nodeesc/10 font-semibold text-nodeesc'
                  : 'border-line bg-transparent text-muted hover:border-nodeesc/50 hover:text-ink'
              }`}
            >
              No clean answer — I'd want to see this myself
              <span className="block text-[10.5px] font-normal text-muted">
                genuine ambiguity → human review
              </span>
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
              …or the first visit is wasted. Say it in your own words, or add tests directly below.
            </p>
            <div className="mb-3 flex gap-1.5">
              <input
                className={input}
                placeholder={'e.g. "get nerves tested, and imaging only if there\'s a mass"'}
                value={workupText}
                onChange={(e) => setWorkupText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && workupText.trim()) void structureWorkup()
                }}
              />
              <button
                onClick={() => void structureWorkup()}
                disabled={structuring || !workupText.trim()}
                className="shrink-0 rounded-md border border-accent-strong/50 bg-sky px-2.5 text-[12px] font-semibold text-accent-strong hover:border-accent-strong disabled:opacity-50"
              >
                {structuring ? 'Structuring…' : 'Structure it'}
              </button>
            </div>
            {/* The order list as removable chips — the WorkupSpec visibly
                taking shape. Chips are added (typed, structured, or from the
                palette), reviewed, and removed; never edited silently. */}
            {workup.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {workup.map((w, i) => (
                  <span
                    key={`${w.name}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-nodespec/40 bg-nodespec/8 px-2.5 py-1 text-[11.5px] text-ink"
                    title={w.protocol || undefined}
                  >
                    <span className="font-medium">{w.name}</span>
                    {w.protocol && <span className="text-[10px] text-muted">· {w.protocol}</span>}
                    {w.conditionalHint ? (
                      <span
                        className="rounded bg-nodeesc/15 px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-nodeesc"
                        title={`You said: "${w.conditionalHint}" — a lead for induction to confirm from your case decisions.`}
                      >
                        conditional: {w.conditionalHint}
                      </span>
                    ) : (
                      <span className="rounded bg-line/60 px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-muted">
                        ordered here
                      </span>
                    )}
                    <button
                      onClick={() => setWorkup(workup.filter((_, j) => j !== i))}
                      className="ml-0.5 rounded-full px-0.5 leading-none opacity-60 hover:opacity-100"
                      aria-label={`Remove ${w.name}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                className={input}
                placeholder="Test (e.g. EMG/NCS)"
                value={testDraft.name}
                onChange={(e) => setTestDraft({ ...testDraft, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && testDraft.name.trim()) {
                    setWorkup([...workup, { name: testDraft.name.trim(), protocol: testDraft.protocol.trim() }])
                    setTestDraft({ name: '', protocol: '' })
                  }
                }}
              />
              <input
                className={input}
                placeholder="Protocol (optional)"
                value={testDraft.protocol}
                onChange={(e) => setTestDraft({ ...testDraft, protocol: e.target.value })}
              />
              <button
                onClick={() => {
                  if (!testDraft.name.trim()) return
                  setWorkup([...workup, { name: testDraft.name.trim(), protocol: testDraft.protocol.trim() }])
                  setTestDraft({ name: '', protocol: '' })
                }}
                disabled={!testDraft.name.trim()}
                className="shrink-0 rounded-md border border-line px-2.5 text-[12px] font-medium text-muted hover:text-ink disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {previouslyUsedTests.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  Your earlier tests — options, not recommendations:
                </span>
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
            )}

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
          {existing && !existing.skipped ? 'Update decision' : 'Save decision'}{' '}
          {caseIdx < cases.length - 1 ? '& next case →' : ''}
        </button>

        {/* The core loop: decide, then probe the decision's boundary. The
            model manufactures the probes; the surgeon decides every one. */}
        {existing && !existing.skipped && (
          <button
            onClick={makeMinimalPairs}
            className="w-full rounded-md border border-accent-strong/50 bg-sky px-3 py-2 text-[13px] font-semibold text-accent-strong transition-colors hover:border-accent-strong"
          >
            Probe this decision → same case, one variable flipped
          </button>
        )}
      </div>
    </div>
  )
}

/** One-tap skip reasons — each is distinct signal about the CASE, not the patient. */
const SKIP_REASONS = [
  { value: 'not_my_subspecialty', label: 'Not my subspecialty' },
  { value: 'unrealistic_case', label: 'Case is unrealistic — needs rewriting' },
  { value: 'cannot_decide_from_this', label: "Can't decide from what's written" },
]

/* ───────────────────────────── review stage ────────────────────────────── */

function ReviewStage({
  session,
  draft,
  report,
  gaps,
  setGaps,
  cases,
  decisions,
  onBack,
  onRebuild,
  onSave,
}: {
  session: GenSession
  draft: AssembledDraft
  report: ValidationReport
  gaps: PersistedGap[]
  setGaps: (g: PersistedGap[]) => void
  cases: GenCase[]
  decisions: Record<string, GenDecision>
  onBack: () => void
  onRebuild: () => void
  onSave: () => void
}) {
  const s = report.summary
  const openGaps = gaps.filter((g) => g.status === 'open')
  const mismatches = report.results.filter(
    (r) => !r.routingMatch || r.underOrdered.length > 0 || r.overOrdered.length > 0,
  )

  // Derived (never stored) — same flip semantics induction uses.
  const thresholds = useMemo(
    () => discoverThresholds(cases, Object.values(decisions)),
    [cases, decisions],
  )

  // Stated-condition LEADS: things the surgeon SAID were conditional, checked
  // against what induction actually produced. Surfaced for the surgeon to
  // pursue (decide more cases) — never injected into the tree.
  const conditionLeads = useMemo(() => {
    const inducedConditionalTests = new Set(
      draft.tree.nodes
        .filter((n) => n.type === 'specialist')
        .flatMap((n) => (n.type === 'specialist' ? n.workup.conditional.map((c) => c.item.name.toLowerCase()) : [])),
    )
    const leads: { test: string; hint: string; induced: boolean }[] = []
    for (const d of Object.values(decisions)) {
      for (const w of d.workup) {
        if (w.conditionalHint && !leads.some((l) => l.test.toLowerCase() === w.name.toLowerCase())) {
          leads.push({
            test: w.name,
            hint: w.conditionalHint,
            induced: inducedConditionalTests.has(w.name.toLowerCase()),
          })
        }
      }
    }
    return leads
  }, [decisions, draft])

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

          {thresholds.length > 0 && (
            <Card title={`Boundaries you discovered · ${thresholds.length}`}>
              <p className="mb-2 text-[11.5px] leading-snug text-muted">
                Minimal pairs where your decision flipped — derived from your own case decisions
                with the same comparison the tree induction uses.
              </p>
              <ul className="space-y-1.5">
                {thresholds.map((t) => (
                  <li
                    key={`${t.parentCaseId}-${t.variantCaseId}`}
                    className="rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] leading-snug"
                  >
                    <span className="font-mono text-[11px] font-medium text-accent-strong">
                      {t.variedVariable.replace(/_/g, ' ')}
                    </span>
                    {t.parentValue !== undefined && (
                      <span className="text-muted">
                        {' '}({String(t.parentValue)} → {String(t.variantValue)})
                      </span>
                    )}
                    <span className="text-ink">
                      {' '}· {t.parentOutcome} <span className="text-muted">→</span> {t.variantOutcome}
                    </span>
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted">
                      {t.routingFlip && t.workupFlip ? 'routing + workup' : t.routingFlip ? 'routing' : 'workup'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {conditionLeads.length > 0 && (
            <Card title={`Conditions you stated · ${conditionLeads.length} lead${conditionLeads.length === 1 ? '' : 's'}`}>
              <p className="mb-2 text-[11.5px] leading-snug text-muted">
                You phrased these tests conditionally while deciding. Stated conditions are leads —
                the tree only encodes a condition when your case decisions demonstrate it.
              </p>
              <ul className="space-y-1.5">
                {conditionLeads.map((l) => (
                  <li key={l.test} className="rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] leading-snug">
                    <span className="font-medium text-ink">{l.test}</span>
                    <span className="text-muted"> — “{l.hint}”</span>
                    {l.induced ? (
                      <span className="ml-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-accent-strong">
                        ✓ demonstrated in your decisions
                      </span>
                    ) : (
                      <span className="ml-1.5 rounded bg-nodeesc/12 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-nodeesc">
                        not yet demonstrated — decide cases on both sides of it
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

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
