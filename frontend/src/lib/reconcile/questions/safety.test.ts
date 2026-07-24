/**
 * Blume — safety-check derivation tests.
 *
 * What this screen promises a surgeon, and what these checks hold it to:
 *   1. Only things that could actually strand a patient are raised. The
 *      shared detector fires once per occurrence, so "no tests before the
 *      visit" arrives six times over on a real tree — it must leave here as
 *      ONE calm sentence, or the screen teaches people to ignore it.
 *   2. A destination left behind by a decision the surgeon already made is
 *      the system working. It is never reported back to them as a fault.
 *   3. A clean tree ends with a definite statement, not an empty list.
 *   4. Every fix routes to a person to review — the safe landing.
 *   5. The question id is stable for the same set of holes, so an answer
 *      already given survives a recompile.
 *   6. No string a surgeon reads uses the software's vocabulary.
 *
 * Same self-asserting style as lib/deltas/deltas.test.ts: no framework.
 */
import { TreeSchema, type Tree, type TreeInput } from '../../../types/tree'
import type { FlowInput } from '../types'
import {
  deriveSafetyQuestions,
  fixLabel,
  fixSummary,
  leaveSummary,
  type SafetyQuestion,
} from './safety'

declare const process: { exitCode?: number } | undefined

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const EMPTY_WORKUP = { always: [], conditional: [], doNotOrderUnless: [] }

const MRI = {
  always: [{ name: 'MRI knee', protocol: 'Non-contrast', rationale: 'Confirms the operative target.' }],
  conditional: [],
  doNotOrderUnless: [],
}

/** The clinic's decision, as the compiler renders it once a surgeon says they
 *  don't treat something: a new place to land, carrying their words. */
const DECISION_REASON = "Out of scope for this clinic: we don't treat traumatic knee pain"

/**
 * One knee-referral scaffold with every kind of hole in it:
 *   · an unassigned destination                      (spec_placeholder)
 *   · a group of patients that leads nowhere         ("No mechanical symptoms")
 *   · three reachable destinations with no tests     (conservative, pt, placeholder)
 *   · a destination nothing points at any more, left behind by the surgeon's
 *     own "we don't treat traumatic knee pain"       (spec_trauma)
 *
 * `p` namespaces the ids the way a regenerated CPG upload does, so the same
 * clinical scaffold can be built twice with nothing in common but its meaning.
 */
function makeTree(p = (s: string) => s, opts: { decision?: string } = {}): Tree {
  const nodes = [
    {
      id: p('root'),
      type: 'variable',
      variableKey: 'red_flags_present',
      prompt: 'Are there red flags?',
      dataSource: 'referral',
      branches: [
        { label: 'Red flags present', condition: { op: 'equals', value: true }, nextNodeId: p('esc_urgent') },
        { label: 'No red flags', condition: { op: 'equals', value: false }, nextNodeId: p('v_duration') },
        {
          label: 'Traumatic onset',
          condition: { op: 'equals', value: 'traumatic' },
          nextNodeId: p('esc_decision'),
        },
      ],
    },
    { id: p('esc_urgent'), type: 'escalation', reason: 'Red-flag features need urgent review.' },
    { id: p('esc_decision'), type: 'escalation', reason: opts.decision ?? DECISION_REASON },
    {
      id: p('v_duration'),
      type: 'variable',
      variableKey: 'duration_of_symptoms_weeks',
      prompt: 'How long have symptoms lasted?',
      dataSource: 'patient',
      branches: [
        { label: 'Duration < 6 weeks', condition: { op: 'range', max: 6 }, nextNodeId: p('spec_conservative') },
        { label: 'Duration 6 weeks to 6 months', condition: { op: 'range', min: 6, max: 26 }, nextNodeId: p('spec_pt') },
        { label: 'Duration > 6 months', condition: { op: 'range', min: 26 }, nextNodeId: p('v_mechanical') },
      ],
    },
    {
      id: p('v_mechanical'),
      type: 'variable',
      variableKey: 'mechanical_symptoms_present',
      prompt: 'Any locking or catching?',
      dataSource: 'patient',
      branches: [
        {
          label: 'Mechanical symptoms present',
          condition: { op: 'equals', value: true },
          nextNodeId: p('spec_placeholder'),
        },
        // Leads nowhere: the hole this screen exists to catch.
        { label: 'No mechanical symptoms', condition: { op: 'equals', value: false }, nextNodeId: '' },
        {
          label: 'Locking with giving way',
          condition: { op: 'equals', value: 'severe' },
          nextNodeId: p('spec_surgical'),
        },
      ],
    },
    {
      id: p('spec_conservative'),
      type: 'specialist',
      specialistName: 'Continue or initiate conservative management (NSAIDs + physical therapy)',
      specialty: 'Primary care',
      urgency: 'routine',
      reasoningTemplate: '',
      workup: EMPTY_WORKUP,
      clinicalBasis: 'Recommendation 3: conservative management first.',
    },
    {
      id: p('spec_pt'),
      type: 'specialist',
      specialistName: 'Physical therapy',
      specialty: 'Rehabilitation',
      urgency: 'routine',
      reasoningTemplate: '',
      workup: EMPTY_WORKUP,
    },
    {
      id: p('spec_placeholder'),
      type: 'specialist',
      specialistName: '[Assign specialist — Action Knee Referral]',
      specialty: 'Action Knee Referral',
      urgency: 'routine',
      reasoningTemplate: '',
      workup: EMPTY_WORKUP,
    },
    {
      id: p('spec_surgical'),
      type: 'specialist',
      specialistName:
        'Referral for evaluation of suspected internal derangement (mechanical symptoms present despite possible absence of significant radiographic change)',
      specialty: 'Orthopaedic surgery',
      urgency: 'expedited',
      reasoningTemplate: '',
      workup: MRI,
      clinicalBasis: 'Recommendation 5: mechanical symptoms warrant surgical evaluation.',
    },
    // Nothing points here any more — the traumatic group now lands on the
    // clinic's own decision instead.
    {
      id: p('spec_trauma'),
      type: 'specialist',
      specialistName: 'Referral for assessment of acute traumatic knee injury',
      specialty: 'Orthopaedic surgery',
      urgency: 'urgent',
      reasoningTemplate: '',
      workup: EMPTY_WORKUP,
    },
  ]
  return TreeSchema.parse({ treeId: 't', rootNodeId: p('root'), nodes } as TreeInput)
}

/** The same scaffold with both holes closed and nothing stranded. */
function makeCleanTree(): Tree {
  const t = makeTree()
  const nodes = t.nodes
    .filter((n) => n.id !== 'spec_trauma')
    .map((n) => {
      if (n.id === 'v_mechanical' && n.type === 'variable') {
        return {
          ...n,
          branches: n.branches.map((b) => (b.nextNodeId ? b : { ...b, nextNodeId: 'spec_pt' })),
        }
      }
      if (n.id === 'spec_placeholder' && n.type === 'specialist') {
        return { ...n, specialistName: 'Dr. Osei', specialty: 'Orthopaedic surgery' }
      }
      return n
    })
  return TreeSchema.parse({ ...t, nodes } as unknown as TreeInput)
}

/** A tree whose "No mechanical symptoms" group leads to a question with no
 *  answers — a path that can never reach anyone at all. */
function makeDeadZoneTree(): Tree {
  const t = makeTree()
  const nodes = t.nodes.map((n) => {
    if (n.id === 'v_mechanical' && n.type === 'variable') {
      return {
        ...n,
        branches: n.branches.map((b) => (b.nextNodeId ? b : { ...b, nextNodeId: 'v_stub' })),
      }
    }
    return n
  })
  nodes.push({
    id: 'v_stub',
    type: 'variable',
    variableKey: 'imaging_obtained',
    prompt: 'Has imaging been obtained?',
    dataSource: 'record',
    branches: [],
  })
  return TreeSchema.parse({ ...t, nodes } as unknown as TreeInput)
}

function derive(tree: Tree): SafetyQuestion {
  const input: FlowInput = { tree, roster: [], subspecialty: null, cases: [] }
  const questions = deriveSafetyQuestions(input)
  if (questions.length !== 1) throw new Error(`expected exactly one question, got ${questions.length}`)
  return questions[0]
}

/** Every string this section puts in front of a surgeon. */
function surgeonStrings(q: SafetyQuestion): string[] {
  return [
    q.question,
    q.guidelineLine,
    q.stakesLine,
    q.reassurance,
    q.acceptLabel,
    q.acceptSummary,
    ...q.notes,
    ...q.gaps.flatMap((g) => [g.sentence, g.fix]),
    fixLabel(1, Math.max(q.gaps.length, 1)),
    fixLabel(q.gaps.length, q.gaps.length),
    fixLabel(0, q.gaps.length),
    fixSummary(Math.max(q.gaps.length, 1)),
    leaveSummary(Math.max(q.gaps.length, 1)),
  ]
}

const FORBIDDEN = [
  'node', 'endpoint', 'tree', 'delta', 'reconcile', 'gap sweep', 'threshold', 'variable',
  'condition', 'mapping', 'band', 'publish', 'scope', 'branch', 'anchor', 'workup',
  'unreachable', 'dangling',
]

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

const checks: Array<{ name: string; run: () => string | null }> = [
  {
    name: 'only genuine holes become rows — an unassigned destination and a group leading nowhere',
    run: () => {
      const q = derive(makeTree())
      if (q.gaps.length !== 2) return `expected 2 rows, got ${q.gaps.length}: ${q.gaps.map((g) => g.sentence).join(' | ')}`
      const sentences = q.gaps.map((g) => g.sentence)
      if (!sentences.includes('Action Knee Referral has no one assigned.'))
        return `unassigned row wrong: ${sentences.join(' | ')}`
      if (!sentences.includes(`"No mechanical symptoms" doesn't lead anywhere.`))
        return `dead-end row wrong: ${sentences.join(' | ')}`
      if (q.question !== 'Two things could leave a patient with nowhere to go. Fix them?')
        return `question wrong: ${q.question}`
      if (fixLabel(2, 2) !== '✓ Fix both') return `button wrong: ${fixLabel(2, 2)}`
      if (fixSummary(2) !== 'Fixed two things that could have left a patient with nowhere to go.')
        return `summary wrong: ${fixSummary(2)}`
      return null
    },
  },
  {
    name: 'three "no tests" findings collapse to ONE non-blocking sentence',
    run: () => {
      const q = derive(makeTree())
      const testNotes = q.notes.filter((n) => n.includes('no tests ordered ahead of the visit'))
      if (testNotes.length !== 1) return `expected 1 sentence, got ${testNotes.length}: ${testNotes.join(' | ')}`
      const expected =
        '3 of your 4 destinations have no tests ordered ahead of the visit. ' +
        `That's allowed — go back to "Tests before the visit" if you'd like to change it.`
      if (testNotes[0] !== expected) return `wrong wording: ${testNotes[0]}`
      // It is a note, never a row: nothing to decide, nothing to fix.
      if (q.gaps.some((g) => g.sentence.includes('tests'))) return 'a "no tests" finding became a row'
      return null
    },
  },
  {
    name: 'a destination stranded by the surgeon\'s own decision is never mentioned',
    run: () => {
      const q = derive(makeTree())
      const mentions = [...q.notes, ...q.gaps.map((g) => g.sentence)].filter((s) => s.includes("isn't reached"))
      if (mentions.length !== 0) return `explained finding surfaced: ${mentions.join(' | ')}`
      if (q.notes.some((n) => n.toLowerCase().includes('traumatic')))
        return `stranded destination named anyway: ${q.notes.join(' | ')}`
      return null
    },
  },
  {
    name: 'a destination stranded for no reason IS mentioned, once and calmly',
    run: () => {
      const q = derive(makeTree(undefined, { decision: 'Traumatic presentations were not covered by the supplied text.' }))
      const leftover = q.notes.filter((n) => n.includes("isn't reached"))
      if (leftover.length !== 1) return `expected 1 quiet sentence, got ${leftover.length}: ${q.notes.join(' | ')}`
      if (!leftover[0].includes('no patient can land there')) return `not reassuring enough: ${leftover[0]}`
      if (q.gaps.length !== 2) return 'a stranded destination became something to fix'
      return null
    },
  },
  {
    name: 'a group leading to a question with no answers is caught at the way in',
    run: () => {
      const q = derive(makeDeadZoneTree())
      const sentences = q.gaps.map((g) => g.sentence)
      if (!sentences.includes(`"No mechanical symptoms" doesn't lead anywhere.`))
        return `entry to the dead end not raised: ${sentences.join(' | ')}`
      if (q.gaps.length !== 2) return `expected 2 rows, got ${sentences.join(' | ')}`
      const fix = q.gaps.find((g) => g.sentence.startsWith('"No mechanical'))!.drafts[0].payload
      if (fix.op !== 'retarget_branch') return `expected a retarget, got ${fix.op}`
      return null
    },
  },
  {
    name: 'a clean tree ends with a definite statement, not an empty list',
    run: () => {
      const q = derive(makeCleanTree())
      if (q.gaps.length !== 0) return `expected nothing to fix, got ${q.gaps.map((g) => g.sentence).join(' | ')}`
      if (q.question !== 'Is this safe to turn on?') return `question wrong: ${q.question}`
      if (
        q.guidelineLine !==
        'Every patient ends up somewhere — either a specific place to send them, or a person to review.'
      )
        return `guideline line wrong: ${q.guidelineLine}`
      if (q.stakesLine !== "Nothing can fall through — there is no patient this doesn't have an answer for.")
        return `stakes line wrong: ${q.stakesLine}`
      if (q.acceptLabel !== '✓ Looks good') return `button wrong: ${q.acceptLabel}`
      if (q.acceptSummary !== 'Checked — every patient reaches someone.') return `summary wrong: ${q.acceptSummary}`
      if (!q.reassurance.includes('6 destinations in all')) return `reassurance not definite: ${q.reassurance}`
      if (!q.reassurance.includes('go to a person to review')) return `reassurance incomplete: ${q.reassurance}`
      return null
    },
  },
  {
    name: 'every fix routes those patients to a person to review',
    run: () => {
      const q = derive(makeTree())
      const payloads = q.gaps.flatMap((g) => g.drafts.map((d) => d.payload))
      if (payloads.length !== 2) return `expected 2 fixes, got ${payloads.length}`

      const bind = payloads.find((p) => p.op === 'bind_terminal')
      if (!bind || bind.op !== 'bind_terminal') return 'no fix for the unassigned destination'
      if (bind.anchors.length !== 1 || bind.anchors[0].kind !== 'terminal')
        return `unassigned fix is not anchored on the destination: ${JSON.stringify(bind.anchors)}`
      if (bind.anchors[0].specialistName !== '[Assign specialist — Action Knee Referral]')
        return `wrong destination anchored: ${bind.anchors[0].specialistName}`
      if (bind.target.kind !== 'escalation' || bind.target.reason !== 'No one assigned yet — needs a person to triage')
        return `unassigned fix does not land on a person: ${JSON.stringify(bind.target)}`

      const retarget = payloads.find((p) => p.op === 'retarget_branch')
      if (!retarget || retarget.op !== 'retarget_branch') return 'no fix for the group leading nowhere'
      if (retarget.branch.node.kind !== 'variable' || retarget.branch.node.variableKey !== 'mechanical_symptoms_present')
        return `wrong question anchored: ${JSON.stringify(retarget.branch.node)}`
      if (retarget.branch.label !== 'No mechanical symptoms')
        return `wrong group anchored: ${retarget.branch.label}`
      if (retarget.target.kind !== 'escalation' || retarget.target.reason !== 'Unfinished — needs a person to triage')
        return `dead-end fix does not land on a person: ${JSON.stringify(retarget.target)}`

      // Nothing is stamped here — provenance belongs to the shell.
      if (q.gaps.some((g) => g.drafts.some((d) => d.provenance !== undefined)))
        return 'a fix stamped its own provenance'
      return null
    },
  },
  {
    name: 'the question id is stable across a regenerated guideline, and changes with the holes',
    run: () => {
      const a = derive(makeTree())
      const b = derive(makeTree((s) => `doc_365e38_s4_${s}`))
      if (a.id !== b.id) return `id moved on regeneration: ${a.id} vs ${b.id}`
      if (!a.id.startsWith('safety:')) return `id not prefixed: ${a.id}`
      const clean = derive(makeCleanTree())
      if (clean.id === a.id) return 'a clean tree reuses the id of a tree with holes'
      if (!clean.id.startsWith('safety:')) return `clean id not prefixed: ${clean.id}`
      // Same holes, different order in the file → same id.
      const shuffled = makeTree()
      const c = derive(TreeSchema.parse({ ...shuffled, nodes: [...shuffled.nodes].reverse() } as unknown as TreeInput))
      if (c.id !== a.id) return `id depends on the order things are stored in: ${c.id} vs ${a.id}`
      return null
    },
  },
  {
    name: 'nothing a surgeon reads uses the software\'s vocabulary',
    run: () => {
      const trees: Array<[string, Tree]> = [
        ['with holes', makeTree()],
        ['clean', makeCleanTree()],
        ['dead end', makeDeadZoneTree()],
        ['stranded', makeTree(undefined, { decision: 'Not covered by the supplied text.' })],
      ]
      for (const [name, tree] of trees) {
        for (const line of surgeonStrings(derive(tree))) {
          for (const word of FORBIDDEN) {
            if (new RegExp(`\\b${word}\\b`, 'i').test(line)) return `"${word}" in ${name}: ${line}`
          }
        }
      }
      return null
    },
  },
  {
    name: 'unchecking every row is still a complete answer',
    run: () => {
      const q = derive(makeTree())
      if (fixLabel(0, q.gaps.length) !== '✓ Leave them as they are') return `wrong label: ${fixLabel(0, q.gaps.length)}`
      if (leaveSummary(2) !== 'Reviewed — left two things as they are.') return `wrong summary: ${leaveSummary(2)}`
      if (fixLabel(1, 2) !== '✓ Fix one') return `partial label wrong: ${fixLabel(1, 2)}`
      if (fixLabel(3, 3) !== '✓ Fix all three') return `three-up label wrong: ${fixLabel(3, 3)}`
      if (fixLabel(1, 1) !== '✓ Fix it') return `single label wrong: ${fixLabel(1, 1)}`
      if (fixSummary(1) !== 'Fixed one thing that could have left a patient with nowhere to go.')
        return `single summary wrong: ${fixSummary(1)}`
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
  throw new Error(`${failures} safety-check test(s) failed`)
}
console.log(`reconcile/questions/safety.test.ts — all ${checks.length} passed`)
