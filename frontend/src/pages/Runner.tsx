import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTreeStore } from '../store/treeStore'
import { setDemoMode } from '../lib/extractionProvider'
import { sampleTree } from '../data/sampleTree'
import { fetchTrees, fetchTree } from '../lib/api'
import { VARIABLE_SPECS } from '../data/variableSpecs'
import { nodeDisplayName } from '../lib/treeToFlow'
import { confidenceBand, planConversationStep, type Extraction, type OrchestratorStep } from '../lib/orchestrator'
import { coreIntakeKeys, escalationCategoryLabel, type EscalationAnalysis } from '../lib/escalation'
import TreeMiniViz from '../components/TreeMiniViz'
import { extract, type ExtractionMode } from '../lib/extraction'
import { voiceTurn, resetDemoVoice } from '../lib/voice'
import { triageTurn, type TriageSituation } from '../lib/triage'
import { deriveQuestion, fillTemplate, type Choice } from '../lib/runner'
import { composeConfirmation } from '../lib/confirmation'
import OrbExperience from '../components/OrbExperience'
import type { FilledVariables, Tree, Urgency, VariableNode, VariableSpec } from '../types/tree'

// NOTE: presentation-only file. The deterministic engine makes ALL routing
// decisions (nextStep → runEngine). Nothing here decides what to ask, names a
// specialist, or interprets clinical meaning — it only renders engine output.
// The Omari "voice layer" adds warm wording/acknowledgments around the question
// the engine already chose; it never decides questions, routing, or medicine.

const THINK_MS = 750 // a natural "Omari is typing…" pause so turns don't feel robotic

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const naturalPause = (): Promise<void> =>
  new Promise((r) => setTimeout(r, prefersReducedMotion() ? 0 : THINK_MS))

/** Engine-derived answer-option labels (for the voice layer's natural mention only). */
// Patient-facing option text for the voice layer — the PLAIN labels only, never
// the internal label / routing hint.
function optionLabels(node: VariableNode | undefined, spec: VariableSpec | undefined): string[] {
  if (!node) return []
  return deriveQuestion(node, spec ?? VARIABLE_SPECS[node.variableKey]).choices.map(
    (c) => c.patientLabel,
  )
}

type Specialist = Extract<Tree['nodes'][number], { type: 'specialist' }>

/**
 * Warm handoff when the engine routes. Framed as a PENDING referral sent for
 * human review — NOT a finished plan. Uses ONLY the engine-provided name/
 * specialty; never lists the workup (that isn't confirmed until a clinician
 * signs off on the doctor dashboard).
 */
function routeHandoff(s: Specialist): string {
  return (
    `Thank you for walking me through all of that. Based on what you’ve shared, I’ve matched you ` +
    `with ${s.specialistName}’s team — ${s.specialty} — and I’ve sent your referral over for them ` +
    `to review and confirm. Someone from their team will follow up with you about next steps. ` +
    `You don’t need to do anything else right now.`
  )
}

// Calm, non-alarming handoff for escalation — same human-in-the-loop framing.
const ESCALATION_HANDOFF =
  'Thank you for sharing this with me. I want to make sure you get exactly the right care, so ' +
  'I’ve sent this to our clinical team to review personally before anything is booked. Someone ' +
  'will follow up with you directly — you don’t need to do anything else right now.'

// Urgency pills for the clinician panel (tinted, on a light surface). Urgency is
// withheld from the patient view — it isn't shown until a clinician confirms.
const URGENCY_PANEL: Record<Urgency, string> = {
  routine: 'bg-accent/12 text-accent',
  expedited: 'bg-nodeesc/15 text-nodeesc',
  urgent: 'bg-danger/10 text-danger',
}

const INTRO =
  "Hi, I’m Omari — an AI care coordinator. I’ll ask you a few questions so we can get you to " +
  "exactly the right specialist. I’m not a doctor, so I won’t give medical advice, but I’ll make " +
  "sure the right person sees you. To start, just tell me what’s going on in your own words — " +
  "take your time."

/** Pre-written demo inputs known to behave correctly in simulated mode. */
const SAMPLE_CASES: { label: string; hint: string; text: string }[] = [
  {
    label: 'Clean case',
    hint: 'routes straight to a specialist',
    text: "I've had constant numbness and tingling in my right hand for the past eight months, and a nerve conduction study came back abnormal.",
  },
  {
    label: 'Vague case',
    hint: 'triggers follow-up questions',
    text: "Honestly it's hard to pin down — kind of a mix of everything, mostly in my hand. It's been bugging me for a while.",
  },
  {
    label: 'Red-flag case',
    hint: 'escalates for human review',
    text: 'I found a hard lump in my forearm that I can feel under the skin, and it’s been growing.',
  },
]

export type Phase = 'intro' | 'thinking' | 'awaiting' | 'done' | 'error'
export interface ChatMessage {
  id: number
  from: 'bot' | 'patient'
  text: string
}

/* -------------------------------------------------------------------------- */
/* Presentation mode (session-persisted)                                       */
/* -------------------------------------------------------------------------- */

const PRESENTATION_KEY = 'omari:presentation'

function usePresentationMode(): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(PRESENTATION_KEY) === '1'
    } catch {
      return false
    }
  })
  const set = (next: boolean) => {
    setOn(next)
    try {
      sessionStorage.setItem(PRESENTATION_KEY, next ? '1' : '0')
    } catch {
      /* sessionStorage unavailable — keep in-memory only */
    }
  }
  return [on, set]
}

function Runner() {
  const { savedTree, savedAt, saveTree } = useTreeStore()
  const [presentation, setPresentation] = usePresentationMode()
  const [dbTree, setDbTree] = useState<Tree | null>(null)

  useEffect(() => {
    if (!savedTree && !dbTree) {
      fetchTrees()
        .then(async trees => {
          if (trees.length > 0) {
            const fetched = await fetchTree(trees[0].id)
            setDbTree(fetched)
            saveTree(fetched)
          }
        })
        .catch(console.error)
    }
  }, [savedTree, dbTree, saveTree])

  const tree = savedTree ?? dbTree ?? sampleTree
  
  // Re-key on each save so the Runner always starts fresh on the LATEST tree.
  return (
    <>
      <RunnerSession
        key={tree.treeId + (savedAt || 0)}
        tree={tree}
        usingFallback={!savedTree}
        presentation={presentation}
        onTogglePresentation={() => setPresentation(!presentation)}
      />
      {presentation && <ExitPresentation onExit={() => setPresentation(false)} />}
    </>
  )
}

function RunnerSession({
  tree,
  usingFallback,
  presentation,
  onTogglePresentation,
}: {
  tree: Tree
  usingFallback: boolean
  presentation: boolean
  onTogglePresentation: () => void
}) {
  const idRef = useRef(0)
  const nextId = () => ++idRef.current

  const [mode, setMode] = useState<ExtractionMode>('demo')

  // The visible Demo-mode switch also drives the new extraction layer's
  // DEMO_MODE: 'demo' → scripted/offline extraction, 'live' → real Claude call.
  useEffect(() => {
    setDemoMode(mode === 'demo')
  }, [mode])
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: nextId(), from: 'bot', text: INTRO },
  ])
  const [filled, setFilled] = useState<FilledVariables>({})
  const [candidates, setCandidates] = useState<Record<string, Extraction>>({})
  const [step, setStep] = useState<OrchestratorStep | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const lastTextRef = useRef('') // the initial free-text (for the error-retry button)
  const lastPatientRef = useRef('') // the patient's most recent utterance (for warm acknowledgment)

  // Escalation-policy bookkeeping (persists across turns). The engine still
  // decides; these only track our clarify-then-gather intake before a handoff.
  const coreKeys = useMemo(() => coreIntakeKeys(tree), [tree])
  const clarifiedRef = useRef<Set<string>>(new Set()) // triggers we've re-asked once
  const gatheredRef = useRef<Set<string>>(new Set()) // core vars asked while gathering

  const pushMessage = (from: ChatMessage['from'], text: string) =>
    setMessages((m) => [...m, { id: nextId(), from, text }])

  const reset = () => {
    idRef.current = 0
    resetDemoVoice() // restart the warm-acknowledgment rotation for a fresh conversation
    setMessages([{ id: nextId(), from: 'bot', text: INTRO }])
    setFilled({})
    setCandidates({})
    setStep(null)
    setPhase('intro')
    setError(null)
    setDraft('')
    lastPatientRef.current = ''
    clarifiedRef.current = new Set()
    gatheredRef.current = new Set()
  }

  /**
   * Compute & render the next action from explicit (not stale) state. The ENGINE
   * (nextStep) decides what comes next; this only wraps that decision in Omari's
   * warm voice (an "is typing…" pause, then an acknowledgment + the question, or
   * a human handoff). The voice text is display-only — the actual answer chips
   * and routing come straight from the engine.
   */
  const advance = async (
    nextFilled: FilledVariables,
    nextCandidates: Record<string, Extraction>,
    // The variable key(s) whose value was extracted/answered on THIS turn. A
    // confirmation may ONLY reference one of these (no stale one-behind confirms).
    updatedKeys: Set<string>,
  ) => {
    // Escalation-aware planning: the engine still decides, but an ambiguity
    // escalation triggers clarify-then-gather before we honour it (emergencies
    // and normal routing are unchanged).
    const s = planConversationStep(tree, nextFilled, nextCandidates, VARIABLE_SPECS, {
      coreKeys,
      clarifiedKeys: clarifiedRef.current,
      gatheredKeys: gatheredRef.current,
      updatedKeys,
    })
    setStep(s)

    if (s.kind === 'guard') {
      setError('I could not determine the next question — the saved tree may be incomplete.')
      setPhase('error')
      return
    }

    setPhase('thinking') // Omari is typing…
    await naturalPause()

    switch (s.kind) {
      case 'ask': {
        // Record intake/clarify so the policy advances (asks each core var at
        // most once) and the clinician packet can show what was attempted.
        if (s.purpose === 'clarify') clarifiedRef.current.add(s.key)
        if (s.purpose === 'intake') gatheredRef.current.add(s.key)

        const base = s.spec?.patientQuestion ?? s.node?.prompt ?? `Tell me about “${s.key}”.`
        // A clarify re-ask gets a gentle lead so it doesn't read as a repeat.
        const question =
          s.purpose === 'clarify'
            ? `I want to make sure I point you to exactly the right person — ${base}`
            : base
        // Warm wording around the ENGINE's chosen question. Falls back to the
        // plain question on any failure (handled inside voiceTurn).
        const warm = await voiceTurn(
          {
            question,
            options: optionLabels(s.node, s.spec),
            lastPatientMessage: lastPatientRef.current,
            progressHint: Object.keys(nextFilled).length >= 3,
          },
          mode,
        )
        pushMessage('bot', warm)
        setPhase('awaiting')
        break
      }
      case 'confirm': {
        // GUARD: a confirmation may only reference a variable updated THIS turn.
        // The gate in planConversationStep enforces this; assert it here too so a
        // regression surfaces loudly instead of silently confirming a stale value.
        if (import.meta.env.DEV && !updatedKeys.has(s.key)) {
          console.error(
            `[Omari] confirmation referenced "${s.key}", which was not updated this turn — stale/one-behind confirm.`,
          )
        }
        // Restate the MEANING (question intent + patient-facing answer) in one
        // plain sentence — never a bare token, never an internal/raw value.
        pushMessage('bot', composeConfirmation(s.node, s.candidate.value, s.spec))
        setPhase('awaiting')
        break
      }
      case 'route':
        pushMessage('bot', routeHandoff(s.specialist))
        setPhase('done')
        break
      case 'escalate':
        pushMessage('bot', ESCALATION_HANDOFF)
        setPhase('done')
        break
    }
  }

  /**
   * Extract variable values from free text and re-run the engine. Merges into the
   * CURRENT filled/candidates (so this serves both the opening message and any
   * "just tell me in your own words" follow-up) — high-confidence → filled, else a
   * candidate to confirm. Identical to the original behaviour when starting empty.
   */
  const runExtraction = async (text: string, useMode: ExtractionMode) => {
    setPhase('thinking')
    setError(null)
    try {
      const extracted = await extract(text, VARIABLE_SPECS, useMode, tree)
      const nextFilled: FilledVariables = { ...filled }
      const nextCandidates: Record<string, Extraction> = { ...candidates }
      for (const [k, c] of Object.entries(extracted)) {
        if (confidenceBand(c.confidence) === 'high') {
          nextFilled[k] = { value: c.value, confidence: c.confidence }
          delete nextCandidates[k]
        } else if (!(k in nextFilled)) {
          nextCandidates[k] = c
        }
      }
      setFilled(nextFilled)
      setCandidates(nextCandidates)
      // Only what we just extracted this turn is confirm-eligible.
      await advance(nextFilled, nextCandidates, new Set(Object.keys(extracted)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed.')
      setPhase('error')
    }
  }

  /** The most recent bot message — the question/invite the patient is replying to. */
  const lastBotQuestion = (): string => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].from === 'bot') return messages[i].text
    }
    return ''
  }

  /** Patient sends free text — the opening message OR a "just talk" follow-up answer. */
  const submitText = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    lastTextRef.current = trimmed
    lastPatientRef.current = trimmed
    pushMessage('patient', trimmed)
    void handlePatientText(trimmed)
  }

  /**
   * Decide what KIND of message this is before treating it as a symptom answer.
   * Symptom content (or greeting + symptom) → extract + advance the engine, as
   * today. A conversational turn — greeting, a question to Omari, anxiety, or
   * confusion — gets a warm response and the engine does NOT move forward.
   *
   * The engine still owns every clinical question and all routing; this only
   * gates whether we advance it, and never says "thanks for sharing" when
   * nothing was actually shared.
   */
  const handlePatientText = async (text: string) => {
    const priorPhase: Phase = step ? 'awaiting' : 'intro'
    const situation: TriageSituation =
      step?.kind === 'confirm' ? 'confirm' : step?.kind === 'ask' ? 'question' : 'opening'
    const currentQuestion = situation === 'opening' ? '' : lastBotQuestion()

    setPhase('thinking')
    setError(null)
    const triage = await triageTurn(text, { situation, currentQuestion }, mode)

    if (triage.containsSymptomContent) {
      // Real symptom content (or greeting + symptom) → extract + advance. The
      // voice layer warmly acknowledges any human part of a MIXED message.
      await runExtraction(text, mode)
      return
    }

    // Non-symptom turn → respond in Omari's voice; the engine stays put.
    await naturalPause()
    pushMessage('bot', triage.reply)
    setPhase(priorPhase)
  }

  const submitInitial = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    submitText(text)
  }

  const answer = (current: OrchestratorStep & { kind: 'ask' }, choice: Choice) => {
    // The patient's own chat bubble shows the PLAIN label, never the internal one.
    pushMessage('patient', choice.patientLabel)
    lastPatientRef.current = choice.patientLabel
    const newFilled: FilledVariables = {
      ...filled,
      [current.key]: { value: choice.value, confidence: 1 },
    }
    const newCandidates = { ...candidates }
    delete newCandidates[current.key]
    setFilled(newFilled)
    setCandidates(newCandidates)
    // Explicit tap → high-confidence, so this key is never re-confirmed.
    void advance(newFilled, newCandidates, new Set([current.key]))
  }

  const confirmYes = (current: OrchestratorStep & { kind: 'confirm' }) => {
    pushMessage('patient', "Yes, that's right")
    lastPatientRef.current = "Yes, that's right"
    const newFilled: FilledVariables = {
      ...filled,
      [current.key]: {
        value: current.candidate.value,
        confidence: Math.max(current.candidate.confidence, 0.8),
      },
    }
    const newCandidates = { ...candidates }
    delete newCandidates[current.key]
    setFilled(newFilled)
    setCandidates(newCandidates)
    void advance(newFilled, newCandidates, new Set([current.key]))
  }

  const confirmNo = (current: OrchestratorStep & { kind: 'confirm' }) => {
    pushMessage('patient', 'No, not quite')
    lastPatientRef.current = 'No, not quite'
    const newCandidates = { ...candidates }
    delete newCandidates[current.key] // now absent → next step asks fresh
    setCandidates(newCandidates)
    void advance(filled, newCandidates, new Set([current.key]))
  }

  // Shared retry (used by the normal error card AND the orb error step).
  const retryInDemo = () => {
    setMode('demo')
    void runExtraction(lastTextRef.current, 'demo')
  }

  // ── Presentation mode ON → the immersive ORB experience (same engine state &
  // handlers, just a one-step-at-a-time speaking-orb VIEW). Presentation mode OFF
  // falls through to the unchanged normal Runner below. Nothing else differs.
  if (presentation) {
    return (
      <OrbExperience
        messages={messages}
        phase={phase}
        step={step}
        draft={draft}
        error={error}
        onDraft={setDraft}
        onSubmitInitial={submitInitial}
        onAnswer={answer}
        onText={submitText}
        onConfirmYes={confirmYes}
        onConfirmNo={confirmNo}
        onRetry={retryInDemo}
      />
    )
  }

  return (
    <div className={`mx-auto w-full px-6 ${presentation ? 'max-w-2xl py-10' : 'max-w-6xl py-8'}`}>
      {/* ── LAYER 1 · Presenter / demo apparatus (hidden in Presentation mode) ── */}
      {!presentation && (
        <PresenterBar
          mode={mode}
          onModeChange={setMode}
          onReset={reset}
          onLoadSample={setDraft}
          usingFallback={usingFallback}
          treeId={tree.treeId}
          onEnterPresentation={onTogglePresentation}
        />
      )}

      {/* ── LAYERS 2 + 3 · Patient app (hero) + behind-the-scenes (clinician) ── */}
      <div
        className={
          presentation ? '' : 'mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start'
        }
      >
        {/* LAYER 2 · the real product */}
        <div className="min-w-0 space-y-4">
          <PatientApp
            messages={messages}
            phase={phase}
            step={step}
            draft={draft}
            onDraft={setDraft}
            onSubmitInitial={submitInitial}
            onAnswer={answer}
            onText={submitText}
            onConfirmYes={confirmYes}
            onConfirmNo={confirmNo}
          />

          {phase === 'done' && step?.kind === 'route' && (
            <ReferralSentCard specialist={step.specialist} />
          )}
          {phase === 'done' && step?.kind === 'escalate' && <EscalatedCard />}

          {phase === 'error' && (
            <div className="omari-reveal rounded-xl border border-danger/30 bg-danger/5 p-4">
              <p className="text-sm font-semibold text-danger">Something went wrong</p>
              <p className="mt-1 text-xs text-danger/80">{error}</p>
              <button
                onClick={() => {
                  setMode('demo')
                  void runExtraction(lastTextRef.current, 'demo')
                }}
                className="mt-3 rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                Switch to Demo mode &amp; retry
              </button>
            </div>
          )}
        </div>

        {/* LAYER 3 · behind-the-scenes (clinician view) — hidden in Presentation mode */}
        {!presentation && (
          <BehindScenes
            tree={tree}
            filled={filled}
            candidates={candidates}
            step={step}
            messages={messages}
          />
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* LAYER 1 · Presenter bar                                                      */
/* -------------------------------------------------------------------------- */

function PresenterBar({
  mode,
  onModeChange,
  onReset,
  onLoadSample,
  usingFallback,
  treeId,
  onEnterPresentation,
}: {
  mode: ExtractionMode
  onModeChange: (m: ExtractionMode) => void
  onReset: () => void
  onLoadSample: (text: string) => void
  usingFallback: boolean
  treeId: string
  onEnterPresentation: () => void
}) {
  return (
    <div className="omari-enter-bar rounded-xl border border-dashed border-line bg-bg/70 p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Demo controls
        </span>
        <span className="hidden text-[11px] text-muted sm:inline">
          Presenter apparatus — not part of the patient app.
        </span>

        <button
          onClick={onEnterPresentation}
          className="omari-grad omari-grad-hover ml-auto inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold text-white shadow-[0_1px_3px_rgba(37,99,235,0.35)] transition-all hover:shadow-[0_2px_10px_rgba(37,99,235,0.35)] active:translate-y-px"
          title="Hide all demo + clinician scaffolding for a pure patient view"
        >
          <span aria-hidden>▶</span> Presentation mode
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <ModeToggle mode={mode} onChange={onModeChange} />
        <button
          onClick={onReset}
          className="rounded-md border border-line bg-canvas px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-bg"
        >
          Reset demo
        </button>

        <span className="mx-1 hidden h-5 w-px bg-line sm:inline-block" aria-hidden />

        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Sample patients
        </span>
        {SAMPLE_CASES.map((c) => (
          <button
            key={c.label}
            onClick={() => onLoadSample(c.text)}
            title={c.text}
            className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-left transition-all hover:-translate-y-px hover:border-accent/40 hover:bg-sky"
          >
            <span className="block text-xs font-medium text-ink">{c.label}</span>
            <span className="block text-[10px] leading-tight text-muted">{c.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-line/70 pt-2.5">
        {usingFallback ? (
          <p className="text-[11px] text-muted">
            <span className="font-medium text-ink">No saved tree yet</span> — using the seeded
            sample. Build &amp; save one in the Builder to route against your own logic.
          </p>
        ) : (
          <p className="text-[11px] text-muted">
            Routing against your saved tree{' '}
            <span className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink">
              {treeId}
            </span>
            .
          </p>
        )}
      </div>
    </div>
  )
}

/** Small, unobtrusive way back out of Presentation mode. */
function ExitPresentation({ onExit }: { onExit: () => void }) {
  return (
    <button
      onClick={onExit}
      className="omari-msg fixed bottom-4 right-4 z-50 inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas/90 px-3 py-1.5 text-xs font-medium text-muted shadow-[0_2px_10px_rgba(22,32,46,0.12)] backdrop-blur transition-colors hover:text-ink"
      title="Leave Presentation mode and show the demo + clinician panels again"
    >
      <span aria-hidden>✕</span> Exit presentation
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* LAYER 2 · Patient app                                                        */
/* -------------------------------------------------------------------------- */

function PatientApp({
  messages,
  phase,
  step,
  draft,
  onDraft,
  onSubmitInitial,
  onAnswer,
  onText,
  onConfirmYes,
  onConfirmNo,
}: {
  messages: ChatMessage[]
  phase: Phase
  step: OrchestratorStep | null
  draft: string
  onDraft: (text: string) => void
  onSubmitInitial: () => void
  onAnswer: (current: OrchestratorStep & { kind: 'ask' }, choice: Choice) => void
  onText: (text: string) => void
  onConfirmYes: (current: OrchestratorStep & { kind: 'confirm' }) => void
  onConfirmNo: (current: OrchestratorStep & { kind: 'confirm' }) => void
}) {
  const threadRef = useRef<HTMLDivElement>(null)
  // Keep the latest turn / typing indicator in view as the conversation grows.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, phase])

  // During 'thinking' the animated typing bubble carries the state — no footer.
  const showFooter = phase === 'intro' || phase === 'awaiting'

  return (
    <div className="omari-msg overflow-hidden rounded-2xl border border-line bg-canvas shadow-[0_1px_3px_rgba(22,32,46,0.07)]">
      {/* Product header — reads like a real clinic intake widget */}
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <img src="/omari-logo.png" alt="" aria-hidden className="h-8 w-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="font-display text-[13px] font-semibold leading-tight text-ink">
            Omari
          </p>
          <p className="truncate text-[11px] leading-tight text-muted">
            AI care coordinator · here to help you find the right specialist
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> Secure
        </span>
      </div>

      {/* Conversation thread */}
      <div ref={threadRef} className="max-h-[54vh] space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m) => (
          <ChatBubble key={m.id} from={m.from} text={m.text} />
        ))}
        {phase === 'thinking' && <TypingBubble />}
      </div>

      {/* Input footer — swaps by phase */}
      {showFooter && (
        <div className="border-t border-line px-4 py-3">
          {phase === 'intro' && (
            <div>
              <textarea
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter inserts a newline (chat convention).
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSubmitInitial()
                  }
                }}
                rows={3}
                placeholder="e.g. I've had numbness and tingling in my hand for a few months…"
                className="w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-muted">Enter to send · Shift+Enter for a new line</span>
                <SendButton onClick={onSubmitInitial} disabled={!draft.trim()} />
              </div>
            </div>
          )}

          {phase === 'awaiting' && step?.kind === 'ask' && (
            <AskInput step={step} onAnswer={(c) => onAnswer(step, c)} onText={onText} />
          )}

          {phase === 'awaiting' && step?.kind === 'confirm' && (
            <ConfirmInput
              onYes={() => onConfirmYes(step)}
              onNo={() => onConfirmNo(step)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function SendButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="omari-grad omari-grad-hover rounded-md px-4 py-2 text-sm font-semibold text-white shadow-[0_1px_3px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0_2px_10px_rgba(37,99,235,0.3)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      Send
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Chat primitives                                                            */
/* -------------------------------------------------------------------------- */

function ChatBubble({ from, text }: { from: 'bot' | 'patient'; text: string }) {
  const isBot = from === 'bot'
  return (
    <div className={`omari-msg flex ${isBot ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[82%] px-3.5 py-2 text-sm leading-snug ${
          isBot
            ? 'rounded-2xl rounded-tl-sm border border-line bg-bg text-ink'
            : 'omari-grad rounded-2xl rounded-tr-sm text-white shadow-[0_1px_3px_rgba(37,99,235,0.25)]'
        }`}
      >
        {text}
      </div>
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="omari-msg flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-line bg-bg px-3.5 py-2.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" />
        <span className="ml-1.5 text-xs text-muted">Omari is typing…</span>
      </div>
    </div>
  )
}

/**
 * Hybrid input. For clear-choice questions, soft tappable chips (engine-derived
 * values) AND a free-text box so the patient can just talk instead — both feed
 * the same extraction. For open text/number questions, just the box.
 *
 * - chip tap        → onAnswer(choice)  (definitive value, confidence 1)
 * - "in your words" → onText(text)      (re-extracts this variable from prose)
 * - text/number box → onAnswer(value)   (direct, as before)
 */
function AskInput({
  step,
  onAnswer,
  onText,
}: {
  step: OrchestratorStep & { kind: 'ask' }
  onAnswer: (choice: Choice) => void
  onText: (text: string) => void
}) {
  const q = step.node
    ? deriveQuestion(step.node, step.spec)
    : { kind: 'text' as const, choices: [] as Choice[] }
  const [text, setText] = useState('')
  const isChoice = q.kind === 'choice' || q.kind === 'boolean'

  const submitTyped = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (isChoice) {
      // Patient chose to talk instead of tapping — let extraction read their words.
      onText(trimmed)
    } else {
      const value = q.kind === 'number' ? Number(trimmed) : trimmed
      if (q.kind === 'number' && Number.isNaN(value as number)) return
      onAnswer({ label: trimmed, patientLabel: trimmed, value })
    }
    setText('')
  }

  return (
    <div className="space-y-2.5">
      {q.kind === 'choice' && (
        <div className="flex flex-wrap gap-2">
          {q.choices.map((choice, i) => (
            <button
              key={i}
              onClick={() => onAnswer(choice)}
              className="rounded-full border border-line bg-canvas px-4 py-2 text-sm text-ink transition-all hover:-translate-y-px hover:border-accent hover:bg-sky hover:text-accent"
            >
              {choice.patientLabel}
            </button>
          ))}
        </div>
      )}

      {q.kind === 'boolean' && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onAnswer({ label: 'Yes', patientLabel: 'Yes', value: true })}
            className="rounded-full border border-line bg-canvas px-5 py-2 text-sm text-ink transition-all hover:-translate-y-px hover:border-accent hover:bg-sky hover:text-accent"
          >
            Yes
          </button>
          <button
            onClick={() => onAnswer({ label: 'No', patientLabel: 'No', value: false })}
            className="rounded-full border border-line bg-canvas px-5 py-2 text-sm text-ink transition-all hover:-translate-y-px hover:border-accent hover:bg-sky hover:text-accent"
          >
            No
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type={q.kind === 'number' ? 'number' : 'text'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitTyped()}
          placeholder={
            isChoice
              ? '…or just tell me in your own words'
              : q.kind === 'number'
                ? 'Enter a number'
                : 'Type your answer'
          }
          className="flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <SendButton onClick={submitTyped} disabled={!text.trim()} />
      </div>
    </div>
  )
}

/** Medium-confidence confirmation — visually distinct, reassuring "human in the loop". */
function ConfirmInput({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="rounded-lg border-l-2 border-accent bg-sky px-3 py-2.5">
      <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
        Just to confirm
      </p>
      <div className="flex gap-2">
        <button
          onClick={onYes}
          className="omari-grad omari-grad-hover rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-[0_1px_3px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0_2px_10px_rgba(37,99,235,0.3)] active:translate-y-px"
        >
          Yes, that's right
        </button>
        <button
          onClick={onNo}
          className="rounded-lg border border-line bg-canvas px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-bg"
        >
          No, not quite
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* LAYER 2 · Result cards (the payoff)                                          */
/* -------------------------------------------------------------------------- */

/**
 * PATIENT view when the engine routes. Framed as a PENDING referral that has
 * been sent to the matched specialist's team for human review — never a finished
 * plan. Shows who it went to + a real status stage + a NON-SPECIFIC heads-up.
 * Deliberately renders NO workup items (those aren't confirmed until a clinician
 * signs off; the full packet lives in the clinician panel).
 */
function ReferralSentCard({ specialist }: { specialist: Specialist }) {
  return (
    <div className="omari-reveal overflow-hidden rounded-2xl border border-line bg-canvas shadow-[0_2px_12px_rgba(22,32,46,0.08)]">
      {/* Calm, "in progress" header — a soft tint, not a solid "done" banner */}
      <div className="flex items-center gap-2 border-b border-line bg-nodespec/8 px-5 py-3">
        <span
          aria-hidden
          className="grid h-5 w-5 place-items-center rounded-full bg-nodespec/15 text-[11px] text-carolina-deep"
        >
          ↗
        </span>
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-carolina-deep">
          Referral sent for review
        </span>
      </div>
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm leading-snug text-ink">
          I’ve sent your referral to{' '}
          <span className="font-semibold">{specialist.specialistName}</span>’s team for review —{' '}
          {specialist.specialty}. They’ll confirm the match and follow up with you.
        </p>

        <StatusStepper reviewerLabel={`${specialist.specialistName}’s team`} />

        <div className="rounded-lg bg-sky px-3 py-2.5 text-sm leading-snug text-ink">
          Once {specialist.specialistName}’s team confirms, we’ll send you a short list of things to
          take care of before your appointment, so your visit is as productive as possible.
        </div>

        <p className="text-xs text-muted">
          You don’t need to do anything else right now — we’ll be in touch with your next steps.
        </p>
      </div>
    </div>
  )
}

/**
 * Honest, simple referral-status stages: Submitted → In review → Confirmed →
 * Scheduled. The current state is "In review" — a REAL workflow step (a human
 * confirms on the doctor dashboard), shown with later stages greyed/upcoming.
 */
export function StatusStepper({
  reviewerLabel,
  tone = 'accent',
}: {
  reviewerLabel: string
  tone?: 'accent' | 'amber' | 'green'
}) {
  const stages = [
    { label: 'Submitted', state: 'done' as const },
    { label: 'In review', state: 'current' as const },
    { label: 'Confirmed', state: 'upcoming' as const },
    { label: 'Scheduled', state: 'upcoming' as const },
  ]
  // Full static class strings (Tailwind can't see constructed class names).
  const t =
    tone === 'amber'
      ? {
          dotDone: 'bg-nodeesc border-nodeesc text-white',
          dotCurrent: 'bg-canvas border-nodeesc text-nodeesc ring-4 ring-nodeesc/15',
          connector: 'bg-nodeesc',
        }
      : tone === 'green'
        ? {
            dotDone: 'bg-success border-success text-white',
            dotCurrent: 'bg-canvas border-success text-success ring-4 ring-success/15',
            connector: 'bg-success',
          }
        : {
            dotDone: 'bg-accent border-accent text-white',
            dotCurrent: 'bg-canvas border-accent text-accent ring-4 ring-accent/15',
            connector: 'bg-accent',
          }

  const dotClass = (state: 'done' | 'current' | 'upcoming') => {
    const base =
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold'
    if (state === 'done') return `${base} ${t.dotDone}`
    if (state === 'current') return `${base} ${t.dotCurrent}`
    return `${base} bg-canvas border-line text-muted`
  }

  return (
    <div>
      <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        Referral status
      </p>
      {/* dots + connectors */}
      <div className="flex items-center">
        {stages.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span
                className={`h-0.5 flex-1 ${stages[i - 1].state === 'done' ? t.connector : 'bg-line'}`}
              />
            )}
            <span className={dotClass(s.state)}>{s.state === 'done' ? '✓' : i + 1}</span>
          </Fragment>
        ))}
      </div>
      {/* labels */}
      <div className="mt-1.5 flex">
        {stages.map((s, i) => (
          <span
            key={i}
            className={`flex-1 text-center text-[10px] leading-tight ${
              s.state === 'upcoming' ? 'text-muted' : 'font-medium text-ink'
            }`}
          >
            {s.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-center text-[11px] text-muted">
        Currently in review by <span className="font-medium text-ink">{reviewerLabel}</span>.
      </p>
    </div>
  )
}

/**
 * CLINICIAN view of the routed outcome — the reviewable referral packet that the
 * doctor dashboard will surface: matched specialist, urgency, reasoning, the FULL
 * proposed workup, and the decision path. This is the detail withheld from the
 * patient until a human confirms. Hidden in Presentation mode with the rest of
 * the behind-the-scenes panel.
 */
function ReferralPacket({
  specialist,
  filled,
  tree,
  pathTaken,
}: {
  specialist: Specialist
  filled: FilledVariables
  tree: Tree
  pathTaken: string[]
}) {
  const reasoning = fillTemplate(specialist.reasoningTemplate, specialist, filled)
  return (
    <div className="overflow-hidden rounded-lg border border-nodespec/30 bg-canvas">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-nodespec/8 px-3 py-2">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-carolina-deep">
          Referral for review
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${URGENCY_PANEL[specialist.urgency]}`}
        >
          {specialist.urgency}
        </span>
      </div>
      <div className="space-y-2.5 px-3 py-2.5">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-ink">{specialist.specialistName}</p>
            {specialist.confirmWithDrLi && (
              <span className="rounded bg-nodeesc/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nodeesc">
                ✓ Confirm with Dr. Li
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted">{specialist.specialty}</p>
        </div>

        <p className="rounded-md bg-sky px-2.5 py-1.5 text-[11px] italic leading-snug text-ink">
          {reasoning}
        </p>

        {specialist.clinicalBasis && (
          <p className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[11px] leading-snug text-muted">
            <span className="font-medium text-ink">Clinical basis:</span> {specialist.clinicalBasis}
          </p>
        )}

        <div>
          <p className="mb-1 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
            Proposed pre-visit workup
          </p>
          <ul className="space-y-1.5">
            {specialist.workup.map((item, i) => (
              <li key={i} className="rounded-md border border-line px-2.5 py-1.5">
                <p className="text-[11px] font-medium text-ink">{item.name}</p>
                <p className="text-[10px] leading-snug text-muted">
                  <span className="text-ink">Protocol:</span> {item.protocol}
                </p>
                <p className="text-[10px] leading-snug text-muted">
                  <span className="text-ink">Why:</span> {item.rationale}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
            Decision path
          </p>
          <PathStepper tree={tree} pathTaken={pathTaken} />
        </div>
      </div>
    </div>
  )
}

/**
 * PATIENT view for escalation — same honest human-in-the-loop framing as a
 * routed referral: sent to the clinical team for personal review, with a pending
 * status. Calm and reassuring; the clinical reason stays in the clinician panel,
 * not dropped on the patient.
 */
function EscalatedCard() {
  return (
    <div className="omari-reveal overflow-hidden rounded-2xl border border-nodeesc/40 bg-canvas shadow-[0_2px_12px_rgba(208,138,44,0.12)]">
      <div className="flex items-center gap-2 border-b border-line bg-nodeesc/10 px-5 py-3">
        <span
          aria-hidden
          className="grid h-5 w-5 place-items-center rounded-full bg-nodeesc/15 text-[11px] text-nodeesc"
        >
          ↗
        </span>
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-nodeesc">
          Sent for clinical review
        </span>
      </div>
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm leading-snug text-ink">
          To make sure you get exactly the right care, I’ve sent your information to our clinical
          team to review personally before anything is booked.
        </p>

        <StatusStepper reviewerLabel="our clinical team" tone="amber" />

        <p className="text-xs text-muted">
          Someone will follow up with you directly — you don’t need to do anything else right now.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* LAYER 3 · Behind-the-scenes (clinician view)                                */
/* -------------------------------------------------------------------------- */

function BehindScenes({
  tree,
  filled,
  candidates,
  step,
  messages,
}: {
  tree: Tree
  filled: FilledVariables
  candidates: Record<string, Extraction>
  step: OrchestratorStep | null
  messages: ChatMessage[]
}) {
  const filledEntries = Object.entries(filled)
  const pendingEntries = Object.entries(candidates)

  return (
    <aside className="omari-enter-side w-full shrink-0 space-y-3 rounded-xl border border-line bg-bg/80 p-3.5 lg:sticky lg:top-4">
      {/* Layer label — unmistakably NOT patient-facing */}
      <div className="border-b border-line/70 pb-2.5">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Behind the scenes · clinician view
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted">
          What the engine extracted and the path it’s taking — the patient never sees this.
        </p>
      </div>

      {/* Live decision-tree mini-viz — shown for BOTH real-API and simulated
          runs. Gated ONLY on Presentation mode: it lives in this clinician panel,
          which is already hidden in Presentation mode, so the patient never sees
          it. It reads the same orchestrator state either way (collected variables
          + result), so it works identically with real LLM extraction. */}
      <TreeMiniViz tree={tree} filled={filled} candidates={candidates} step={step} />

      {/* Extracted variables + confidence */}
      <div>
        <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Extracted variables
        </p>
        {filledEntries.length === 0 && pendingEntries.length === 0 ? (
          <p className="text-xs text-muted">Nothing yet — answer the first question.</p>
        ) : (
          <ul className="space-y-2">
            {filledEntries.map(([key, v]) => (
              <VariableRow key={key} name={key} value={v.value} confidence={v.confidence} />
            ))}
            {pendingEntries.map(([key, c]) => (
              <VariableRow key={key} name={key} value={c.value} confidence={c.confidence} pending />
            ))}
          </ul>
        )}
      </div>

      {/* Terminal outcome → the reviewable referral packet (what the doctor
          dashboard will surface). Mid-conversation → the live path so far. */}
      {step?.kind === 'route' ? (
        <div className="border-t border-line/70 pt-3">
          <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-carolina-deep">
            Referral for review · clinician view
          </p>
          <p className="mb-2.5 text-[11px] leading-snug text-muted">
            Awaiting a clinician to confirm this match. The patient sees only that it was sent —
            not this detail.
          </p>
          <ReferralPacket
            specialist={step.specialist}
            filled={filled}
            tree={tree}
            pathTaken={step.pathTaken}
          />
        </div>
      ) : step?.kind === 'escalate' ? (
        <EscalationPacket tree={tree} reason={step.reason} pathTaken={step.pathTaken} analysis={step.analysis} />
      ) : step ? (
        <div className="border-t border-line/70 pt-3">
          <p className="mb-3 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Path taken
          </p>
          <PathStepper tree={tree} pathTaken={step.pathTaken} />
        </div>
      ) : null}

      {/* Transcript */}
      <div className="border-t border-line/70 pt-3">
        <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Transcript
        </p>
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {messages.map((m) => (
            <li key={m.id} className="text-[11px] leading-snug">
              <span className={m.from === 'bot' ? 'text-muted' : 'font-medium text-accent'}>
                {m.from === 'bot' ? 'Q' : 'A'}:
              </span>{' '}
              <span className="text-ink">{m.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

/** The reviewable escalation packet — category, reason, clarify/gather record, path. */
function EscalationPacket({
  tree,
  reason,
  pathTaken,
  analysis,
}: {
  tree: Tree
  reason?: string
  pathTaken: string[]
  analysis?: EscalationAnalysis
}) {
  const label = analysis ? escalationCategoryLabel(analysis) : 'Flagged for review'
  const badgeTone =
    analysis?.category === 'emergency'
      ? 'bg-danger/10 text-danger'
      : analysis?.category === 'complex'
        ? 'bg-accent/12 text-accent'
        : 'bg-nodeesc/15 text-nodeesc'
  const clarified = analysis?.clarifiedKeys ?? []
  const gathered = analysis?.gatheredKeys ?? []
  return (
    <div className="border-t border-line/70 pt-3">
      <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-nodeesc">
        Referral for review · clinician view
      </p>
      <span
        className={`mb-2.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badgeTone}`}
      >
        {label}
      </span>
      <p className="mb-2 text-[11px] leading-snug text-muted">
        All collected variables (with confidence) are listed above — together with the below, this
        is the complete packet a clinician reviews.
      </p>
      {reason && (
        <p className="mb-2.5 rounded-md border border-nodeesc/30 bg-nodeesc/5 px-2.5 py-1.5 text-[11px] leading-snug text-ink">
          <span className="font-medium">Reason:</span> {reason}
        </p>
      )}
      {clarified.length > 0 && (
        <p className="mb-1.5 text-[11px] text-muted">
          <span className="font-medium text-ink">Clarification attempted:</span>{' '}
          <span className="font-mono">{clarified.join(', ')}</span>
        </p>
      )}
      {gathered.length > 0 && (
        <p className="mb-2.5 text-[11px] text-muted">
          <span className="font-medium text-ink">Standard intake gathered:</span>{' '}
          <span className="font-mono">{gathered.join(', ')}</span>
        </p>
      )}
      <p className="mb-1 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
        Decision path
      </p>
      <PathStepper tree={tree} pathTaken={pathTaken} />
    </div>
  )
}

/** Vertical path view — the sequence of engine decisions. */
function PathStepper({ tree, pathTaken }: { tree: Tree; pathTaken: string[] }) {
  return (
    <ol>
      {pathTaken.map((id, i) => {
        const node = tree.nodes.find((n) => n.id === id)
        const type = node?.type
        const name = node ? nodeDisplayName(node) : id
        const last = i === pathTaken.length - 1
        const dot =
          type === 'specialist'
            ? 'bg-nodespec'
            : type === 'escalation'
              ? 'bg-nodeesc'
              : 'bg-nodevar'
        const chip =
          type === 'specialist' ? 'Specialist' : type === 'escalation' ? 'Escalation' : 'Variable'
        return (
          <li key={i} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dot} ${
                  last ? 'ring-2 ring-line ring-offset-1' : ''
                }`}
              />
              {!last && <span className="h-6 w-px bg-line" />}
            </div>
            <div className="pb-1.5">
              <span className="font-display text-[9px] uppercase tracking-[0.08em] text-muted">
                {chip}
              </span>
              <p className={`text-xs ${last ? 'font-semibold text-ink' : 'text-muted'}`}>{name}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** One extracted variable: value + a colour-coded confidence meter. */
function VariableRow({
  name,
  value,
  confidence,
  pending,
}: {
  name: string
  value: unknown
  confidence: number
  pending?: boolean
}) {
  const band = confidenceBand(confidence)
  const meter =
    band === 'high' ? 'bg-accent' : band === 'medium' ? 'bg-nodeesc' : 'bg-danger'
  const chip =
    band === 'high'
      ? 'bg-accent/12 text-accent'
      : band === 'medium'
        ? 'bg-nodeesc/15 text-nodeesc'
        : 'bg-danger/10 text-danger'
  const pct = Math.round(confidence * 100)
  return (
    <li className="rounded-md border border-line bg-canvas px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-muted">{name}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip}`}>
          {pct}%
        </span>
      </div>
      <div className="mt-0.5 text-xs text-ink">
        {String(value)}
        {pending && <span className="ml-1 text-[10px] text-muted">(unconfirmed)</span>}
      </div>
      {/* Confidence meter — width animates as values update */}
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${meter} transition-[width] duration-500 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: ExtractionMode
  onChange: (m: ExtractionMode) => void
}) {
  const demo = mode === 'demo'
  return (
    <button
      onClick={() => onChange(demo ? 'live' : 'demo')}
      className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm transition-colors hover:bg-bg"
      title="Demo mode uses a simulated extractor; Live calls the real AI through the backend."
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${demo ? 'bg-accent' : 'bg-success'}`}
      />
      <span className="font-medium text-ink">
        {demo ? 'Demo mode (simulated AI)' : 'Live AI mode'}
      </span>
    </button>
  )
}

export default Runner
