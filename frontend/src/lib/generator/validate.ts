import { runEngine } from '../engine'
import type { FilledVariables, Tree } from '../../types/tree'
import { routingLabel, type DecidedCase } from './types'

/**
 * Blume generator — Layer 3c: validation, the proof engine.
 *
 * Runs the REAL deterministic engine (the exact code the Runner uses — one
 * engine, two uses, no drift) over the surgeon's recorded case decisions and
 * scores agreement on BOTH axes. Under- and over-ordering have asymmetric
 * clinical cost and are NEVER collapsed into one number.
 */

export interface CaseValidation {
  caseId: string
  /** What the surgeon decided. */
  expected: {
    specialistName?: string
    escalated: boolean
    workup: string[]
    wouldNotOrder: string[]
  }
  /** What the engine did on the draft tree. */
  engine: {
    outcome: 'routed' | 'escalated' | 'incomplete'
    specialistName?: string
    workup: string[]
    withheld: string[]
    escalationReason?: string
    pathTaken: string[]
  }
  routingMatch: boolean
  /** Surgeon wanted a test the engine didn't order — wastes the first visit. */
  underOrdered: string[]
  /** Engine ordered a test the surgeon didn't ask for — wastes money/time. */
  overOrdered: string[]
  /** Worst case: engine ordered something the surgeon EXPLICITLY refused. */
  refusedButOrdered: string[]
}

export interface ValidationSummary {
  totalCases: number
  routingMatches: number
  routingAccuracy: number
  /** Cases with ≥1 missing test. */
  underOrderCases: number
  underOrderRate: number
  /** Cases with ≥1 unneeded test. */
  overOrderCases: number
  overOrderRate: number
  /** Cases where an explicitly-refused test was ordered (must be 0 to sign). */
  refusedOrderCases: number
  /** Cases the engine couldn't finish (missing variable on path). */
  incompleteCases: number
}

export interface ValidationReport {
  summary: ValidationSummary
  results: CaseValidation[]
}

const norm = (s: string) => s.trim().toLowerCase()

function toFilled(facts: Record<string, unknown>): FilledVariables {
  const filled: FilledVariables = {}
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined && value !== null && value !== '') {
      filled[key] = { value, confidence: 1 }
    }
  }
  return filled
}

/** Validate a draft tree against decided cases (training or held-out). */
export function validateTree(tree: Tree, decided: DecidedCase[]): ValidationReport {
  const results: CaseValidation[] = decided.map(({ case: c, decision: d, facts }) => {
    const r = runEngine(tree, toFilled(facts))

    const engineWorkup = (r.resolvedWorkup?.ordered ?? []).map((w) => w.name)
    const engineWithheld = (r.resolvedWorkup?.withheld ?? []).map((w) => w.item)
    const expectedWorkup = d.workup.map((w) => w.name)

    const expectedEscalate = d.escalated
    const routingMatch =
      (expectedEscalate && r.outcome === 'escalated') ||
      (!expectedEscalate &&
        r.outcome === 'routed' &&
        norm(r.specialist?.specialistName ?? '') === norm(routingLabel(d)))

    const engineSet = new Set(engineWorkup.map(norm))
    const expectedSet = new Set(expectedWorkup.map(norm))
    const underOrdered = expectedWorkup.filter((t) => !engineSet.has(norm(t)))
    const overOrdered = engineWorkup.filter((t) => !expectedSet.has(norm(t)))
    const refusedButOrdered = engineWorkup.filter((t) =>
      d.wouldNotOrder.some((x) => norm(x) === norm(t)),
    )

    return {
      caseId: c.id,
      expected: {
        specialistName: d.routedSpecialistName,
        escalated: d.escalated,
        workup: expectedWorkup,
        wouldNotOrder: d.wouldNotOrder,
      },
      engine: {
        outcome: r.outcome,
        specialistName: r.specialist?.specialistName,
        workup: engineWorkup,
        withheld: engineWithheld,
        escalationReason: r.escalationReason,
        pathTaken: r.pathTaken,
      },
      routingMatch,
      // Workup comparison only means something when the engine finished AND
      // reached a specialist — an escalated case has no workup to compare.
      underOrdered: r.outcome === 'routed' && !expectedEscalate ? underOrdered : [],
      overOrdered: r.outcome === 'routed' && !expectedEscalate ? overOrdered : [],
      refusedButOrdered: r.outcome === 'routed' ? refusedButOrdered : [],
    }
  })

  const total = results.length
  const routingMatches = results.filter((r) => r.routingMatch).length
  const underOrderCases = results.filter((r) => r.underOrdered.length > 0).length
  const overOrderCases = results.filter((r) => r.overOrdered.length > 0).length
  const refusedOrderCases = results.filter((r) => r.refusedButOrdered.length > 0).length
  const incompleteCases = results.filter((r) => r.engine.outcome === 'incomplete').length

  return {
    summary: {
      totalCases: total,
      routingMatches,
      routingAccuracy: total > 0 ? routingMatches / total : 0,
      underOrderCases,
      underOrderRate: total > 0 ? underOrderCases / total : 0,
      overOrderCases,
      overOrderRate: total > 0 ? overOrderCases / total : 0,
      refusedOrderCases,
      incompleteCases,
    },
    results,
  }
}
