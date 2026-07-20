import { joinDecidedCases, routingLabel, type GenCase, type GenDecision } from './types'

/**
 * Blume generator — minimal-pair threshold discovery.
 *
 * DERIVED, NEVER STORED: everything needed to compute a flip (the variant
 * linkage on synthetic_cases and both decisions) is already persisted, so
 * thresholds are recomputed from source data on demand. A threshold table
 * would be a second source of truth that could silently drift from the
 * induction it feeds.
 *
 * ONE COMPARISON, TWO CONSUMERS: `decisionsDiffer` defines what "a flip"
 * means using the exact semantics induction and validation already use —
 * `routingLabel` for the routing axis (same function the partitioner labels
 * with) and normalized workup name-sets (same comparison validation scores
 * with). The on-save callout and the Review panel both call this, so a
 * "threshold discovered" claim can never disagree with what induction sees.
 */

const norm = (s: string) => s.trim().toLowerCase()

function workupNames(d: GenDecision): Set<string> {
  return new Set(d.workup.map((w) => norm(w.name)))
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

/** The flip test — identical semantics to induction (routing) + validation (workup). */
export function decisionsDiffer(
  a: GenDecision,
  b: GenDecision,
): { routingFlip: boolean; workupFlip: boolean } {
  return {
    routingFlip: routingLabel(a) !== routingLabel(b),
    workupFlip: !setsEqual(workupNames(a), workupNames(b)),
  }
}

/** One discovered decision boundary from a decided minimal pair. */
export interface DiscoveredThreshold {
  parentCaseId: string
  variantCaseId: string
  /** The single variable the variant flipped (from case authoring). */
  variedVariable: string
  parentValue?: unknown
  variantValue?: unknown
  routingFlip: boolean
  workupFlip: boolean
  /** Human-readable: what the decision was on each side of the boundary. */
  parentOutcome: string
  variantOutcome: string
}

function describeOutcome(d: GenDecision): string {
  const dest = d.escalated ? 'escalate' : (d.routedSpecialistName ?? 'escalate')
  const wu = d.workup.map((w) => w.name).join(', ')
  return wu ? `${dest} + ${wu}` : dest
}

/**
 * Recompute every discovered threshold in the session: for each decided
 * minimal-pair variant whose parent is also decided, report whether routing
 * and/or workup flipped across the single varied variable. Pairs where
 * nothing flipped are NOT thresholds (and that's signal too — the variable
 * doesn't discriminate there — but it isn't reported as a boundary).
 * Skipped cases never participate (joinDecidedCases filter).
 */
export function discoverThresholds(
  cases: GenCase[],
  decisions: GenDecision[],
): DiscoveredThreshold[] {
  const decided = joinDecidedCases(cases, decisions)
  const decisionByCase = new Map(decided.map((d) => [d.case.id, d.decision]))
  const caseById = new Map(cases.map((c) => [c.id, c]))

  const out: DiscoveredThreshold[] = []
  for (const { case: variant, decision: variantDecision } of decided) {
    if (!variant.minimalPairOf) continue
    const parent = caseById.get(variant.minimalPairOf)
    const parentDecision = decisionByCase.get(variant.minimalPairOf)
    if (!parent || !parentDecision) continue

    const { routingFlip, workupFlip } = decisionsDiffer(parentDecision, variantDecision)
    if (!routingFlip && !workupFlip) continue

    const varied = variant.variedVariable ?? 'unknown'
    out.push({
      parentCaseId: parent.id,
      variantCaseId: variant.id,
      variedVariable: varied,
      parentValue: parent.groundTruth[varied],
      variantValue: variant.groundTruth[varied],
      routingFlip,
      workupFlip,
      parentOutcome: describeOutcome(parentDecision),
      variantOutcome: describeOutcome(variantDecision),
    })
  }
  return out
}
