/**
 * Blume — guided-setup session progress.
 *
 * PRESENTATION LAYER ONLY. Keeping the guideline writes no delta (there is
 * nothing to record — the guideline already says it), so "answered" state has
 * to live somewhere else or the flow can't show progress, can't survive a
 * reload, and can't list what was skipped at sign-off. This is that somewhere:
 * localStorage, keyed by tree. It never affects the compiled tree, and losing
 * it loses nothing clinical — only the sense of where you were.
 *
 * Question ids are built from NORMALIZED keys, never node ids, so progress
 * survives a guideline re-upload the same way deltas do.
 */

export type AnswerStatus =
  /** Kept the guideline exactly as written. */
  | 'accepted'
  /** Supplied this clinic's own answer — deltas were written. */
  | 'changed'
  /** Deferred; the guideline's answer stands, listed again at sign-off. */
  | 'skipped'
  /** Doesn't fit this clinic; noted for a person, no change made. */
  | 'flagged'

export interface SessionAnswer {
  status: AnswerStatus
  /** The surgeon's own words — why they changed or flagged it. */
  note?: string
  /** One plain sentence describing the outcome, for the sign-off screen. */
  summary?: string
  at: string
}

export interface SessionProgress {
  answers: Record<string, SessionAnswer>
  /** Where they were, so reopening resumes instead of restarting. */
  stepIndex: number
  /** False until they've been through the opening screen once. */
  started: boolean
}

const EMPTY: SessionProgress = { answers: {}, stepIndex: 0, started: false }

function keyFor(treeId: string): string {
  return `omari:setupProgress:${treeId}`
}

export function loadSession(treeId: string): SessionProgress {
  try {
    const raw = localStorage.getItem(keyFor(treeId))
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<SessionProgress>
    if (!parsed || typeof parsed !== 'object' || !parsed.answers) return EMPTY
    return {
      answers: parsed.answers,
      stepIndex: typeof parsed.stepIndex === 'number' ? parsed.stepIndex : 0,
      started: parsed.started === true,
    }
  } catch {
    return EMPTY
  }
}

function save(treeId: string, progress: SessionProgress): SessionProgress {
  try {
    localStorage.setItem(keyFor(treeId), JSON.stringify(progress))
  } catch {
    /* A full or disabled localStorage costs progress, never correctness. */
  }
  return progress
}

export function recordAnswer(
  treeId: string,
  questionId: string,
  answer: Omit<SessionAnswer, 'at'>,
): SessionProgress {
  const current = loadSession(treeId)
  return save(treeId, {
    ...current,
    answers: { ...current.answers, [questionId]: { ...answer, at: new Date().toISOString() } },
  })
}

export function clearAnswer(treeId: string, questionId: string): SessionProgress {
  const current = loadSession(treeId)
  if (!current.answers[questionId]) return current
  const answers = { ...current.answers }
  delete answers[questionId]
  return save(treeId, { ...current, answers })
}

export function setStepIndex(treeId: string, stepIndex: number): SessionProgress {
  return save(treeId, { ...loadSession(treeId), stepIndex })
}

export function markStarted(treeId: string): SessionProgress {
  return save(treeId, { ...loadSession(treeId), started: true })
}

/** Wipe progress — used when the guideline is replaced underneath the session. */
export function resetSession(treeId: string): SessionProgress {
  try {
    localStorage.removeItem(keyFor(treeId))
  } catch {
    /* ignore */
  }
  return EMPTY
}
