/**
 * Blume generator — pipeline tests: decisions in → induce → assemble →
 * validate → gaps. Self-asserting, no framework (run with `npm test`).
 *
 * The fixture mimics a small peripheral-nerve elicitation session:
 *  - routing splits on symptom_location, then (upper limb) emg_status
 *  - MRI is a CONDITIONAL workup (only when mass_present), with an explicit
 *    "would not order" on the other side → guard
 *  - one deliberately ambiguous pattern the surgeon escalated
 */
import { induceSkeleton, induceWorkup, flattenRules } from './induce'
import { assembleTree } from './assemble'
import { validateTree } from './validate'
import { detectGaps } from './gaps'
import { joinDecidedCases, type GenCase, type GenDecision, type GenRosterEntry } from './types'

declare const process: { exitCode?: number } | undefined

const ROSTER: GenRosterEntry[] = [
  { name: 'Dr. Chen', specialty: 'Peripheral nerve — entrapment' },
  { name: 'Dr. Patel', specialty: 'Brachial plexus & tumors' },
  { name: 'Dr. Okafor', specialty: 'Lower extremity nerve' },
  { name: 'Dr. Reyes', specialty: 'Spine' }, // never routed → undifferentiated gap
]

function mkCase(id: string, groundTruth: Record<string, unknown>): GenCase {
  return { id, subspecialty: 'peripheral nerve', narrative: `case ${id}`, groundTruth }
}

const CASES: GenCase[] = [
  mkCase('c1', { symptom_location: 'arm_hand', emg_status: 'abnormal', mass_present: false }),
  mkCase('c2', { symptom_location: 'arm_hand', emg_status: 'abnormal', mass_present: true }),
  mkCase('c3', { symptom_location: 'arm_hand', emg_status: 'not_done', mass_present: false }),
  mkCase('c4', { symptom_location: 'leg_foot', emg_status: 'not_done', mass_present: false }),
  mkCase('c5', { symptom_location: 'leg_foot', emg_status: 'abnormal', mass_present: false }),
  mkCase('c6', { symptom_location: 'neck_radiating', emg_status: 'not_done', mass_present: false }),
]

const DECISIONS: GenDecision[] = [
  {
    caseId: 'c1',
    routedSpecialistName: 'Dr. Chen',
    escalated: false,
    urgency: 'routine',
    workup: [{ name: 'EMG/NCS', protocol: 'Bilateral upper limbs', rationale: 'Localize' }],
    wouldNotOrder: ['MRI brachial plexus'],
    workupCounterfactual: 'Without EMG the visit is a repeat exam, not a plan.',
    caseVariables: {},
  },
  {
    caseId: 'c2',
    routedSpecialistName: 'Dr. Chen',
    escalated: false,
    urgency: 'expedited',
    workup: [
      { name: 'EMG/NCS', protocol: 'Bilateral upper limbs', rationale: 'Localize' },
      { name: 'MRI brachial plexus', protocol: 'With contrast', rationale: 'Characterize mass' },
    ],
    wouldNotOrder: [],
    workupCounterfactual: 'A mass without imaging means no surgical decision on visit one.',
    caseVariables: {},
  },
  {
    caseId: 'c3',
    routedSpecialistName: 'Dr. Patel',
    escalated: false,
    urgency: 'routine',
    workup: [{ name: 'EMG/NCS', protocol: 'Upper limb', rationale: 'Baseline' }],
    wouldNotOrder: [],
    caseVariables: {},
  },
  {
    caseId: 'c4',
    routedSpecialistName: 'Dr. Okafor',
    escalated: false,
    urgency: 'routine',
    workup: [{ name: 'EMG/NCS', protocol: 'Lower limb', rationale: 'Localize' }],
    wouldNotOrder: [],
    caseVariables: {},
  },
  {
    caseId: 'c5',
    routedSpecialistName: 'Dr. Okafor',
    escalated: false,
    urgency: 'routine',
    workup: [{ name: 'EMG/NCS', protocol: 'Lower limb', rationale: 'Localize' }],
    wouldNotOrder: [],
    caseVariables: {},
  },
  {
    caseId: 'c6',
    escalated: true,
    workup: [],
    wouldNotOrder: [],
    caseVariables: {},
  },
]

const decided = joinDecidedCases(CASES, DECISIONS)

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'skeleton splits and routes every decided case consistently',
    run: () => {
      const skeleton = induceSkeleton(decided)
      if (skeleton.kind !== 'split') return `expected root split, got ${skeleton.kind}`
      return null
    },
  },
  {
    name: 'assembled tree is Zod-valid and routes 100% of training cases (two-axis)',
    run: () => {
      const skeleton = induceSkeleton(decided)
      const draft = assembleTree(skeleton, { subspecialty: 'peripheral nerve', roster: ROSTER })
      const report = validateTree(draft.tree, decided)
      const s = report.summary
      if (s.routingAccuracy !== 1)
        return `routing accuracy ${s.routingAccuracy}: ${JSON.stringify(
          report.results.filter((r) => !r.routingMatch),
          null,
          1,
        )}`
      if (s.underOrderCases !== 0) return `under-ordering on training data (${s.underOrderCases})`
      if (s.overOrderCases !== 0) return `over-ordering on training data (${s.overOrderCases})`
      if (s.refusedOrderCases !== 0) return 'ordered an explicitly-refused test'
      return null
    },
  },
  {
    name: 'MRI induced as CONDITIONAL on mass_present with counterfactual + guard',
    run: () => {
      const skeleton = induceSkeleton(decided)
      const draft = assembleTree(skeleton, { subspecialty: 'peripheral nerve', roster: ROSTER })
      const chen = draft.tree.nodes.find(
        (n) => n.type === 'specialist' && n.specialistName === 'Dr. Chen',
      )
      if (!chen || chen.type !== 'specialist') return 'Dr. Chen leaf missing'
      const cond = chen.workup.conditional.find((c) => c.item.name === 'MRI brachial plexus')
      if (!cond) return `MRI not conditional: ${JSON.stringify(chen.workup)}`
      if (!('key' in cond.when) || cond.when.key !== 'mass_present')
        return `wrong trigger: ${JSON.stringify(cond.when)}`
      if (!cond.reason) return 'conditional lost its counterfactual reason'
      const guard = chen.workup.doNotOrderUnless.find((g) => g.item === 'MRI brachial plexus')
      if (!guard) return 'explicit refusal did not become a doNotOrderUnless guard'
      if (chen.workup.always.some((w) => w.name === 'MRI brachial plexus'))
        return 'MRI leaked into always'
      return null
    },
  },
  {
    name: 'escalated decisions become escalation nodes (ambiguity is never guessed)',
    run: () => {
      const skeleton = induceSkeleton(decided)
      const draft = assembleTree(skeleton, { subspecialty: 'peripheral nerve', roster: ROSTER })
      const report = validateTree(draft.tree, decided)
      const c6 = report.results.find((r) => r.caseId === 'c6')
      if (!c6) return 'c6 missing from validation'
      return c6.engine.outcome === 'escalated' ? null : `c6 outcome ${c6.engine.outcome}`
    },
  },
  {
    name: 'numeric variables induce range splits',
    run: () => {
      const cases = [
        mkCase('n1', { age: 25 }),
        mkCase('n2', { age: 30 }),
        mkCase('n3', { age: 70 }),
        mkCase('n4', { age: 75 }),
      ]
      const decisions: GenDecision[] = [
        { caseId: 'n1', routedSpecialistName: 'Dr. Chen', escalated: false, workup: [], wouldNotOrder: [], caseVariables: {} },
        { caseId: 'n2', routedSpecialistName: 'Dr. Chen', escalated: false, workup: [], wouldNotOrder: [], caseVariables: {} },
        { caseId: 'n3', routedSpecialistName: 'Dr. Patel', escalated: false, workup: [], wouldNotOrder: [], caseVariables: {} },
        { caseId: 'n4', routedSpecialistName: 'Dr. Patel', escalated: false, workup: [], wouldNotOrder: [], caseVariables: {} },
      ]
      const dd = joinDecidedCases(cases, decisions)
      const skeleton = induceSkeleton(dd)
      if (skeleton.kind !== 'split' || skeleton.variableKey !== 'age')
        return `expected age split, got ${JSON.stringify(skeleton.kind)}`
      const draft = assembleTree(skeleton, { subspecialty: 'x', roster: ROSTER })
      const report = validateTree(draft.tree, dd)
      // The induced threshold must also generalize to unseen mid-range ages.
      const probe = validateTree(draft.tree, joinDecidedCases(
        [mkCase('n5', { age: 28 })],
        [{ caseId: 'n5', routedSpecialistName: 'Dr. Chen', escalated: false, workup: [], wouldNotOrder: [], caseVariables: {} }],
      ))
      if (report.summary.routingAccuracy !== 1) return 'training accuracy < 1 on numeric split'
      if (probe.summary.routingAccuracy !== 1) return 'threshold failed to generalize to age 28'
      return null
    },
  },
  {
    name: 'workup ambiguity (no separator) is withheld and flagged, not guessed',
    run: () => {
      const cases = [
        mkCase('a1', { loc: 'arm' }),
        mkCase('a2', { loc: 'arm' }),
      ]
      const decisions: GenDecision[] = [
        { caseId: 'a1', routedSpecialistName: 'Dr. Chen', escalated: false, workup: [{ name: 'Ultrasound' }], wouldNotOrder: [], caseVariables: {} },
        { caseId: 'a2', routedSpecialistName: 'Dr. Chen', escalated: false, workup: [], wouldNotOrder: [], caseVariables: {} },
      ]
      const dd = joinDecidedCases(cases, decisions)
      const wu = induceWorkup(dd)
      if (wu.always.some((w) => w.name === 'Ultrasound')) return 'ambiguous test leaked into always'
      if (wu.conditional.some((c) => c.item.name === 'Ultrasound')) return 'fabricated a condition'
      if (wu.ambiguities.length !== 1) return `expected 1 ambiguity, got ${wu.ambiguities.length}`
      return null
    },
  },
  {
    name: 'gap detection: unrouted roster member + thin evidence + workup hole',
    run: () => {
      const skeleton = induceSkeleton(decided)
      const draft = assembleTree(skeleton, { subspecialty: 'peripheral nerve', roster: ROSTER })
      const report = validateTree(draft.tree, decided)
      const gaps = detectGaps(draft, decided, ROSTER, report)
      if (!gaps.some((g) => g.kind === 'undifferentiated_specialists' && String(g.detail.specialistName) === 'Dr. Reyes'))
        return 'missed the never-routed roster member (Dr. Reyes)'
      if (!gaps.some((g) => g.kind === 'thin_evidence'))
        return 'missed thin evidence (single-case leaves exist in fixture)'
      return null
    },
  },
  {
    name: 'flattenRules emits routing branches + conditional workup + guard',
    run: () => {
      const skeleton = induceSkeleton(decided)
      const rules = flattenRules(skeleton)
      if (!rules.some((r) => r.kind === 'routing_branch')) return 'no routing_branch rules'
      if (!rules.some((r) => r.kind === 'workup_rule' && r.target.mode === 'conditional'))
        return 'no conditional workup rule'
      if (!rules.some((r) => r.kind === 'workup_guard')) return 'no workup guard rule'
      const bad = rules.find((r) => r.confidence < 0 || r.confidence > 1)
      return bad ? `confidence out of range: ${JSON.stringify(bad)}` : null
    },
  },
]

let failures = 0
for (const c of checks) {
  let msg: string | null
  try {
    msg = c.run()
  } catch (err) {
    msg = err instanceof Error ? `${err.message}` : String(err)
  }
  if (msg) {
    failures += 1
    console.error(`✗ ${c.name}\n    ${msg}`)
  } else {
    console.log(`✓ ${c.name}`)
  }
}

if (failures > 0) {
  if (typeof process !== 'undefined') process.exitCode = 1
  throw new Error(`${failures} generator test(s) failed`)
}
console.log(`generator.test.ts — all ${checks.length} passed`)
