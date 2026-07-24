import { TreeSchema, type Tree } from '../../../types/tree'
import { compile, type BaseTreeInput } from '../../deltas/compile'
import type { Delta } from '../../deltas/schema'
import { headline, isVerbose, wordCount } from '../plainLabel'
import type { FlowInput, RosterEntry } from '../types'
import {
  assignmentDrafts,
  assignmentSummary,
  bindAllDrafts,
  bindAllSummary,
  deriveRoutingQuestions,
  guidelineLineFor,
  oneAtATimeSummary,
  ROUTING_COPY,
  routingDestinations,
  SEND_TO_PERSON,
  URGENCY_CHOICES,
  type RoutingAssignment,
  type RoutingDestination,
} from './routing'

/**
 * Blume — "Who sees what" (the routing section of the guided setup).
 *
 * The invariants this section lives or dies by:
 *   1. A seventeen-word guideline sentence is never the primary text a surgeon
 *      reads — but it is never lost either.
 *   2. A destination we cannot defensibly match is left unassigned. A guessed
 *      name on this screen sends a real patient to the wrong surgeon.
 *   3. The one-surgeon shortcut appears only where "everything goes to me" is
 *      plausibly true.
 *   4. Urgency is written BEFORE the binding, so it is matched against the
 *      destination's pre-binding identity, which is still unique.
 *   5. Question ids survive a guideline re-upload (fresh doc-id prefixes).
 *   6. Nothing this section derives speaks in software vocabulary.
 *
 * Same self-asserting style as deltas.test.ts: no framework.
 */

declare const process: { exitCode?: number } | undefined

/* -------------------------------------------------------------------------- */
/* Fixture — shaped like the real knee CPG                                    */
/* -------------------------------------------------------------------------- */

/** 19 tokens, verbatim from the real guideline. Nobody scans this. */
const LONG_NAME =
  'Referral via standard pathway — appropriateness supported by symptom chronicity, radiographic severity, and documented failure of conservative treatment'

/** The real tree attaches this SAME sentence to two different destinations. */
const SHARED_BASIS =
  'In the absence of red flags, referral appropriateness increases with symptom chronicity, radiographic severity, and documented failure of conservative treatment.'

const NERVE_BASIS =
  'Mechanical symptoms (locking, catching, instability) raise appropriateness even in the absence of significant radiographic change.'

const emptyWorkup = { always: [], conditional: [], doNotOrderUnless: [] }

/** The same clinical scaffold under any document namespace — ids are reissued
 *  on every upload, so nothing may depend on them. */
function makeBase(docId: string): BaseTreeInput {
  const p = (s: string) => `doc_${docId}_${s}`
  return {
    treeId: `tree_${docId}`,
    rootNodeId: p('root'),
    nodes: [
      {
        id: p('root'),
        type: 'variable',
        variableKey: p('s0_pathway'),
        prompt: 'Which pathway applies?',
        dataSource: 'referral',
        branches: [
          { label: 'Standard', condition: { op: 'equals', value: 'standard' }, nextNodeId: p('s0_standard') },
          { label: 'Watchful', condition: { op: 'equals', value: 'watchful' }, nextNodeId: p('s0_watchful') },
          { label: 'Mechanical', condition: { op: 'equals', value: 'mechanical' }, nextNodeId: p('s0_nerve') },
          { label: 'Unnamed', condition: { op: 'equals', value: 'unnamed' }, nextNodeId: p('s0_placeholder') },
        ],
      },
      {
        id: p('s0_standard'),
        type: 'specialist',
        specialistName: LONG_NAME,
        specialty: 'Peripheral nerve surgery',
        urgency: 'routine',
        reasoningTemplate: '',
        workup: emptyWorkup,
        clinicalBasis: SHARED_BASIS,
      },
      {
        id: p('s0_watchful'),
        type: 'specialist',
        specialistName:
          'Continue and document conservative management; reassess referral appropriateness as chronicity, radiographic severity, or treatment failure criteria are met',
        specialty: 'Peripheral nerve surgery',
        urgency: 'routine',
        reasoningTemplate: '',
        workup: emptyWorkup,
        // Byte-identical to the standard-pathway destination above.
        clinicalBasis: SHARED_BASIS,
      },
      {
        id: p('s0_nerve'),
        type: 'specialist',
        specialistName:
          'Referral for evaluation of suspected internal derangement (mechanical symptoms present despite possible absence of significant radiographic change)',
        specialty: 'Peripheral nerve surgery',
        urgency: 'routine',
        reasoningTemplate: '',
        workup: emptyWorkup,
        clinicalBasis: NERVE_BASIS,
      },
      {
        id: p('s0_placeholder'),
        type: 'specialist',
        specialistName: '[Assign specialist — Orthopedic Surgery]',
        specialty: 'Orthopedic Surgery',
        urgency: 'routine',
        reasoningTemplate: '',
        workup: emptyWorkup,
        clinicalBasis: 'Section header only: Primary Care to Orthopedic Referral.',
      },
    ],
  }
}

/** One roster specialty the guideline's areas match, one it plainly doesn't. */
const ROSTER: RosterEntry[] = [
  { id: 'sp_reyes', name: 'Dr. Reyes', specialty: 'Orthopaedic surgery' },
  { id: 'sp_osei', name: 'Dr. Osei', specialty: 'Dermatology' },
]

const BIG_ROSTER: RosterEntry[] = [
  ...ROSTER,
  { id: 'sp_c', name: 'Dr. Chen', specialty: 'Sports medicine' },
  { id: 'sp_d', name: 'Dr. Diaz', specialty: 'Rheumatology' },
]

function treeOf(docId: string): Tree {
  const base = makeBase(docId)
  return TreeSchema.parse({ treeId: base.treeId, rootNodeId: base.rootNodeId, nodes: base.nodes })
}

function inputOf(docId: string, roster: RosterEntry[] = ROSTER): FlowInput {
  return { tree: treeOf(docId), roster, subspecialty: null, cases: [] }
}

function destOf(input: FlowInput, match: (d: RoutingDestination) => boolean): RoutingDestination {
  const found = routingDestinations(input).find(match)
  if (!found) throw new Error('fixture destination not found')
  return found
}

/** Software vocabulary a surgeon must never be shown. */
const FORBIDDEN = [
  'node', 'endpoint', 'tree', 'delta', 'reconcile', 'gap sweep', 'threshold',
  'variable', 'condition', 'mapping', 'band', 'publish', 'scope', 'branch', 'anchor',
]

function forbiddenIn(text: string): string | null {
  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}s?\\b`, 'i').test(text)) return word
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

const checks: Array<{ name: string; run: () => string | null }> = [
  {
    name: 'a 19-word guideline sentence is shown as a short headline, full text kept',
    run: () => {
      const input = inputOf('aaa')
      const d = destOf(input, (x) => x.node.specialistName === LONG_NAME)
      if (wordCount(LONG_NAME) < 17) return 'fixture name is not a long guideline sentence'
      if (!isVerbose(LONG_NAME)) return 'fixture name should count as verbose'
      if (d.title !== headline(LONG_NAME)) return `title is not the headline: ${d.title}`
      if (d.title !== 'Referral via standard pathway') return `unexpected headline: ${d.title}`
      if (wordCount(d.title) > 10) return `headline too long: ${d.title}`
      if (d.fullText !== LONG_NAME) return 'the guideline sentence is not available in full'
      if (d.clinicalBasis !== SHARED_BASIS) return 'the citation is not carried through'
      if (d.node.specialistName !== LONG_NAME) return 'stored data was altered'
      return null
    },
  },
  {
    name: 'an unnamed destination reads as its area of care, not as stored shorthand',
    run: () => {
      const input = inputOf('aaa')
      const d = destOf(input, (x) => x.unassigned)
      if (d.title.includes('[') || d.title.toLowerCase().includes('assign specialist'))
        return `placeholder shorthand leaked into the title: ${d.title}`
      if (d.title !== 'Orthopedic Surgery') return `unexpected placeholder title: ${d.title}`
      return null
    },
  },
  {
    name: 'no defensible match is left unassigned, never guessed',
    run: () => {
      const input = inputOf('aaa')
      const nerve = destOf(input, (x) => x.area === 'Peripheral nerve surgery')
      // "Peripheral nerve surgery" shares only the word "surgery" with
      // "Orthopaedic surgery" — that is not evidence, so nobody is proposed.
      if (nerve.suggestedId !== '') return `guessed ${nerve.suggestedId} with no grounds`
      const ortho = destOf(input, (x) => x.unassigned)
      if (ortho.suggestedId !== 'sp_reyes')
        return `orthopaedic destination should pre-fill Dr. Reyes, got "${ortho.suggestedId}"`
      // Dr. Osei (Dermatology) matches nothing in this guideline.
      if (routingDestinations(input).some((d) => d.suggestedId === 'sp_osei'))
        return 'an unrelated specialty was proposed'
      return null
    },
  },
  {
    name: 'the one-surgeon shortcut appears only for a small roster',
    run: () => {
      const small = deriveRoutingQuestions(inputOf('aaa', [ROSTER[0]]))
      if (small[0]?.mode !== 'all') return 'no shortcut for a one-person roster'
      if (small[0].question !== 'Should all four kinds of referral go to Dr. Reyes?')
        return `unexpected shortcut question: ${small[0].question}`
      if (small[0].guidelineLine !== 'You have one surgeon on file.')
        return `unexpected shortcut line: ${small[0].guidelineLine}`
      const two = deriveRoutingQuestions(inputOf('aaa'))
      if (two[0]?.mode !== 'all') return 'no shortcut for a two-person roster'
      if (two[0].guidelineLine !== 'You have two surgeons on file.')
        return `unexpected two-person line: ${two[0].guidelineLine}`
      const many = deriveRoutingQuestions(inputOf('aaa', BIG_ROSTER))
      if (many.some((q) => q.mode === 'all')) return 'shortcut offered to a four-person roster'
      if (many.length === 0) return 'a large roster got no questions at all'
      return null
    },
  },
  {
    name: 'a screen never carries more than six decisions, and every one is asked as a question',
    run: () => {
      const questions = deriveRoutingQuestions(inputOf('aaa', BIG_ROSTER))
      for (const q of questions) {
        if (q.destinations.length > 6) return `${q.destinations.length} on one screen`
        if (!q.question.endsWith('?')) return `not a question: ${q.question}`
        if (!q.guidelineLine.trim()) return 'a screen has no guideline line'
        if (!q.stakesLine.trim()) return 'a screen names no stakes'
      }
      const covered = questions.filter((q) => q.mode === 'assign').flatMap((q) => q.destinations)
      if (covered.length !== routingDestinations(inputOf('aaa')).length)
        return 'some destinations are never asked about'
      return null
    },
  },
  {
    name: 'urgency is written before the binding it belongs to',
    run: () => {
      const input = inputOf('aaa')
      const placeholder = destOf(input, (x) => x.unassigned)
      const nerve = destOf(input, (x) => x.node.specialistName === LONG_NAME)
      const assignments: RoutingAssignment[] = [
        { destination: placeholder, specialistId: 'sp_reyes', urgency: 'urgent' },
        { destination: nerve, specialistId: 'sp_osei', urgency: 'expedited' },
      ]
      const drafts = assignmentDrafts(assignments, ROSTER)
      const ops = drafts.map((d) => d.payload.op)
      if (ops.length !== 4) return `expected 4 changes, got ${ops.join(', ')}`
      const lastUrgency = ops.lastIndexOf('set_urgency')
      const firstBind = ops.indexOf('bind_terminal')
      if (lastUrgency > firstBind) return `wrong order: ${ops.join(' → ')}`
      const bind = drafts.find((d) => d.payload.op === 'bind_terminal')
      if (bind?.specialistId !== 'sp_reyes') return 'the roster reference is not carried on the change'
      if (bind.payload.op !== 'bind_terminal' || bind.payload.target.kind !== 'specialist')
        return 'binding did not target a person'
      if (bind.payload.target.specialistName !== 'Dr. Reyes') return 'bound to the wrong person'
      if (bind.payload.anchors.length !== 1) return 'a binding should carry exactly one match'
      return null
    },
  },
  {
    name: 'leaving someone unassigned writes nothing; sending to a person writes one change',
    run: () => {
      const input = inputOf('aaa')
      const d = destOf(input, (x) => x.unassigned)
      const none = assignmentDrafts([{ destination: d, specialistId: '', urgency: d.urgency }], ROSTER)
      if (none.length !== 0) return `keeping the guideline wrote ${none.length} change(s)`
      const toPerson = assignmentDrafts(
        [{ destination: d, specialistId: SEND_TO_PERSON, urgency: 'urgent' }],
        ROSTER,
      )
      if (toPerson.length !== 1) return `expected one change, got ${toPerson.length}`
      const payload = toPerson[0].payload
      if (payload.op !== 'bind_terminal' || payload.target.kind !== 'escalation')
        return 'sending to a person did not produce a human hand-off'
      return null
    },
  },
  {
    name: 'both changes apply cleanly even when two destinations share guideline wording',
    run: () => {
      const base = makeBase('aaa')
      const input = inputOf('aaa')
      const standard = destOf(input, (x) => x.node.specialistName === LONG_NAME)
      const watchful = destOf(input, (x) => x.node.specialistName.startsWith('Continue and document'))
      if (!standard.sharedWording || !watchful.sharedWording)
        return 'the shared-wording collision was not detected'
      const drafts = assignmentDrafts(
        [
          { destination: standard, specialistId: 'sp_reyes', urgency: 'urgent' },
          { destination: watchful, specialistId: 'sp_osei', urgency: watchful.urgency },
        ],
        ROSTER,
      )
      const deltas: Delta[] = drafts.map((d, i) => ({
        id: `d${i}`,
        seq: i,
        payload: d.payload,
        provenance: { author: '', rationale: '', deviatesFromCpg: false },
        status: 'active' as const,
      }))
      const { tree, results } = compile(base, deltas)
      const bad = results.find((r) => r.status !== 'applied')
      if (bad) return `${bad.status}: ${bad.reason}`
      const reyes = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName === 'Dr. Reyes')
      if (reyes?.type !== 'specialist') return 'the binding never landed'
      if (reyes.urgency !== 'urgent') return 'the urgency change did not reach the same destination'
      if (reyes.specialty !== 'Peripheral nerve surgery')
        return `the guideline's area of care was overwritten: ${reyes.specialty}`
      const osei = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName === 'Dr. Osei')
      if (!osei) return 'the second binding never landed'
      return null
    },
  },
  {
    name: 'the shortcut binds every destination to one person, in one batch',
    run: () => {
      const input = inputOf('aaa', [ROSTER[0]])
      const destinations = routingDestinations(input)
      const drafts = bindAllDrafts(destinations, ROSTER[0])
      if (drafts.length !== destinations.length) return `expected ${destinations.length} bindings`
      if (drafts.some((d) => d.payload.op !== 'bind_terminal')) return 'the shortcut wrote something else'
      const { results } = compile(
        makeBase('aaa'),
        drafts.map((d, i) => ({
          id: `d${i}`,
          seq: i,
          payload: d.payload,
          provenance: { author: '', rationale: '', deviatesFromCpg: false },
          status: 'active' as const,
        })),
      )
      const bad = results.find((r) => r.status !== 'applied')
      if (bad) return `${bad.status}: ${bad.reason}`
      return null
    },
  },
  {
    name: 'question ids survive a fresh document-id prefix',
    run: () => {
      const first = deriveRoutingQuestions(inputOf('aaaaaaaa'))
      const second = deriveRoutingQuestions(inputOf('bbbbbbbb'))
      if (first.length !== second.length) return 'the question list changed shape on re-upload'
      for (let i = 0; i < first.length; i++) {
        if (first[i].id !== second[i].id) return `id ${first[i].id} became ${second[i].id}`
        if (!first[i].id.startsWith('routing:')) return `id is not prefixed: ${first[i].id}`
        if (/doc_[0-9a-f]/.test(first[i].id)) return 'an id carries a document namespace'
      }
      return null
    },
  },
  {
    name: 'the summary reads as a sentence a surgeon would say',
    run: () => {
      const input = inputOf('aaa')
      const all = routingDestinations(input)
      const assignments: RoutingAssignment[] = [
        { destination: all[0], specialistId: 'sp_reyes', urgency: all[0].urgency },
        { destination: all[1], specialistId: 'sp_reyes', urgency: all[1].urgency },
        { destination: all[2], specialistId: 'sp_osei', urgency: all[2].urgency },
        { destination: all[3], specialistId: '', urgency: all[3].urgency },
      ]
      const summary = assignmentSummary(assignments, ROSTER)
      const expected =
        'Dr. Reyes sees 2 of these. Dr. Osei sees 1. One has no one assigned and will go to a person to review.'
      if (summary !== expected) return `unexpected summary: ${summary}`
      const kept = assignmentSummary(
        all.map((d) => ({ destination: d, specialistId: '', urgency: d.urgency })),
        ROSTER,
      )
      if (!kept.includes('no one assigned')) return `unexpected all-unassigned summary: ${kept}`
      return null
    },
  },
  {
    name: 'nothing this section derives speaks in software vocabulary',
    run: () => {
      const strings: string[] = [
        ...Object.values(ROUTING_COPY),
        ...URGENCY_CHOICES.map((c) => c.label),
        oneAtATimeSummary(),
        bindAllSummary(routingDestinations(inputOf('aaa')), ROSTER[0]),
      ]
      for (const roster of [[ROSTER[0]], ROSTER, BIG_ROSTER]) {
        for (const q of deriveRoutingQuestions(inputOf('aaa', roster))) {
          strings.push(q.question, q.guidelineLine, q.stakesLine)
          strings.push(guidelineLineFor(q.destinations))
        }
      }
      const input = inputOf('aaa')
      strings.push(
        assignmentSummary(
          routingDestinations(input).map((d, i) => ({
            destination: d,
            specialistId: i === 0 ? 'sp_reyes' : i === 1 ? SEND_TO_PERSON : '',
            urgency: i === 2 ? 'urgent' : 'routine',
          })),
          ROSTER,
        ),
      )
      for (const text of strings) {
        const hit = forbiddenIn(text)
        if (hit) return `"${hit}" in: ${text}`
      }
      return null
    },
  },
  {
    name: 'a guideline with nowhere to send anyone asks nothing',
    run: () => {
      const empty: FlowInput = {
        tree: TreeSchema.parse({
          treeId: 't',
          rootNodeId: 'esc',
          nodes: [{ id: 'esc', type: 'escalation', reason: 'A person reviews this.' }],
        }),
        roster: ROSTER,
        subspecialty: null,
        cases: [],
      }
      return deriveRoutingQuestions(empty).length === 0 ? null : 'invented a question out of nothing'
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
  throw new Error(`${failures} routing section test(s) failed`)
}
console.log(`reconcile/questions/routing.test.ts — all ${checks.length} passed`)
