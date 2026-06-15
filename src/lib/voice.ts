import type { ExtractionMode } from './extraction'

/**
 * Omari — the "voice layer" (presentation only).
 *
 * ⚠️ HARD RULE: the deterministic engine decides EVERY question and ALL routing.
 * This layer ONLY adds warm human wording + an acknowledgment around the question
 * the engine already chose. It never picks questions, never sees the tree or
 * specialist names, and the actual answer options shown to the patient are
 * rendered separately from the engine's spec — NOT from this text. So even a
 * worst-case voice output cannot change what is asked or how routing happens.
 *
 * SAFETY: Omari is a front-desk coordinator, not a doctor. It acknowledges the
 * patient's EXPERIENCE/feelings, never the medical meaning — no advice, no
 * diagnosis, no comment on severity. The system prompt that enforces this lives
 * server-side (/api/voice); the demo path below mirrors the same boundary.
 */

export interface VoiceTurnInput {
  /** The engine's exact chosen question (clinician-authored wording). */
  question: string
  /** Answer-option labels — for natural mention only; chips are rendered by the engine. */
  options?: string[]
  /** The patient's most recent message, to acknowledge warmly (experience, not medicine). */
  lastPatientMessage?: string
  /** When true, a brief light "almost there" encouragement may be added. */
  progressHint?: boolean
}

interface VoiceOptions {
  signal?: AbortSignal
  /** Override the backend URL (for harnesses). */
  endpoint?: string
}

const DEFAULT_ENDPOINT = '/api/voice'

/* -------------------------------------------------------------------------- */
/* Demo voice — offline, no API. Warm, varied, and NEVER medical.             */
/* -------------------------------------------------------------------------- */

// Acknowledgments rotate so the same phrase doesn't repeat back-to-back.
const DEMO_ACKS = [
  'Thanks for sharing that.',
  'Got it — that’s really helpful.',
  'Okay, thank you for walking me through that.',
  'That’s helpful, thank you.',
  'Appreciate you telling me that.',
]

// Worry/fear → comfort about the FEELING only, never the medicine.
const WORRY_RE = /\b(scared|afraid|worried|worry|nervous|anxious|anxiety|terrified|frightened|freaking out|panic|stressed)\b/i
const DEMO_WORRY_ACK =
  'That sounds really stressful, and I’m sorry you’re going through it — let’s get you to the right person.'

let demoAckCursor = 0

/** Reset rotation so a fresh conversation starts varied from the top. */
export function resetDemoVoice(): void {
  demoAckCursor = 0
}

function demoVoice(input: VoiceTurnInput): string {
  const last = input.lastPatientMessage ?? ''
  let ack = ''
  if (last.trim()) {
    if (WORRY_RE.test(last)) {
      ack = DEMO_WORRY_ACK
    } else {
      ack = DEMO_ACKS[demoAckCursor % DEMO_ACKS.length]
      demoAckCursor += 1
    }
  }
  const lead = ack ? ack + ' ' : ''
  const progress = input.progressHint ? 'We’re almost there — just a little more. ' : ''
  return `${lead}${progress}${input.question}`.trim()
}

/* -------------------------------------------------------------------------- */
/* Public entry — demo vs live, with a safe fallback to the raw question.      */
/* -------------------------------------------------------------------------- */

/**
 * Produce the warm, patient-facing version of the engine's question.
 * - demo → scripted, offline warmth (no network).
 * - live → the safe backend (/api/voice); on ANY failure, falls back to the
 *   engine's plain question so the conversation never breaks.
 */
export async function voiceTurn(
  input: VoiceTurnInput,
  mode: ExtractionMode,
  opts: VoiceOptions = {},
): Promise<string> {
  if (mode === 'demo') {
    return demoVoice(input)
  }

  try {
    const res = await fetch(opts.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: opts.signal,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Voice request failed (${res.status}).`)
    }
    const data = (await res.json()) as { message?: unknown }
    const message = typeof data.message === 'string' ? data.message.trim() : ''
    return message || input.question
  } catch (err) {
    // Never break the conversation — fall back to the hardcoded question.
    console.warn('[Omari voice] falling back to the plain question:', err)
    return input.question
  }
}
