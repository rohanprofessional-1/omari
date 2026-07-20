import type { Urgency } from '../../types/tree'

/**
 * Blume generator — shared types for the deterministic pipeline.
 *
 * ⚠️ NO AI / LLM ANYWHERE IN src/lib/generator. These modules are pure TS
 * (no DOM, no fetch) so the exact same code can run in the browser today and
 * in a Node worker later for authoritative server-side validation. The LLM's
 * only roles live server-side: generating candidate cases, fallback-classifying
 * highlights, and phrasing gap messages. Induction, assembly, gap detection,
 * and validation — everything that becomes clinical logic — is this code
 * operating on the surgeon's recorded decisions.
 */

/** A synthetic case as the pipeline sees it (mirrors synthetic_cases rows). */
export interface GenCase {
  id: string
  subspecialty: string
  narrative: string
  /** The clinical variables planted in the narrative: key → value. */
  groundTruth: Record<string, unknown>
  source?: string
  qualityReviewed?: boolean
  minimalPairOf?: string | null
  variedVariable?: string | null
}

/** One workup order the surgeon named on a case. */
export interface GenWorkupOrder {
  name: string
  protocol?: string
  rationale?: string
  /**
   * The surgeon's stated condition, verbatim-ish ("only if there's a mass").
   * A LEAD for induction to confirm or reject — surfaced in Review, never
   * binding. Induction remains the sole author of conditional workup rules.
   */
  conditionalHint?: string
}

/** The surgeon's coupled decision on one case (mirrors case_decisions rows). */
export interface GenDecision {
  caseId: string
  /** Roster specialist name, or undefined when escalated. */
  routedSpecialistName?: string
  escalated: boolean
  /**
   * Skip-with-reason: the case was handled but NOT clinically decided.
   * Skipped rows count toward progress yet are excluded from induction and
   * validation — joinDecidedCases is the single filter both read through.
   */
  skipped?: boolean
  skipReason?: string
  urgency?: Urgency
  workup: GenWorkupOrder[]
  workupCounterfactual?: string
  /** Tests the surgeon deliberately would NOT order here (negative space). */
  wouldNotOrder: string[]
  /**
   * The surgeon's own read of the case variables (overrides ground truth
   * where both exist — the surgeon is the author).
   */
  caseVariables: Record<string, unknown>
}

/** A Layer-1 candidate variable (mirrors candidate_variables rows). */
export interface GenCandidateVariable {
  key: string
  label?: string | null
  axis: 'routing' | 'workup' | 'both'
  valueSamples: unknown[]
  frequency: number
}

/** A department roster entry — the routing leaves the surgeon picks from. */
export interface GenRosterEntry {
  name: string
  specialty: string
  focus?: string
}

/** The variable values that describe one case for induction/validation. */
export type CaseFacts = Record<string, unknown>

/**
 * Merge ground truth with the surgeon's read. The surgeon's values win —
 * the system drafts, the surgeon authors.
 */
export function caseFacts(c: GenCase, d?: GenDecision): CaseFacts {
  return { ...c.groundTruth, ...(d?.caseVariables ?? {}) }
}

/** A decision paired with its case, facts pre-merged. */
export interface DecidedCase {
  case: GenCase
  decision: GenDecision
  facts: CaseFacts
}

/**
 * Join cases and decisions into the induction working set.
 *
 * THE decided-and-not-skipped filter: induction, validation, gap detection,
 * and threshold discovery all read through this one function, so "skipped is
 * not a decision" is enforced in exactly one place. A skipped case counts
 * toward session progress but must never shape the tree or drag the accuracy
 * metric with a phantom mismatch.
 */
export function joinDecidedCases(cases: GenCase[], decisions: GenDecision[]): DecidedCase[] {
  const byId = new Map(cases.map((c) => [c.id, c]))
  const out: DecidedCase[] = []
  for (const d of decisions) {
    if (d.skipped) continue
    const c = byId.get(d.caseId)
    if (c) out.push({ case: c, decision: d, facts: caseFacts(c, d) })
  }
  return out
}

/** The routing outcome label used for partitioning. */
export function routingLabel(d: GenDecision): string {
  return d.escalated ? '⚠︎ESCALATE' : (d.routedSpecialistName ?? '⚠︎ESCALATE')
}
