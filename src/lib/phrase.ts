import type { VariableSpec } from '../types/tree'

/**
 * Blume — optional LLM question phrasing (kept on a tight leash).
 *
 * ⚠️ HARD RULE: the engine decides; the LLM only extracts and PHRASES. Phrasing
 * may ONLY soften the wording of a question. It must never change WHICH variable
 * is asked about, introduce any clinical content beyond the spec's question, or
 * combine questions. The deterministic engine still decides everything; this
 * function never sees the tree.
 *
 * DEFAULT is OFF: we return the surgeon-authored `patientQuestion` verbatim.
 * Only when explicitly enabled do we call Claude (through the same safe backend)
 * to reword that one question — and on ANY failure we fall back to the
 * hardcoded question, so behaviour stays safe and predictable.
 */

/** A minimal conversation turn (we only read role + text for tone). */
export interface ConversationTurn {
  role: string
  text: string
}

/**
 * Global toggle — USE_LLM_PHRASING. Default OFF. Flip `enabled` to true to allow
 * the LLM to soften phrasing; everything else falls back to the hardcoded text.
 */
export const phrasingConfig = { enabled: false }

/** Convenience setter for the global toggle. */
export function setLlmPhrasing(enabled: boolean): void {
  phrasingConfig.enabled = enabled
}

const DEFAULT_ENDPOINT = '/api/phrase'

interface PhraseOptions {
  /** Override the global toggle for this one call. */
  enabled?: boolean
  /** Override the backend URL (e.g. an absolute URL for a Node harness). */
  endpoint?: string
  signal?: AbortSignal
}

/**
 * Return a friendly, plain-language version of a variable's question.
 *
 * With phrasing OFF (the default) this is exactly `spec.patientQuestion`.
 * With phrasing ON it asks the backend to reword that single question, passing
 * ONLY the question text (+ optionally the patient's last turn for tone) — never
 * the tree, options, or any other clinical detail. Falls back to the hardcoded
 * question on any error.
 */
export async function phraseQuestion(
  spec: VariableSpec,
  transcriptSoFar: ConversationTurn[] = [],
  options: PhraseOptions = {},
): Promise<string> {
  const fallback = spec.patientQuestion
  const enabled = options.enabled ?? phrasingConfig.enabled

  // DEFAULT: hardcoded question, no LLM involved.
  if (!enabled) return fallback

  try {
    // The most recent patient turn — for TONE only. Never sent: the tree,
    // options, clinicalPrompt, or extractionHints.
    const lastPatientTurn = [...transcriptSoFar]
      .reverse()
      .find((t) => t.role === 'patient')?.text

    const response = await fetch(options.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: fallback, lastPatientTurn }),
      signal: options.signal,
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || `Phrasing request failed (${response.status}).`)
    }

    const data = (await response.json()) as { question?: unknown }
    const phrased = typeof data.question === 'string' ? data.question.trim() : ''
    return phrased || fallback
  } catch (err) {
    console.error('[Blume] phraseQuestion failed — using hardcoded question:', err)
    return fallback
  }
}
