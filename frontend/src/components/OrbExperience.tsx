import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { deriveQuestion, type Choice } from '../lib/runner'
import type { OrchestratorStep } from '../lib/orchestrator'
import type { ChatMessage, Phase } from '../pages/runner/chatTypes'
import StatusStepper from './StatusStepper'
import VoiceOrb, { ORB_BLUE, ORB_GREEN, useVoiceCapture, type VoiceCapture } from './VoiceOrb'

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
 * The orb itself is the voice-reactive <VoiceOrb/> (src/components/VoiceOrb.tsx)
 * — an OGL iridescence shader driven by the patient's live microphone level.
 * This view owns the ONE voice session (useVoiceCapture): the mic button inside
 * the input box toggles it, and while live it BOTH streams talk-to-text into
 * the mounted input and animates the orb via the shared level ref. The view
 * also feeds the orb a target colour (blue through the conversation, easing to
 * green on the referral-sent beat) and a `calm` flag under
 * prefers-reduced-motion. Because the whole experience mounts ONLY in
 * Presentation mode, exactly one WebGL canvas exists, and it unmounts
 * (disposing the context) the moment Presentation mode is turned off.
 */

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
  'shadow-[0_2px_10px_rgba(27,58,107,0.30)] transition-all active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40'

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

/** Voice toggle — starts/stops the ONE voice session (mic → talk-to-text into
 *  the active input AND the orb's speaking animation via its level). */
function VoiceButton({ voice }: { voice: VoiceCapture }) {
  const title = voice.listening
    ? voice.error
      ? `${voice.error} — the orb still hears you; tap to stop`
      : 'Stop voice input'
    : voice.error
      ? `${voice.error} — tap to retry`
      : voice.supported
        ? 'Speak your answer'
        : 'Voice-to-text is not supported in this browser'
  return (
    <button
      type="button"
      onClick={voice.toggle}
      title={title}
      aria-label={voice.listening ? 'Stop voice input' : 'Start voice input'}
      aria-pressed={voice.listening}
      className={
        voice.listening
          ? 'omari-grad grid h-10 w-10 shrink-0 animate-pulse place-items-center rounded-full text-white shadow-[0_2px_10px_rgba(27,58,107,0.30)] transition-colors'
          : 'grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-canvas text-muted transition-colors hover:border-accent/40 hover:bg-sky hover:text-accent'
      }
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

/** Append a spoken chunk to whatever is already typed (single joining space). */
function appendChunk(current: string, chunk: string): string {
  const base = current.replace(/\s+$/, '')
  return base ? `${base} ${chunk}` : chunk
}

function OrbIntro({
  draft,
  onDraft,
  onSubmit,
  voice,
}: {
  draft: string
  onDraft: (t: string) => void
  onSubmit: () => void
  voice: VoiceCapture
}) {
  // While this input is mounted, spoken (final) phrases land in the draft.
  useEffect(() => {
    voice.transcriptRef.current = (chunk) => onDraft(appendChunk(draft, chunk))
  })
  useEffect(
    () => () => {
      voice.transcriptRef.current = null
    },
    [voice]
  )

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
        <VoiceButton voice={voice} />
        <SendButton onClick={onSubmit} disabled={!draft.trim()} label="Begin" />
      </div>
    </div>
  )
}

function OrbAsk({
  step,
  onAnswer,
  onText,
  voice,
}: {
  step: OrchestratorStep & { kind: 'ask' }
  onAnswer: (choice: Choice) => void
  onText: (text: string) => void
  voice: VoiceCapture
}) {
  const q = step.node
    ? deriveQuestion(step.node, step.spec)
    : { kind: 'text' as const, choices: [] as Choice[] }
  const [text, setText] = useState('')
  const isChoice = q.kind === 'choice' || q.kind === 'boolean'

  // While this input is mounted, spoken (final) phrases land in the answer box.
  useEffect(() => {
    voice.transcriptRef.current = (chunk) => setText((prev) => appendChunk(prev, chunk))
    return () => {
      voice.transcriptRef.current = null
    }
  }, [voice])

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
          <VoiceButton voice={voice} />
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

  // The ONE voice session for the whole experience — toggled by the mic button
  // in the input box. Its level drives the orb; its transcript feeds the input.
  const voice = useVoiceCapture()

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

  // The text area carries only real messages / errors — the orb itself is the
  // "presence"; its motion comes from the patient's voice, not the flow state.
  const displayText = phase === 'error' ? error ?? 'Something went wrong.' : lastBot?.text ?? ''

  // The referral-sent success beat: orb eases to green, a soft green edge glow
  // frames the screen, and the status timeline appears. Routed AND escalation
  // handoffs share this patient-facing green treatment.
  const done = phase === 'done'
  const orbColor = done ? ORB_GREEN : ORB_BLUE
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
    inputArea = (
      <OrbIntro draft={draft} onDraft={onDraft} onSubmit={onSubmitInitial} voice={voice} />
    )
  } else if (phase === 'awaiting' && step?.kind === 'ask') {
    inputArea = (
      <OrbAsk step={step} onAnswer={(c) => onAnswer(step, c)} onText={onText} voice={voice} />
    )
  } else if (phase === 'awaiting' && step?.kind === 'confirm') {
    inputArea = <OrbConfirm onYes={() => onConfirmYes(step)} onNo={() => onConfirmNo(step)} />
  } else if (phase === 'error') {
    inputArea = (
      <button
        onClick={onRetry}
        className="rounded-full bg-danger px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Retry
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
          className="max-w-2xl text-balance font-serif text-[19px] leading-relaxed text-ink sm:text-[21px]"
        >
          {displayText}
        </p>
        {inputArea}
      </>
    )

  return (
    <div
      className="omari-orb-stage fixed inset-0 z-40 flex flex-col"
      style={{ background: '#f8f8f6' }}
    >
      {/* Soft, ambient green edge glow — referral-sent success beat ONLY. */}
      {done && <div className="omari-success-glow pointer-events-none absolute inset-0 z-0" aria-hidden />}

      <div
        className="relative z-10 flex flex-1 flex-col items-center px-6"
        style={{ paddingTop: 'clamp(14px, 4vh, 56px)' }}
      >
        {/* The voice-reactive orb — ANCHORED at a fixed offset + size for the
            ENTIRE experience. It never relayouts/moves between steps; its motion
            (pulse, glow, swirl speed) is driven by the patient's live microphone
            level, and its colour eases blue → green on referral-sent. The
            footprint is kept compact so the content below (question + many
            chips + input) fits. */}
        <div
          className="pointer-events-none shrink-0"
          style={{ width: 'clamp(170px, 26vw, 260px)', height: 'clamp(170px, 26vw, 260px)' }}
        >
          <VoiceOrb color={orbColor} levelRef={voice.levelRef} calm={reducedMotion} />
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
        <h2 className="font-serif text-[26px] font-normal text-ink sm:text-[30px]">
          You’re all set.
        </h2>

        {/* Beat 2 — the focal point: the matched specialist (name bold). */}
        {escalation ? (
          <p className="font-serif text-[18px] text-ink sm:text-[20px]">
            Sent to our clinical team for review
          </p>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <p className="font-serif text-[18px] text-ink sm:text-[20px]">
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
