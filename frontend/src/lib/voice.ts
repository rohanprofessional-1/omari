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

const DEFAULT_ENDPOINT = '/api/v1/voice'

/* -------------------------------------------------------------------------- */
/* Public entry — live backend, with a safe fallback to the raw question.      */
/* -------------------------------------------------------------------------- */

/**
 * Produce the warm, patient-facing version of the engine's question via the
 * safe backend (/api/voice); on ANY failure, falls back to the engine's plain
 * question so the conversation never breaks.
 */
export async function voiceTurn(
  input: VoiceTurnInput,
  opts: VoiceOptions = {},
): Promise<string> {
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
