/**
 * Blume — "Check it against real patients" tests.
 *
 * The invariants this screen exists to hold:
 *   1. The CONCLUSION AND ITS REASONING are derived before any button is
 *      offered — destination, how soon, what to order first, and a plain
 *      sentence saying why. The old workbench revealed the derivation only
 *      after the surgeon clicked "wrong"; that must not come back.
 *   2. The reason is built from the BRANCH LABELS along the path — short,
 *      clinician-voiced — never from stored keys.
 *   3. A referral the guideline can't finish is described in patient terms
 *      ("this referral doesn't say whether…"), never as a missing field.
 *   4. No referrals loaded still yields exactly ONE honest question.
 *   5. Nothing a surgeon reads uses the software's vocabulary.
 *
 * Same self-asserting style as lib/deltas/deltas.test.ts: no framework.
 */
import { TreeSchema, type Tree, type TreeInput } from '../../../types/tree'
import type { GenCase } from '../../generator/types'
import type { FlowInput } from '../types'
import {
  acceptSummary,
  changeSummary,
  deriveCaseQuestions,
  flagSummary,
  tallyLine,
  type CaseQuestion,
} from './cases'

declare const process: { exitCode?: number } | undefined

/* -------------------------------------------------------------------------- */
/* Fixture: a small CPG-shaped tree, with one deliberately verbose terminal    */
/* -------------------------------------------------------------------------- */

const REYES_BASIS = 'Recommendation 4: refer for nerve decompression once conservative care has failed.'
const VERBOSE_NAME =
  'Referral for evaluation of suspected internal derangement (mechanical symptoms present despite possible absence of significant radiographic change)'

const emptyWorkup = { always: [], conditional: [], doNotOrderUnless: [] }

const treeInput: TreeInput = {
  treeId: 'fixture',
  rootNodeId: 'root',
  nodes: [
    {
      id: 'root',
      type: 'variable',
      variableKey: 'red_flag_features_present',
      prompt: 'Are there any red-flag features?',
      dataSource: 'referral',
      branches: [
        { label: 'Red-flag features are present', condition: { op: 'equals', value: true }, nextNodeId: 'escalate' },
        { label: 'No red flags', condition: { op: 'equals', value: false }, nextNodeId: 'duration' },
      ],
    },
    {
      id: 'duration',
      type: 'variable',
      variableKey: 'symptom_duration_months',
      prompt: 'How long have symptoms been going on?',
      dataSource: 'patient',
      branches: [
        { label: 'Symptoms under 6 months', condition: { op: 'range', max: 6 }, nextNodeId: 'conservative' },
        { label: 'Symptoms over 6 months', condition: { op: 'range', min: 6 }, nextNodeId: 'imaging' },
      ],
    },
    {
      id: 'imaging',
      type: 'variable',
      variableKey: 'imaging_result',
      prompt: 'What did the imaging show?',
      dataSource: 'record',
      branches: [
        { label: 'Imaging normal', condition: { op: 'equals', value: 'normal' }, nextNodeId: 'failed' },
        { label: 'Imaging abnormal → straight to surgery', condition: { op: 'equals', value: 'abnormal' }, nextNodeId: 'derangement' },
      ],
    },
    {
      id: 'failed',
      type: 'variable',
      variableKey: 'conservative_treatment_failed',
      prompt: 'Has conservative treatment failed?',
      dataSource: 'referral',
      branches: [
        { label: 'Conservative treatment has failed', condition: { op: 'equals', value: true }, nextNodeId: 'reyes' },
        { label: 'Still on conservative treatment', condition: { op: 'equals', value: false }, nextNodeId: 'conservative' },
      ],
    },
    {
      id: 'reyes',
      type: 'specialist',
      specialistName: 'Dr. Reyes',
      specialty: 'Nerve surgery',
      urgency: 'routine',
      reasoningTemplate: '',
      clinicalBasis: REYES_BASIS,
      workup: {
        always: [
          { name: 'nerve conduction study', protocol: '', rationale: '' },
          { name: 'weight-bearing X-ray', protocol: '', rationale: '' },
        ],
        conditional: [],
        doNotOrderUnless: [],
      },
    },
    {
      id: 'conservative',
      type: 'specialist',
      specialistName: 'Conservative management',
      specialty: 'Physiotherapy',
      urgency: 'routine',
      reasoningTemplate: '',
      workup: emptyWorkup,
    },
    {
      id: 'derangement',
      type: 'specialist',
      specialistName: VERBOSE_NAME,
      specialty: 'Orthopaedics',
      urgency: 'expedited',
      reasoningTemplate: '',
      workup: emptyWorkup,
    },
    { id: 'escalate', type: 'escalation', reason: 'Red-flag features need a person to look at the referral.' },
  ],
}

const tree: Tree = TreeSchema.parse(treeInput)

const ROUTED: GenCase = {
  id: 'case-routed',
  subspecialty: 'ortho',
  narrative: '54-year-old with 9 months of hand numbness, normal imaging, no response to splinting.',
  groundTruth: {
    red_flag_features_present: false,
    symptom_duration_months: 9,
    imaging_result: 'normal',
    conservative_treatment_failed: true,
  },
}

const ESCALATED: GenCase = {
  id: 'case-escalated',
  subspecialty: 'ortho',
  narrative: '61-year-old with new weakness, unexplained weight loss and night pain.',
  groundTruth: { red_flag_features_present: true },
}

const STALLED: GenCase = {
  id: 'case-stalled',
  subspecialty: 'ortho',
  narrative: '47-year-old with 9 months of symptoms; the referral letter attaches no imaging report.',
  groundTruth: { red_flag_features_present: false, symptom_duration_months: 9 },
}

/** A fourth, to prove the "hasn't got any" phrasing of a silent referral. */
const STALLED_AT_START: GenCase = {
  id: 'case-stalled-start',
  subspecialty: 'ortho',
  narrative: 'A one-line referral: "9 months of symptoms, please see."',
  groundTruth: { symptom_duration_months: 9 },
}

function input(cases: GenCase[]): FlowInput {
  return { tree, roster: [], subspecialty: 'ortho', cases }
}

const questions = deriveCaseQuestions(input([ROUTED, ESCALATED, STALLED, STALLED_AT_START]))
const byId = new Map(questions.map((q) => [q.id, q]))
const routed = byId.get('cases:case-routed')!
const escalated = byId.get('cases:case-escalated')!
const stalled = byId.get('cases:case-stalled')!
const stalledAtStart = byId.get('cases:case-stalled-start')!

/* -------------------------------------------------------------------------- */
/* The words a surgeon must never be shown                                    */
/* -------------------------------------------------------------------------- */

const FORBIDDEN = [
  'node',
  'endpoint',
  'tree',
  'delta',
  'reconcile',
  'gap sweep',
  'threshold',
  'variable',
  'condition',
  'mapping',
  'band',
  'publish',
  'scope',
  'branch',
  'anchor',
  'incomplete',
]

/** Every string a surgeon can read on one of these screens. */
function surfaceStrings(q: CaseQuestion): string[] {
  return [
    q.question,
    q.guidelineLine,
    q.stakesLine,
    q.lead,
    q.destination,
    q.urgency,
    q.testsLine,
    q.unsaidSentence,
    q.reason,
    q.reasonLead,
    q.acceptLabel,
    q.rejectLead,
    q.rejectSuffix,
    ...q.decisions.map((d) => d.group),
    ...q.choices.map((c) => c.label),
    acceptSummary(q),
    ...(q.decisions.length > 0 && q.choices.length > 0 ? [changeSummary(q.decisions[0], q.choices[0])] : []),
  ]
}

function forbiddenIn(text: string): string | null {
  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return word
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

const checks: Array<{ name: string; run: () => string | null }> = [
  {
    name: 'every referral exposes a destination, how soon, what to order, and a reason — before any button',
    run: () => {
      for (const q of questions) {
        if (!q.destination.trim()) return `${q.id}: no destination`
        if (!q.urgency.trim()) return `${q.id}: nothing about how soon`
        if (!q.testsLine.trim()) return `${q.id}: nothing about what to order first`
        if (!q.reason.trim()) return `${q.id}: no reason`
        if (!q.reasonLead.trim()) return `${q.id}: reason has nothing introducing it`
        if (!q.acceptLabel.trim()) return `${q.id}: no one-click safe answer`
        if (!q.narrative.trim()) return `${q.id}: the referral itself is missing`
        // The conclusion must be derived at question time, not on demand.
        if (q.shape === 'unsaid' && !q.unsaidSentence.trim()) return `${q.id}: silent referral has no sentence`
      }
      return null
    },
  },
  {
    name: 'a routed referral reads as destination, urgency and the tests to order',
    run: () => {
      if (routed.shape !== 'sent') return `expected a routed referral, got ${routed.shape}`
      if (routed.destination !== 'Dr. Reyes') return `destination was “${routed.destination}”`
      if (routed.urgency !== 'routine') return `urgency was “${routed.urgency}”`
      if (routed.testsLine !== 'Order first: nerve conduction study, weight-bearing X-ray')
        return `tests line was “${routed.testsLine}”`
      if (routed.cpgBasis !== REYES_BASIS) return 'the guideline text behind the destination was not carried'
      return null
    },
  },
  {
    name: 'the reason is the labels along the path, joined as one lowercase sentence',
    run: () => {
      const want = 'no red flags, symptoms over 6 months, imaging normal and conservative treatment has failed'
      if (routed.reason !== want) return `reason was “${routed.reason}”`
      if (routed.reasonLead !== 'Why:') return `reason lead was “${routed.reasonLead}”`
      if (/_/.test(routed.reason)) return 'the reason contains a stored key'
      for (const key of Object.keys(ROUTED.groundTruth)) {
        if (routed.reason.includes(key)) return `the reason leaks the key “${key}”`
      }
      // Routing hints in a label ("Imaging abnormal → straight to surgery")
      // are for the software, not for a sentence.
      if (routed.reason.includes('→')) return 'a routing arrow reached the sentence'
      return null
    },
  },
  {
    name: 'an escalated referral says a person would see it, and why',
    run: () => {
      if (escalated.shape !== 'person') return `expected a person, got ${escalated.shape}`
      if (escalated.reason !== 'red-flag features are present') return `reason was “${escalated.reason}”`
      if (escalated.acceptLabel !== "✓ That's right") return `accept read “${escalated.acceptLabel}”`
      if (escalated.rejectSuffix !== 'anyway') return 'the alternative does not read "…anyway"'
      if (escalated.choices.some((c) => c.target.kind === 'escalation'))
        return 'offered to send a person-reviewed referral to a person'
      return null
    },
  },
  {
    name: 'a referral the guideline cannot finish is described in patient terms',
    run: () => {
      if (stalled.shape !== 'unsaid') return `expected a silent referral, got ${stalled.shape}`
      const want = "This referral doesn't say anything about imaging result, so it would go to a person to review."
      if (stalled.unsaidSentence !== want) return `sentence was “${stalled.unsaidSentence}”`
      const wantStart =
        "This referral doesn't say whether there are any red flag features, so it would go to a person to review."
      if (stalledAtStart.unsaidSentence !== wantStart) return `sentence was “${stalledAtStart.unsaidSentence}”`
      for (const q of [stalled, stalledAtStart]) {
        if (/_/.test(q.unsaidSentence)) return `${q.id}: the sentence contains a stored key`
        if (/missing|value|field|key/i.test(q.unsaidSentence)) return `${q.id}: phrased as data, not as a patient`
      }
      if (stalled.reasonLead !== 'Up to that point:') return `reason lead was “${stalled.reasonLead}”`
      if (stalled.reason !== 'no red flags and symptoms over 6 months') return `reason was “${stalled.reason}”`
      if (stalled.acceptLabel !== "✓ That's right — send it to a person") return `accept read “${stalled.acceptLabel}”`
      return null
    },
  },
  {
    name: 'a correction localizes to the last decision on the referral’s own path',
    run: () => {
      const last = routed.decisions[routed.decisions.length - 1]
      if (routed.decisions.length !== 4) return `expected 4 decisions on the path, got ${routed.decisions.length}`
      if (last.asked !== 'Has conservative treatment failed?') return `last decision was “${last.asked}”`
      if (last.answer !== 'yes') return `the answer read “${last.answer}”`
      if (last.group !== 'conservative treatment has failed') return `the group read “${last.group}”`
      if (last.branch.label !== 'Conservative treatment has failed') return 'the correction lost its label'
      if (last.branch.node.kind !== 'variable') return 'the correction is not localized to the decision that ran'
      const summary = changeSummary(last, routed.choices[0])
      if (!summary.includes('conservative treatment has failed')) return `summary read “${summary}”`
      return null
    },
  },
  {
    name: 'somewhere else to send them: verbose guideline names are shortened, full wording kept',
    run: () => {
      const verbose = routed.choices.find((c) => c.fullLabel === VERBOSE_NAME)
      if (!verbose) return 'the verbose guideline destination lost its full wording'
      if (verbose.label.split(/\s+/).length > 11) return `the short form is still long: “${verbose.label}”`
      if (verbose.label === VERBOSE_NAME) return 'the verbose name was offered raw'
      if (routed.choices.some((c) => c.id === 'reyes')) return 'offered to re-send a referral where it already goes'
      if (!routed.choices.some((c) => c.target.kind === 'escalation')) return 'no way to hand a referral to a person'
      return null
    },
  },
  {
    name: 'the same tree and cases derive the same questions every time (ids are stable)',
    run: () => {
      const again = deriveCaseQuestions(input([ROUTED, ESCALATED, STALLED, STALLED_AT_START]))
      if (JSON.stringify(again) !== JSON.stringify(questions)) return 'derivation is not deterministic'
      if (again[0].id !== `cases:${ROUTED.id}`) return `id was “${again[0].id}”`
      if (again[0].position !== 1 || again[0].total !== 4) return 'position in the run is wrong'
      return null
    },
  },
  {
    name: 'no example referrals still yields exactly one honest question',
    run: () => {
      const none = deriveCaseQuestions(input([]))
      if (none.length !== 1) return `expected 1 question, got ${none.length}`
      const q = none[0]
      if (!q.unavailable) return 'the empty screen is not marked as having nothing to check'
      if (!q.question.trim().endsWith('?')) return 'the empty screen reports a state instead of asking'
      if (q.guidelineLine !== "We couldn't load example referrals for this specialty.")
        return `it does not say why: “${q.guidelineLine}”`
      if (!q.stakesLine.trim()) return 'the empty screen names no stakes'
      if (q.acceptLabel !== '✓ Skip this check') return `the one-click answer read “${q.acceptLabel}”`
      if (/generate/i.test(q.acceptLabel + q.question + q.guidelineLine)) return 'offers to generate instead of moving on'
      if (!acceptSummary(q).trim()) return 'skipping records nothing'
      return null
    },
  },
  {
    name: 'the running tally says something true even before anything is answered',
    run: () => {
      if (tallyLine(0, 0, 10) !== '10 referrals to check.') return `first tally read “${tallyLine(0, 0, 10)}”`
      if (tallyLine(8, 10, 12) !== "You've agreed with 8 of 10 so far.") return `tally read “${tallyLine(8, 10, 12)}”`
      if (!tallyLine(1, 1, 1).trim()) return 'the tally can be blank'
      return null
    },
  },
  {
    name: 'nothing a surgeon reads uses the software’s vocabulary',
    run: () => {
      const all = [...questions, ...deriveCaseQuestions(input([]))]
      for (const q of all) {
        for (const text of surfaceStrings(q)) {
          const hit = forbiddenIn(text)
          if (hit) return `${q.id}: “${text}” contains “${hit}”`
        }
      }
      for (const text of [flagSummary(), tallyLine(0, 0, 3), tallyLine(2, 3, 3)]) {
        const hit = forbiddenIn(text)
        if (hit) return `“${text}” contains “${hit}”`
      }
      return null
    },
  },
]

let failures = 0
for (const c of checks) {
  let msg: string | null
  try {
    msg = c.run()
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err)
  }
  if (msg) {
    failures += 1
    console.error(`✗ ${c.name}: ${msg}`)
  } else {
    console.log(`✓ ${c.name}`)
  }
}

if (failures > 0) {
  if (typeof process !== 'undefined') process.exitCode = 1
  throw new Error(`${failures} case-validation test(s) failed`)
}
console.log(`reconcile/questions/cases.test.ts — all ${checks.length} passed`)
