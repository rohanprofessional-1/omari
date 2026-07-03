/**
 * Blume — confidence thresholds + the safe-by-default policy.
 *
 * The extractor returns a confidence 0–1 per variable. What the engine does with
 * a value depends on that confidence, and those cutoffs are a SAFETY control, so
 * they are configurable (globally and per-variable) rather than hard-coded:
 *
 *   confidence ≥ commit   → COMMIT   (route on it)
 *   confirm ≤ conf < commit → CONFIRM (ask the patient "is that right?")
 *   confidence < confirm   → DISCARD  (too uncertain — ask the question fresh;
 *                                       NEVER guess)
 *
 * Raising `commit` makes routing more cautious (more confirmations); raising
 * `confirm` makes the model refuse to even guess more often. Per-variable
 * overrides let a high-stakes variable (e.g. a red-flag) demand more certainty.
 */

export type Band = 'commit' | 'confirm' | 'discard'

export interface Thresholds {
  /** ≥ this → commit and route on the value. */
  commit: number
  /** ≥ this (and < commit) → confirm with the patient; below → discard. */
  confirm: number
  /** Optional stricter/looser cutoffs for specific variables. */
  perVariable?: Record<string, { commit?: number; confirm?: number }>
}

export const DEFAULT_THRESHOLDS: Thresholds = { commit: 0.8, confirm: 0.5 }

const STORAGE_KEY = 'omari:thresholds'

export function resolveBand(key: string, confidence: number, t: Thresholds): Band {
  const commit = t.perVariable?.[key]?.commit ?? t.commit
  const confirm = t.perVariable?.[key]?.confirm ?? t.confirm
  if (confidence >= commit) return 'commit'
  if (confidence >= confirm) return 'confirm'
  return 'discard'
}

/** Shape `planConversationStep`/`classifyEscalation` expect (`high`/`medium`). */
export function toEngineThresholds(t: Thresholds): { high: number; medium: number } {
  return { high: t.commit, medium: t.confirm }
}

export function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_THRESHOLDS
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

export function saveThresholds(t: Thresholds): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t))
  } catch {
    /* ignore unavailable storage */
  }
}

export const BAND_LABEL: Record<Band, string> = {
  commit: 'Commit',
  confirm: 'Confirm',
  discard: 'Re-ask',
}
