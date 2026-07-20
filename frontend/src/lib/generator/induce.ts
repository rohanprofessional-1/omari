import type { Urgency, WorkupConditional, WorkupGuard, WorkupItem } from '../../types/tree'
import {
  routingLabel,
  type DecidedCase,
  type GenCandidateVariable,
} from './types'

/**
 * Blume generator — Layer 2 logic induction (the load-bearing layer).
 *
 * Pure, deterministic partitioning of the surgeon's recorded case decisions:
 * greedy information-gain splits build the routing skeleton, and per-leaf
 * analysis of what was ordered / deliberately NOT ordered induces the
 * path-conditioned workup. Ambiguity NEVER gets guessed away — mixed leaves
 * become escalation nodes and undecidable workup becomes an explicit
 * ambiguity (surfaced by gap detection), because conservative-by-default is
 * a design principle, not an optimization target.
 */

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

export interface SkeletonBranch {
  /** equals bucket (categorical) — the raw value cases in this bucket share. */
  value?: unknown
  /** range bucket (numeric splits): [min, max] with either side open. */
  range?: { min?: number; max?: number }
  cases: DecidedCase[]
  child: SkeletonNode
}

export type SkeletonNode =
  | { kind: 'split'; variableKey: string; branches: SkeletonBranch[]; support: DecidedCase[] }
  | { kind: 'leaf'; specialistName: string; urgency: Urgency; support: DecidedCase[] }
  | { kind: 'escalate'; reason: string; support: DecidedCase[] }

export interface InduceOptions {
  /** Ranked Layer-1 candidates — used to prefer clinically-salient splits. */
  candidateVariables?: GenCandidateVariable[]
  maxDepth?: number
}

/* -------------------------------------------------------------------------- */
/* Routing induction                                                          */
/* -------------------------------------------------------------------------- */

function entropy(cases: DecidedCase[]): number {
  const counts = new Map<string, number>()
  for (const c of cases) {
    const label = routingLabel(c.decision)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  let h = 0
  for (const n of counts.values()) {
    const p = n / cases.length
    h -= p * Math.log2(p)
  }
  return h
}

function allSameLabel(cases: DecidedCase[]): boolean {
  return new Set(cases.map((c) => routingLabel(c.decision))).size <= 1
}

/** Variables present (non-undefined/null) in EVERY case of the subset. */
function splittableVariables(cases: DecidedCase[]): string[] {
  if (cases.length === 0) return []
  const keys = Object.keys(cases[0].facts)
  return keys.filter((k) =>
    cases.every((c) => c.facts[k] !== undefined && c.facts[k] !== null && c.facts[k] !== ''),
  )
}

function isAllNumeric(cases: DecidedCase[], key: string): boolean {
  return cases.every((c) => typeof c.facts[key] === 'number' && !Number.isNaN(c.facts[key]))
}

interface SplitCandidate {
  variableKey: string
  gain: number
  /** categorical: value buckets; numeric: two range buckets. */
  buckets: { value?: unknown; range?: { min?: number; max?: number }; cases: DecidedCase[] }[]
}

function categoricalSplit(cases: DecidedCase[], key: string): SplitCandidate {
  const buckets = new Map<string, { value: unknown; cases: DecidedCase[] }>()
  for (const c of cases) {
    const raw = c.facts[key]
    const bucketKey = String(raw)
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { value: raw, cases: [] })
    buckets.get(bucketKey)!.cases.push(c)
  }
  const list = [...buckets.values()]
  const h = entropy(cases)
  const weighted = list.reduce((acc, b) => acc + (b.cases.length / cases.length) * entropy(b.cases), 0)
  return { variableKey: key, gain: h - weighted, buckets: list }
}

function numericSplit(cases: DecidedCase[], key: string): SplitCandidate | null {
  const sorted = [...cases].sort((a, b) => (a.facts[key] as number) - (b.facts[key] as number))
  const values = sorted.map((c) => c.facts[key] as number)
  const h = entropy(cases)
  let best: SplitCandidate | null = null
  for (let i = 0; i < sorted.length - 1; i++) {
    if (values[i] === values[i + 1]) continue
    if (routingLabel(sorted[i].decision) === routingLabel(sorted[i + 1].decision)) continue
    const threshold = (values[i] + values[i + 1]) / 2
    const lo = sorted.filter((c) => (c.facts[key] as number) <= threshold)
    const hi = sorted.filter((c) => (c.facts[key] as number) > threshold)
    const weighted = (lo.length / cases.length) * entropy(lo) + (hi.length / cases.length) * entropy(hi)
    const gain = h - weighted
    if (!best || gain > best.gain) {
      best = {
        variableKey: key,
        gain,
        buckets: [
          { range: { max: threshold }, cases: lo },
          { range: { min: threshold + (Number.isInteger(threshold) ? 1 : 0.01) }, cases: hi },
        ],
      }
    }
  }
  return best
}

/** Rank hint: routing/both candidates first, higher frequency first. */
function candidateRank(key: string, candidates?: GenCandidateVariable[]): number {
  const c = candidates?.find((v) => v.key === key)
  if (!c) return 0
  const axisBoost = c.axis === 'workup' ? 0 : 1000
  return axisBoost + c.frequency
}

/**
 * Build the routing skeleton by greedy information-gain partitioning.
 * Ambiguity (mixed labels, nothing left to split on) → escalation, never a guess.
 */
export function induceSkeleton(decided: DecidedCase[], opts: InduceOptions = {}): SkeletonNode {
  const maxDepth = opts.maxDepth ?? 8

  function build(cases: DecidedCase[], depth: number, usedKeys: Set<string>): SkeletonNode {
    if (cases.length === 0) {
      return { kind: 'escalate', reason: 'No elicited cases cover this path.', support: [] }
    }
    if (allSameLabel(cases)) {
      const label = routingLabel(cases[0].decision)
      if (label === '⚠︎ESCALATE') {
        return {
          kind: 'escalate',
          reason: 'The surgeon escalated cases matching this pattern for human review.',
          support: cases,
        }
      }
      return {
        kind: 'leaf',
        specialistName: label,
        urgency: majorityUrgency(cases),
        support: cases,
      }
    }
    if (depth >= maxDepth) {
      return {
        kind: 'escalate',
        reason: 'Cases matching this pattern could not be separated — needs surgeon review.',
        support: cases,
      }
    }

    const keys = splittableVariables(cases).filter((k) => !usedKeys.has(k))
    let best: SplitCandidate | null = null
    for (const key of keys) {
      const cand = isAllNumeric(cases, key) ? numericSplit(cases, key) : categoricalSplit(cases, key)
      if (!cand || cand.buckets.length < 2) continue
      const better =
        !best ||
        cand.gain > best.gain + 1e-9 ||
        (Math.abs(cand.gain - best.gain) <= 1e-9 &&
          candidateRank(cand.variableKey, opts.candidateVariables) >
            candidateRank(best.variableKey, opts.candidateVariables))
      if (better && cand.gain > 1e-9) best = cand
    }

    if (!best) {
      return {
        kind: 'escalate',
        reason:
          'The decided cases disagree on routing but no elicited variable separates them — genuine ambiguity, needs the surgeon.',
        support: cases,
      }
    }

    const nextUsed = new Set(usedKeys).add(best.variableKey)
    return {
      kind: 'split',
      variableKey: best.variableKey,
      support: cases,
      branches: best.buckets.map((b) => ({
        value: b.value,
        range: b.range,
        cases: b.cases,
        child: build(b.cases, depth + 1, nextUsed),
      })),
    }
  }

  return build(decided, 0, new Set())
}

function majorityUrgency(cases: DecidedCase[]): Urgency {
  const counts = new Map<Urgency, number>()
  for (const c of cases) {
    const u = (c.decision.urgency ?? 'routine') as Urgency
    counts.set(u, (counts.get(u) ?? 0) + 1)
  }
  let best: Urgency = 'routine'
  let bestN = 0
  for (const [u, n] of counts) {
    if (n > bestN) {
      best = u
      bestN = n
    }
  }
  return best
}

/* -------------------------------------------------------------------------- */
/* Workup induction (per leaf)                                                */
/* -------------------------------------------------------------------------- */

export interface InducedWorkup {
  always: WorkupItem[]
  conditional: WorkupConditional[]
  doNotOrderUnless: WorkupGuard[]
  /** Tests the surgeon sometimes ordered here with NO separating variable —
   * left OUT of the spec (conservative) and surfaced as an over-ordering gap. */
  ambiguities: {
    test: string
    orderedCaseIds: string[]
    notOrderedCaseIds: string[]
  }[]
}

const norm = (s: string) => s.trim().toLowerCase()

function orderFor(c: DecidedCase, test: string) {
  return c.decision.workup.find((w) => norm(w.name) === norm(test))
}

/** Find one variable whose values cleanly separate two case sets. */
function findDiscriminator(
  a: DecidedCase[],
  b: DecidedCase[],
): { key: string; aValues: unknown[]; numeric: boolean } | null {
  const all = [...a, ...b]
  for (const key of splittableVariables(all)) {
    const aVals = new Set(a.map((c) => String(c.facts[key])))
    const bVals = new Set(b.map((c) => String(c.facts[key])))
    const overlap = [...aVals].some((v) => bVals.has(v))
    if (!overlap) {
      const numeric = isAllNumeric(all, key)
      const rawA = [...new Set(a.map((c) => c.facts[key]))]
      return { key, aValues: rawA, numeric }
    }
  }
  return null
}

function conditionForValues(
  key: string,
  values: unknown[],
  numeric: boolean,
  counterpartValues: number[],
): WorkupConditional['when'] {
  if (numeric) {
    const nums = values as number[]
    const lo = Math.min(...nums)
    const hi = Math.max(...nums)
    const counterMax = Math.max(...counterpartValues)
    const counterMin = Math.min(...counterpartValues)
    // Open the unconstrained side so nearby unseen values behave sensibly.
    if (counterMax < lo) return { key, op: 'range', min: (counterMax + lo) / 2 }
    if (counterMin > hi) return { key, op: 'range', max: (hi + counterMin) / 2 }
    return { key, op: 'range', min: lo, max: hi }
  }
  if (values.length === 1) {
    const v = values[0]
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      return { key, op: 'equals', value: v }
    }
    return { key, op: 'equals', value: String(v) }
  }
  return { key, op: 'in', values: values.map((v) => String(v)) }
}

/**
 * Induce the path-conditioned WorkupSpec for one leaf from the decisions that
 * landed there. Rules, in surgeon-authored terms:
 *   - ordered on EVERY case      → always
 *   - ordered on SOME, separable → conditional (with the counterfactual reason)
 *     …and if any case explicitly refused it → also a doNotOrderUnless guard
 *   - ordered on SOME, NOT separable → ambiguity: omit + flag (never guess)
 */
export function induceWorkup(leafCases: DecidedCase[]): InducedWorkup {
  const out: InducedWorkup = { always: [], conditional: [], doNotOrderUnless: [], ambiguities: [] }
  if (leafCases.length === 0) return out

  const testNames = new Map<string, string>() // norm → display name
  for (const c of leafCases) {
    for (const w of c.decision.workup) testNames.set(norm(w.name), w.name)
  }

  for (const [key, display] of testNames) {
    const ordered = leafCases.filter((c) => orderFor(c, display))
    const notOrdered = leafCases.filter((c) => !orderFor(c, display))
    const refused = leafCases.filter((c) => c.decision.wouldNotOrder.some((t) => norm(t) === key))
    const sample = orderFor(ordered[0], display)!
    const item: WorkupItem = {
      name: display,
      protocol: sample.protocol ?? '',
      rationale: sample.rationale ?? '',
    }
    const reason = ordered.find((c) => c.decision.workupCounterfactual)?.decision.workupCounterfactual ?? ''

    if (notOrdered.length === 0) {
      out.always.push(item)
      continue
    }

    const disc = findDiscriminator(ordered, notOrdered)
    if (disc) {
      const counterpart = disc.numeric
        ? notOrdered.map((c) => c.facts[disc.key] as number)
        : []
      const when = conditionForValues(disc.key, disc.aValues, disc.numeric, counterpart)
      out.conditional.push({ when, item, reason })
      if (refused.length > 0) {
        // The surgeon explicitly said "no" on the other side of this line —
        // encode it as an over-ordering guard too (defense in depth).
        out.doNotOrderUnless.push({ item: display, requiredCondition: when })
      }
    } else {
      out.ambiguities.push({
        test: display,
        orderedCaseIds: ordered.map((c) => c.case.id),
        notOrderedCaseIds: notOrdered.map((c) => c.case.id),
      })
    }
  }

  return out
}

/* -------------------------------------------------------------------------- */
/* Flat rule summaries (for persistence / display)                            */
/* -------------------------------------------------------------------------- */

export interface InducedRuleSummary {
  kind: 'routing_branch' | 'workup_rule' | 'workup_guard'
  condition: Record<string, unknown> | null
  target: Record<string, unknown>
  supportCaseIds: string[]
  confidence: number
}

/** Walk the skeleton and emit flat, persistable rule summaries. */
export function flattenRules(skeleton: SkeletonNode): InducedRuleSummary[] {
  const rules: InducedRuleSummary[] = []

  function describeChild(node: SkeletonNode): Record<string, unknown> {
    if (node.kind === 'leaf') return { to: 'specialist', specialistName: node.specialistName }
    if (node.kind === 'escalate') return { to: 'escalation', reason: node.reason }
    return { to: 'question', variableKey: node.variableKey }
  }

  function walk(node: SkeletonNode) {
    if (node.kind !== 'split') return
    for (const b of node.branches) {
      rules.push({
        kind: 'routing_branch',
        condition: b.range
          ? { key: node.variableKey, op: 'range', ...b.range }
          : { key: node.variableKey, op: 'equals', value: b.value },
        target: describeChild(b.child),
        supportCaseIds: b.cases.map((c) => c.case.id),
        confidence: node.support.length > 0 ? b.cases.length / node.support.length : 0,
      })
      walk(b.child)
    }

    // Workup rules for leaves directly under this split.
    for (const b of node.branches) {
      if (b.child.kind !== 'leaf') continue
      const wu = induceWorkup(b.child.support)
      for (const item of wu.always) {
        rules.push({
          kind: 'workup_rule',
          condition: null,
          target: { specialistName: b.child.specialistName, order: item.name, mode: 'always' },
          supportCaseIds: b.child.support.map((c) => c.case.id),
          confidence: 1,
        })
      }
      for (const c of wu.conditional) {
        rules.push({
          kind: 'workup_rule',
          condition: c.when as unknown as Record<string, unknown>,
          target: { specialistName: b.child.specialistName, order: c.item.name, mode: 'conditional', reason: c.reason },
          supportCaseIds: b.child.support.map((x) => x.case.id),
          confidence: b.child.support.length > 0 ? 1 : 0,
        })
      }
      for (const g of wu.doNotOrderUnless) {
        rules.push({
          kind: 'workup_guard',
          condition: g.requiredCondition as unknown as Record<string, unknown>,
          target: { specialistName: b.child.specialistName, withhold: g.item },
          supportCaseIds: b.child.support.map((x) => x.case.id),
          confidence: 1,
        })
      }
    }
  }

  // Root-level leaf/escalate (no splits at all) still deserves workup rules.
  if (skeleton.kind === 'leaf') {
    const wu = induceWorkup(skeleton.support)
    for (const item of wu.always) {
      rules.push({
        kind: 'workup_rule',
        condition: null,
        target: { specialistName: skeleton.specialistName, order: item.name, mode: 'always' },
        supportCaseIds: skeleton.support.map((c) => c.case.id),
        confidence: 1,
      })
    }
  }
  walk(skeleton)
  return rules
}
