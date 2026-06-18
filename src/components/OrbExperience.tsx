import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { deriveQuestion, type Choice } from '../lib/runner'
import type { OrchestratorStep } from '../lib/orchestrator'
import type { ChatMessage, Phase } from '../pages/Runner'
import { StatusStepper } from '../pages/Runner'
import { Orb, type AgentState } from './Orb'
import { BubbleBackground } from './BubbleBackground'

/**
 * Omari — Presentation-mode ORB experience (presentation-only patient view).
 *
 * ⚠️ SCOPE: this renders ONLY when Presentation mode is ON. It is a pure
 * PRESENTATION of the engine-driven state owned by RunnerSession — it consumes
 * the same `messages`/`phase`/`step` and the same answer handlers, and changes
 * nothing about the engine, extraction, orchestration, confirmation logic, or
 * patient-label handling. It just shows ONE moment at a time, full-screen, with
 * a reactive orb and optional spoken voice. Works identically with the real LLM
 * (Demo mode off) and the simulated extractor.
 *
 * The orb itself is the WebGL shader <Orb/> (src/components/Orb.tsx). It is
 * driven purely by this view's existing flow state via its `agentState` prop —
 * no parallel/competing animation state. Because the whole experience mounts
 * ONLY in Presentation mode, exactly one WebGL canvas exists, and it unmounts
 * (disposing the context) the moment Presentation mode is turned off.
 */

/* On-brand orb palettes fed to the shader's two-stop colour ramp.
 *  - BLUE  (--grad-blue family): the default presence through the conversation.
 *  - GREEN (--color-success family): the referral-sent success beat. The orb
 *    lerps its colours, so switching the prop EASES blue → green, never snaps. */
const ORB_COLORS_BLUE: [string, string] = ['#2f6dee', '#9dc0ff']
// [deeper companion, friendly light #88E788]. The shader ramp is
// [black → colors[0] → colors[1] → white], so #88E788 sits in the upper/highlight
// slot (dominates the highlight) while the deeper companion gives shadow depth —
// dimensional, not a flat single light tone.
const ORB_COLORS_GREEN: [string, string] = ['#2e9e5b', '#88e788']

/** Calm the orb when the OS asks for reduced motion (stable, minimal volume). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])
  return reduced
}

/* -------------------------------------------------------------------------- */
/* Inputs — calm, immersive, but SAME handlers + patient labels               */
/* -------------------------------------------------------------------------- */

const pillBtn =
  'rounded-full border border-accent/30 bg-canvas/85 px-5 py-2.5 text-[15px] text-ink shadow-sm ' +
  'transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-sky hover:text-accent'
const primaryBtn =
  'omari-grad omari-grad-hover rounded-full px-6 py-2.5 text-sm font-semibold text-white ' +
  'shadow-[0_2px_10px_rgba(37,99,235,0.3)] transition-all active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40'

// Boxed input — extra bottom padding leaves room for the mic + send buttons that
// sit INSIDE the box at the bottom-right. `omari-quiet-focus` replaces the bright
// blue focus ring with a soft, barely-there border tint + faint shadow.
const inputBoxCls =
  'omari-quiet-focus w-full resize-none rounded-2xl border border-line bg-canvas/85 px-4 pt-3 pb-14 ' +
  'text-base leading-relaxed text-ink shadow-sm placeholder:text-muted'

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  )
}

/** Voice-mode toggle — visual placeholder for now (not yet wired up). */
function VoiceButton() {
  return (
    <button
      type="button"
      title="Voice mode (coming soon)"
      aria-label="Voice mode"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-canvas text-muted transition-colors hover:border-accent/40 hover:bg-sky hover:text-accent"
    >
      <MicIcon className="h-[18px] w-[18px]" />
    </button>
  )
}

/** Send/Begin — same calm WHITE style as the voice button (no gradient, no icon). */
function SendButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-line bg-canvas px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent/40 hover:bg-sky hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function OrbIntro({
  draft,
  onDraft,
  onSubmit,
}: {
  draft: string
  onDraft: (t: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="relative w-full max-w-xl">
      <textarea
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        rows={3}
        placeholder="Tell me what’s going on, in your own words…"
        className={inputBoxCls}
      />
      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        <VoiceButton />
        <SendButton onClick={onSubmit} disabled={!draft.trim()} label="Begin" />
      </div>
    </div>
  )
}

function OrbAsk({
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
      onText(trimmed) // patient chose to talk instead of tapping — re-extract their words
    } else {
      const value = q.kind === 'number' ? Number(trimmed) : trimmed
      if (q.kind === 'number' && Number.isNaN(value as number)) return
      onAnswer({ label: trimmed, patientLabel: trimmed, value })
    }
    setText('')
  }

  return (
    <div className="w-full max-w-xl space-y-4">
      {q.kind === 'choice' && (
        <div className="flex flex-wrap justify-center gap-2.5">
          {q.choices.map((choice, i) => (
            <button key={i} onClick={() => onAnswer(choice)} className={pillBtn}>
              {choice.patientLabel}
            </button>
          ))}
        </div>
      )}

      {q.kind === 'boolean' && (
        <div className="flex justify-center gap-3">
          <button
            onClick={() => onAnswer({ label: 'Yes', patientLabel: 'Yes', value: true })}
            className={pillBtn}
          >
            Yes
          </button>
          <button
            onClick={() => onAnswer({ label: 'No', patientLabel: 'No', value: false })}
            className={pillBtn}
          >
            No
          </button>
        </div>
      )}

      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submitTyped()
            }
          }}
          rows={2}
          inputMode={q.kind === 'number' ? 'numeric' : undefined}
          placeholder={
            isChoice
              ? '…or just say it in your own words'
              : q.kind === 'number'
                ? 'Enter a number'
                : 'Type your answer'
          }
          className={inputBoxCls}
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <VoiceButton />
          <SendButton onClick={submitTyped} disabled={!text.trim()} label="Send" />
        </div>
      </div>
    </div>
  )
}

function OrbConfirm({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      <button onClick={onYes} className={primaryBtn}>
        Yes, that’s right
      </button>
      <button
        onClick={onNo}
        className="rounded-full border border-line bg-canvas/85 px-6 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-bg"
      >
        No, not quite
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The experience                                                              */
/* -------------------------------------------------------------------------- */

export interface OrbExperienceProps {
  messages: ChatMessage[]
  phase: Phase
  step: OrchestratorStep | null
  draft: string
  error: string | null
  onDraft: (t: string) => void
  onSubmitInitial: () => void
  onAnswer: (current: OrchestratorStep & { kind: 'ask' }, choice: Choice) => void
  onText: (text: string) => void
  onConfirmYes: (current: OrchestratorStep & { kind: 'confirm' }) => void
  onConfirmNo: (current: OrchestratorStep & { kind: 'confirm' }) => void
  onRetry: () => void
}

function OrbExperience({
  messages,
  phase,
  step,
  draft,
  error,
  onDraft,
  onSubmitInitial,
  onAnswer,
  onText,
  onConfirmYes,
  onConfirmNo,
  onRetry,
}: OrbExperienceProps) {
  const reducedMotion = usePrefersReducedMotion()
  const [justArrived, setJustArrived] = useState(false)

  // The single "moment" Omari is presenting = the most recent thing it said.
  const lastBot = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].from === 'bot') return messages[i]
    }
    return undefined
  }, [messages])

  // A stable identity for the current step so a NEW moment cross-fades in
  // exactly once (and 'thinking' is its own beat, replacing any typing dots).
  const stepKey =
    phase === 'thinking'
      ? 'thinking'
      : phase === 'error'
        ? 'error'
        : phase === 'done'
          ? `done-${step?.kind ?? ''}`
          : phase === 'intro'
            ? 'intro'
            : `msg-${lastBot?.id ?? 0}`

  // Whether this moment carries a message (drives the brief arrival bloom).
  const hasMoment = phase !== 'thinking' && phase !== 'error' && !!lastBot?.text
  // No "One moment…" — thinking is shown by the ORB's animation (see agentState),
  // so the text area carries only real messages / errors.
  const displayText = phase === 'error' ? error ?? 'Something went wrong.' : lastBot?.text ?? ''

  // On each new moment: a brief warm "reaction" bloom on the orb.
  useEffect(() => {
    if (!hasMoment) return
    setJustArrived(true)
    const t = setTimeout(() => setJustArrived(false), 1100)
    return () => clearTimeout(t)
    // Intentionally keyed on the moment identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey])

  // Map the SAME flow state onto the shader orb's agentState — no parallel state:
  //   engine/LLM running ............... 'thinking'
  //   presenting a new message .......... 'talking'   (brief arrival bloom)
  //   awaiting / handling the answer .... 'listening'
  //   done / error / idle ............... null
  const agentState: AgentState =
    phase === 'thinking'
      ? 'thinking'
      : justArrived
        ? 'talking'
        : phase === 'awaiting' || phase === 'intro'
          ? 'listening'
          : null

  // The referral-sent success beat: orb eases to green, a soft green edge glow
  // frames the screen, and the status timeline appears. Routed AND escalation
  // handoffs share this patient-facing green treatment.
  const done = phase === 'done'
  const orbColors = done ? ORB_COLORS_GREEN : ORB_COLORS_BLUE
  // Pull the matched specialist straight from the engine's routing result — never
  // hardcoded, so it shows whoever THIS patient was routed to (or escalation).
  const isEscalation = step?.kind === 'escalate'
  const specialistName = step?.kind === 'route' ? step.specialist.specialistName : undefined
  const specialty = step?.kind === 'route' ? step.specialist.specialty : undefined
  const reviewerLabel =
    step?.kind === 'route'
      ? `${step.specialist.specialistName}’s team`
      : step?.kind === 'escalate'
        ? 'our clinical team'
        : 'our team'

  let inputArea: ReactNode = null
  if (phase === 'intro') {
    inputArea = <OrbIntro draft={draft} onDraft={onDraft} onSubmit={onSubmitInitial} />
  } else if (phase === 'awaiting' && step?.kind === 'ask') {
    inputArea = <OrbAsk step={step} onAnswer={(c) => onAnswer(step, c)} onText={onText} />
  } else if (phase === 'awaiting' && step?.kind === 'confirm') {
    inputArea = <OrbConfirm onYes={() => onConfirmYes(step)} onNo={() => onConfirmNo(step)} />
  } else if (phase === 'error') {
    inputArea = (
      <button
        onClick={onRetry}
        className="rounded-full bg-danger px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Switch to Demo mode &amp; retry
      </button>
    )
  }

  // The content shown BELOW the (fixed) orb for this step. During thinking it's
  // wordless — just the orb animating, plus a faint, calm pulse.
  const stepContent: ReactNode =
    phase === 'thinking' ? (
      <ThinkingDots />
    ) : done ? (
      <DoneSuccess
        escalation={isEscalation}
        specialistName={specialistName}
        specialty={specialty}
        reviewerLabel={reviewerLabel}
      />
    ) : (
      <>
        <p
          role="status"
          aria-live="polite"
          className="max-w-2xl text-balance font-display text-[19px] leading-relaxed text-ink sm:text-[21px]"
        >
          {displayText}
        </p>
        {inputArea}
      </>
    )

  return (
    <div
      className="omari-orb-stage fixed inset-0 z-40 flex flex-col"
      style={{
        background:
          'radial-gradient(120% 85% at 50% 12%, #eef4ff 0%, #f5f7fa 52%, #eaeefb 100%)',
      }}
    >
      {/* Animated blue/white "gooey" bubble background — calm ambient motion
          behind everything. Skipped under reduced-motion (the static light
          gradient above remains). pointer-events-none so it never blocks input. */}
      {!reducedMotion && (
        <div className="pointer-events-none absolute inset-0 z-0 opacity-60" aria-hidden>
          <BubbleBackground />
        </div>
      )}

      {/* Soft white center scrim — keeps the dark text/orb area legible over the
          moving blobs, so the overlay reads seamlessly. */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(60% 52% at 50% 46%, rgba(245,247,250,0.5) 0%, rgba(245,247,250,0) 72%)',
        }}
      />

      {/* Soft, ambient green edge glow — referral-sent success beat ONLY. */}
      {done && <div className="omari-success-glow pointer-events-none absolute inset-0 z-0" aria-hidden />}

      <div
        className="relative z-10 flex flex-1 flex-col items-center px-6"
        style={{ paddingTop: 'clamp(14px, 4vh, 56px)' }}
      >
        {/* The WebGL shader orb — ANCHORED at a fixed offset + size for the ENTIRE
            experience. It never relayouts/moves between steps (including while
            thinking); only its own internal animation changes via `agentState`,
            and its colours ease blue → green on referral-sent. The footprint is
            kept compact so the content below (question + many chips + input) fits. */}
        <div
          className="pointer-events-none shrink-0"
          style={{ width: 'clamp(170px, 26vw, 260px)', height: 'clamp(170px, 26vw, 260px)' }}
        >
          <Orb
            agentState={agentState}
            colors={orbColors}
            volumeMode={reducedMotion ? 'manual' : 'auto'}
            manualInput={reducedMotion ? 0 : undefined}
            manualOutput={reducedMotion ? 0.1 : undefined}
          />
        </div>

        {/* Content region BELOW the orb — fills the remaining height and scrolls
            internally if needed (generous bottom padding so the input box is never
            clipped), so the orb above stays put. The text gently cross-fades
            between steps (fade out → brief beat → fade in). */}
        <div className="relative mt-5 flex w-full max-w-2xl flex-1 flex-col items-center overflow-y-auto pb-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={stepKey}
              // A gentle cross-fade: quick fade-OUT of the previous beat, then a
              // clearly SLOW fade-IN of the next once it's ready (no sudden pop).
              // Opacity-only (not transform), so it stays calm even under
              // reduced-motion — we just shorten it a touch there.
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { duration: reducedMotion ? 0.35 : 0.85, ease: 'easeOut' },
              }}
              exit={{
                opacity: 0,
                transition: { duration: reducedMotion ? 0.15 : 0.35, ease: 'easeIn' },
              }}
              className="flex w-full flex-col items-center gap-5 text-center"
            >
              {stepContent}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/** Wordless thinking cue — a faint, calm pulse beneath the (animating) orb. */
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 pt-2" role="status" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="omari-think-dot h-1.5 w-1.5 rounded-full bg-accent/45"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  )
}

/**
 * Referral-sent success beat — a minimal three-beat hierarchy (warm headline →
 * the matched specialist as the bold focal point, specialty muted beneath → one
 * short reassurance line), then the existing referral-status timeline (reused,
 * green tone) which carries the "sent for review / what happens next / nothing
 * to do now" meaning. The specialist is pulled live from the routing result.
 * Layout: orb (above) → headline → specialist → short line → timeline.
 */
function DoneSuccess({
  escalation,
  specialistName,
  specialty,
  reviewerLabel,
}: {
  escalation: boolean
  specialistName?: string
  specialty?: string
  reviewerLabel: string
}) {
  return (
    <div className="flex w-full flex-col items-center gap-9">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3"
      >
        {/* Beat 1 — warm headline (largest). */}
        <h2 className="font-display text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">
          You’re all set.
        </h2>

        {/* Beat 2 — the focal point: the matched specialist (name bold). */}
        {escalation ? (
          <p className="font-display text-[18px] font-semibold text-ink sm:text-[20px]">
            Sent to our clinical team for review
          </p>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <p className="font-display text-[18px] text-ink sm:text-[20px]">
              Routed to <span className="font-semibold">{specialistName}’s team</span>
            </p>
            {specialty && <p className="text-sm text-muted">{specialty}</p>}
          </div>
        )}

        {/* Beat 3 — one quiet supporting line. */}
        <p className="max-w-md text-[15px] leading-relaxed text-muted">
          {escalation
            ? 'They’ll take a closer look and reach out about next steps.'
            : 'They’ll review your referral and reach out about next steps.'}
        </p>
      </div>

      {/* The timeline carries "sent → in review → confirmed → scheduled". */}
      <div className="w-full max-w-sm text-left">
        <StatusStepper reviewerLabel={reviewerLabel} tone="green" />
      </div>
    </div>
  )
}

export default OrbExperience
