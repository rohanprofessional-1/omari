/**
 * Blume — "Tests before the visit" tests.
 *
 * The invariants this section exists to hold:
 *   1. NO SCREEN IS EVER EMPTY. A generated guideline carries no pre-visit
 *      tests at all, and the old screen answered that with a blank card and an
 *      "add" button. Every question here arrives with a full set of sentences
 *      and either the guideline's list or ours.
 *   2. A suggestion is OURS and says so, and only becomes real when kept —
 *      that keep is the only thing that writes `add_workup`.
 *   3. Keeping what the guideline already asks for writes NOTHING.
 *   4. Removing what the guideline asks for writes `remove_workup`.
 *   5. Patients who can't reach a destination aren't asked about.
 *   6. Ids survive a guideline re-upload (fresh `doc_<hex>_` prefixes).
 *   7. Nothing a surgeon reads is written in our vocabulary.
 *
 * Same self-asserting style as deltas.test.ts: no framework.
 */
import { TreeSchema, type TreeInput } from '../../../types/tree'
import type { FlowInput } from '../types'
import { deriveTestQuestions, resolveTests, type TestDecision, type TestsQuestion } from './tests'

declare const process: { exitCode?: number } | undefined

/* -------------------------------------------------------------------------- */
/* Fixture                                                                    */
/* -------------------------------------------------------------------------- */

const NERVE_BASIS = 'Persistent numbness with a positive Tinel sign supports referral for nerve evaluation.'
const CONSERVATIVE_BASIS =
  'Conservative treatment (NSAIDs + physical therapy for at least six weeks) is a prerequisite before surgical consideration.'
const KNEE_A_BASIS =
  'Mechanical symptoms (locking, catching, instability) raise appropriateness even in the absence of significant radiographic change.'
const KNEE_B_BASIS =
  'Suspected internal derangement — referral remains appropriate when plain films are unremarkable.'
const ORPHAN_BASIS = 'Superseded recommendation retained in the document appendix.'

/** The same clinical scaffold under any document namespace. */
function makeTree(docId: string): TreeInput {
  const p = (s: string) => `doc_${docId}_${s}`
  const empty = { always: [], conditional: [], doNotOrderUnless: [] }
  return {
    treeId: `tree_${docId}`,
    rootNodeId: p('cpg_root'),
    nodes: [
      {
        id: p('cpg_root'),
        type: 'variable',
        variableKey: p('cpg_section'),
        prompt: 'Which part of the guideline applies?',
        dataSource: 'referral',
        branches: [
          { label: 'Nerve', condition: { op: 'equals', value: 'nerve' }, nextNodeId: p('s0_gate') },
          { label: 'Knee', condition: { op: 'equals', value: 'knee' }, nextNodeId: p('s1_gate') },
        ],
      },
      {
        id: p('s0_gate'),
        type: 'variable',
        variableKey: 'numbness_present',
        prompt: 'Is there numbness?',
        dataSource: 'patient',
        branches: [
          { label: 'Numbness', condition: { op: 'equals', value: true }, nextNodeId: p('t_nerve') },
          { label: 'No numbness', condition: { op: 'equals', value: false }, nextNodeId: p('t_conservative') },
        ],
      },
      {
        id: p('s1_gate'),
        type: 'variable',
        variableKey: 'mechanical_symptoms_present',
        prompt: 'Any locking or catching?',
        dataSource: 'patient',
        branches: [
          { label: 'Locking', condition: { op: 'equals', value: true }, nextNodeId: p('t_knee_a') },
          { label: 'No locking', condition: { op: 'equals', value: false }, nextNodeId: p('t_knee_b') },
        ],
      },
      // The guideline named the tests here.
      {
        id: p('t_nerve'),
        type: 'specialist',
        specialistName: 'Dr. Osei',
        specialty: 'Peripheral nerve surgery',
        urgency: 'routine',
        reasoningTemplate: 'Routing to Dr. Osei.',
        clinicalBasis: NERVE_BASIS,
        workup: {
          always: [
            {
              name: 'Nerve conduction study',
              protocol: 'Bilateral, motor and sensory',
              rationale: 'The guideline asks for it before the visit.',
            },
            { name: 'X-ray of the elbow', protocol: '', rationale: 'Rules out a bony cause.' },
          ],
          conditional: [],
          doNotOrderUnless: [],
        },
      },
      // The guideline named none, and there is nothing worth proposing.
      {
        id: p('t_conservative'),
        type: 'specialist',
        specialistName: 'Continue or initiate conservative management (NSAIDs + physical therapy)',
        specialty: 'Primary care / Physical medicine and rehabilitation',
        urgency: 'routine',
        reasoningTemplate: '',
        clinicalBasis: CONSERVATIVE_BASIS,
        workup: empty,
      },
      // The guideline named none: two destinations, one specialist, one list.
      {
        id: p('t_knee_a'),
        type: 'specialist',
        specialistName: 'Dr. Reyes',
        specialty: 'Orthopaedic surgery',
        urgency: 'routine',
        reasoningTemplate: 'Routing to Dr. Reyes.',
        clinicalBasis: KNEE_A_BASIS,
        workup: empty,
      },
      {
        id: p('t_knee_b'),
        type: 'specialist',
        specialistName: 'Dr. Reyes',
        specialty: 'Orthopaedic surgery',
        urgency: 'routine',
        reasoningTemplate: 'Routing to Dr. Reyes.',
        clinicalBasis: KNEE_B_BASIS,
        workup: empty,
      },
      // No patient can arrive here — no branch points at it.
      {
        id: p('t_orphan'),
        type: 'specialist',
        specialistName: 'Dr. Nobody',
        specialty: 'Peripheral nerve surgery',
        urgency: 'routine',
        reasoningTemplate: '',
        clinicalBasis: ORPHAN_BASIS,
        workup: empty,
      },
    ],
  }
}

function inputFor(docId: string): FlowInput {
  return {
    tree: TreeSchema.parse(makeTree(docId)),
    roster: [
      { id: 'r1', name: 'Dr. Osei', specialty: 'Peripheral nerve surgery' },
      { id: 'r2', name: 'Dr. Reyes', specialty: 'Orthopaedic surgery' },
      { id: 'r3', name: 'Dr. Nobody', specialty: 'Peripheral nerve surgery' },
    ],
    subspecialty: null,
    cases: [],
  }
}

const QUESTIONS = deriveTestQuestions(inputFor('365e38'))
const find = (destination: string): TestsQuestion => {
  const q = QUESTIONS.find((x) => x.destination === destination)
  if (!q) throw new Error(`no question for "${destination}" (got: ${QUESTIONS.map((x) => x.destination).join(' | ')})`)
  return q
}
const keepAll = (q: TestsQuestion): TestDecision[] => q.items.map((i) => ({ ...i, kept: true }))

/** Our vocabulary. None of it may reach a surgeon in anything WE write. */
const INTERNAL =
  /\b(node|endpoint|tree|delta|reconcile|gap sweep|threshold|variable|condition|mapping|band|publish|scope|branch|anchor|workup)s?\b/i

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

const checks: Array<{ name: string; run: () => string | null }> = [
  {
    name: 'no screen is ever empty — every question carries a full set of sentences',
    run: () => {
      if (QUESTIONS.length === 0) return 'no questions derived at all'
      for (const q of QUESTIONS) {
        for (const [field, value] of [
          ['id', q.id],
          ['question', q.question],
          ['guidelineLine', q.guidelineLine],
          ['stakesLine', q.stakesLine],
          ['groupLine', q.groupLine],
          ['destination', q.destination],
        ] as const) {
          if (!value.trim()) return `${field} is blank on "${q.destination}"`
        }
        if (q.question !== 'What do you want done before this patient walks in?')
          return `unexpected question copy: ${q.question}`
        for (const item of q.items) {
          if (!item.name.trim()) return `a test on "${q.destination}" has no name`
          if (!item.reason.trim()) return `"${item.name}" on "${q.destination}" has no reason`
        }
        // Even with nothing to order, the screen states an answer.
        if (q.items.length === 0 && !q.guidelineLine.trim()) return 'empty list with nothing said about it'
      }
      return null
    },
  },
  {
    name: 'a destination the guideline gave tests for shows them as the guideline’s',
    run: () => {
      const q = find('Dr. Osei')
      if (q.suggested) return 'the guideline’s own tests were labelled as ours'
      if (q.guidelineLine !== 'The guideline asks for two things first.') return `guidelineLine: ${q.guidelineLine}`
      const names = q.items.map((i) => i.name)
      if (names.join(' | ') !== 'Nerve conduction study | X-ray of the elbow') return `items: ${names.join(' | ')}`
      if (q.items.some((i) => i.source !== 'guideline')) return 'a guideline test was marked as a suggestion'
      return null
    },
  },
  {
    name: 'a destination the guideline said nothing about gets OUR list, labelled as ours',
    run: () => {
      const q = find('Dr. Reyes')
      if (!q.suggested) return 'our suggestions were not labelled as ours'
      if (q.guidelineLine !== "The guideline didn't say what to order first.") return `guidelineLine: ${q.guidelineLine}`
      if (q.items.length === 0) return 'nothing proposed for a surgical knee destination — blank screen'
      if (q.items.some((i) => i.source !== 'suggested')) return 'a suggestion was passed off as the guideline’s'
      if (q.items[0].name !== 'Weight-bearing plain films of both knees') return `proposed: ${q.items[0].name}`
      return null
    },
  },
  {
    name: 'destinations sharing a specialist and a list are one question, not two',
    run: () => {
      const q = find('Dr. Reyes')
      if (q.anchors.length !== 2) return `expected 2 destinations folded together, got ${q.anchors.length}`
      if (QUESTIONS.filter((x) => x.destination === 'Dr. Reyes').length !== 1) return 'Dr. Reyes asked about twice'
      if (!q.groupLine.startsWith('Patients going to Dr. Reyes for ')) return `groupLine: ${q.groupLine}`
      if (!q.groupLine.includes('suspected internal derangement')) return `groupLine: ${q.groupLine}`
      return null
    },
  },
  {
    name: 'nothing worth proposing is still an answer, never a blank canvas',
    run: () => {
      const q = find('Primary care / Physical medicine and rehabilitation')
      if (q.items.length !== 0) return `expected nothing proposed, got ${q.items.map((i) => i.name).join(', ')}`
      const outcome = resolveTests(q, [])
      if (outcome.action !== 'accept') return `action: ${outcome.action}`
      if (outcome.drafts.length !== 0) return 'writing something for a visit that needs nothing'
      if (!outcome.summary.startsWith('Nothing is ordered before visits to ')) return `summary: ${outcome.summary}`
      return null
    },
  },
  {
    name: 'keeping the tests the guideline already asks for writes nothing',
    run: () => {
      const q = find('Dr. Osei')
      const outcome = resolveTests(q, keepAll(q))
      if (outcome.drafts.length !== 0) return `wrote ${outcome.drafts.length} change(s) for keeping the guideline`
      if (outcome.action !== 'accept') return `action: ${outcome.action}`
      if (outcome.summary !== 'Kept the two tests the guideline asks for.') return `summary: ${outcome.summary}`
      return null
    },
  },
  {
    name: 'keeping a suggestion of ours writes add_workup — once per destination in the group',
    run: () => {
      const q = find('Dr. Reyes')
      const outcome = resolveTests(q, keepAll(q))
      if (outcome.action !== 'change') return `action: ${outcome.action}`
      if (outcome.drafts.length !== 2) return `expected one add per destination, got ${outcome.drafts.length}`
      for (const d of outcome.drafts) {
        if (d.payload.op !== 'add_workup') return `wrote ${d.payload.op}`
        if (d.payload.item.name !== 'Weight-bearing plain films of both knees') return `item: ${d.payload.item.name}`
        if (!d.payload.item.rationale?.trim()) return 'a proposed test went in with no reason'
        if (d.payload.anchor.kind !== 'terminal') return `anchor kind: ${d.payload.anchor.kind}`
        if (!d.payload.anchor.clinicalBasisHash) return 'anchored without the guideline text behind it'
      }
      if (!outcome.summary.endsWith('are ordered before visits to Dr. Reyes.')) return `summary: ${outcome.summary}`
      return null
    },
  },
  {
    name: 'a suggestion nobody kept writes nothing at all',
    run: () => {
      const q = find('Dr. Reyes')
      const outcome = resolveTests(
        q,
        q.items.map((i) => ({ ...i, kept: false })),
      )
      if (outcome.drafts.length !== 0) return `a rejected suggestion wrote ${outcome.drafts.length} change(s)`
      if (outcome.action !== 'accept') return `action: ${outcome.action}`
      if (outcome.summary !== 'Nothing is ordered before visits to Dr. Reyes.') return `summary: ${outcome.summary}`
      return null
    },
  },
  {
    name: 'removing a test the guideline asks for writes remove_workup',
    run: () => {
      const q = find('Dr. Osei')
      const outcome = resolveTests(
        q,
        q.items.map((i) => ({ ...i, kept: i.name !== 'X-ray of the elbow' })),
      )
      if (outcome.action !== 'change') return `action: ${outcome.action}`
      if (outcome.drafts.length !== 1) return `expected 1 change, got ${outcome.drafts.length}`
      const payload = outcome.drafts[0].payload
      if (payload.op !== 'remove_workup') return `wrote ${payload.op}`
      if (payload.itemName !== 'X-ray of the elbow') return `removed: ${payload.itemName}`
      if (outcome.summary !== 'Nerve conduction study is ordered before visits to Dr. Osei.')
        return `summary: ${outcome.summary}`
      return null
    },
  },
  {
    name: 'every change on one screen lands in ONE batch',
    run: () => {
      const q = find('Dr. Osei')
      const decisions: TestDecision[] = [
        { ...q.items[0], kept: true },
        { ...q.items[1], kept: false },
        {
          name: 'Standing long-leg alignment film',
          reason: 'Your clinic wants this before the visit.',
          source: 'suggested',
          kept: true,
        },
      ]
      const outcome = resolveTests(q, decisions)
      const ops = outcome.drafts.map((d) => d.payload.op).sort()
      if (ops.join(',') !== 'add_workup,remove_workup') return `ops: ${ops.join(',')}`
      if (outcome.action !== 'change') return `action: ${outcome.action}`
      return null
    },
  },
  {
    name: '“We can’t get this here” keeps the test, records the note, and writes no change',
    run: () => {
      const q = find('Dr. Osei')
      const outcome = resolveTests(
        q,
        q.items.map((i) => ({ ...i, kept: true, unavailable: i.name === 'Nerve conduction study' })),
      )
      if (outcome.drafts.length !== 0) return `wrote ${outcome.drafts.length} change(s) for a note`
      if (outcome.action !== 'flag') return `action: ${outcome.action}`
      if (!outcome.note?.includes('Nerve conduction study')) return `note: ${outcome.note}`
      return null
    },
  },
  {
    name: 'a destination no patient can reach is never asked about',
    run: () => {
      if (QUESTIONS.some((q) => q.destination === 'Dr. Nobody')) return 'asked about an unreachable destination'
      if (QUESTIONS.length !== 3) return `expected 3 groups, got ${QUESTIONS.length}`
      return null
    },
  },
  {
    name: 'ids survive a guideline re-upload (fresh doc-id prefixes)',
    run: () => {
      const again = deriveTestQuestions(inputFor('ff00aa'))
      const before = QUESTIONS.map((q) => q.id).sort()
      const after = again.map((q) => q.id).sort()
      if (before.join(',') !== after.join(',')) return `ids moved:\n  ${before.join(',')}\n  ${after.join(',')}`
      if (before.some((id) => !id.startsWith('tests:'))) return `unprefixed id: ${before.join(',')}`
      if (new Set(before).size !== before.length) return 'two groups share an id'
      return null
    },
  },
  {
    name: 'nothing a surgeon reads is written in our vocabulary',
    run: () => {
      const written: string[] = []
      for (const q of QUESTIONS) {
        written.push(q.question, q.guidelineLine, q.stakesLine, q.groupLine, q.destination)
        for (const i of q.items) written.push(i.name, i.reason, i.protocol ?? '')
        const kept = resolveTests(q, keepAll(q))
        written.push(kept.summary, kept.note ?? '')
        const dropped = resolveTests(
          q,
          q.items.map((i) => ({ ...i, kept: false })),
        )
        written.push(dropped.summary)
        const flagged = resolveTests(
          q,
          q.items.map((i) => ({ ...i, kept: true, unavailable: true })),
        )
        written.push(flagged.note ?? '')
      }
      // The screen's own fixed copy travels with the component; assert it here
      // too, so a reword can't smuggle our vocabulary in.
      written.push(
        'Suggested — the guideline didn’t specify any',
        'We can’t get this here',
        'We’ll keep it on the list and flag it in your record.',
        'Nothing needs doing before this visit.',
        '✓ Order these',
        '✓ That’s right',
        'Add something',
      )
      for (const text of written) {
        const hit = INTERNAL.exec(text)
        if (hit) return `"${hit[0]}" in: ${text}`
      }
      return null
    },
  },
]

/* -------------------------------------------------------------------------- */

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
  throw new Error(`${failures} tests-section test(s) failed`)
}
console.log(`reconcile/questions/tests.test.ts — all ${checks.length} passed`)
