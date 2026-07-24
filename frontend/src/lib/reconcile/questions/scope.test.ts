/**
 * Blume — "What you treat" derivation tests.
 *
 * The invariants this screen rests on, in the order they matter:
 *   1. A surgeon is NEVER asked about the table of contents of a PDF. The
 *      synthetic document-section router is walked past, never listed.
 *   2. The same clinical decision appearing under several sections of one
 *      document produces ONE group, not one per section.
 *   3. A group that already goes to a person isn't a question.
 *   4. A safety route (red flags) is not a service line a clinic declines.
 *   5. Below two real choices we ask a confirmation, never a checklist of one.
 *   6. Ids survive a guideline re-upload (fresh doc-id prefixes).
 *   7. No string a surgeon reads contains our vocabulary.
 *
 * Same self-asserting style as deltas/deltas.test.ts: no framework.
 */
import { TreeSchema, type TreeInput } from '../../../types/tree'
import type { FlowInput } from '../types'
import { deriveScopeQuestions, type ScopeQuestion } from './scope'

declare const process: { exitCode?: number } | undefined

/* -------------------------------------------------------------------------- */
/* Fixture: a CPG-extracted base — synthetic section router over real          */
/* clinical decisions, with the section headings still wrapped in markdown.    */
/* -------------------------------------------------------------------------- */

const VERBOSE_SHOULDER =
  'Referral for evaluation of suspected internal derangement of the shoulder with mechanical symptoms present despite absence of significant radiographic change'

/** The four section headings the extractor lifted out of the document. */
const SECTION_LABELS = [
  '**Appropriate Use Criteria (Sample)**',
  '**Scope**',
  '**Indication Variables**',
  '**Narrative Notes**',
]

/**
 * `narrow: true` reproduces the real sample data — an appropriateness table
 * that already excludes everything but one population, so only one group of
 * the presentation decision is still live.
 */
function makeBase(docId: string, { narrow = false } = {}): TreeInput {
  const p = (s: string) => `doc_${docId}_${s}`
  const emptyWorkup = { always: [], conditional: [], doNotOrderUnless: [] }
  const spec = (id: string, name: string) => ({
    id,
    type: 'specialist' as const,
    specialistName: name,
    specialty: 'Orthopaedic surgery',
    urgency: 'routine' as const,
    reasoningTemplate: '',
    workup: emptyWorkup,
  })
  // When the table is narrow, hip and shoulder are already excluded by the
  // guideline itself — both sections route them to a person.
  const hipTarget = narrow ? p('s0_excluded') : p('s0_action_hip')
  const shoulderTarget = narrow ? p('s0_excluded') : p('s0_action_shoulder')

  return {
    treeId: `tree_${docId}`,
    rootNodeId: p('cpg_root'),
    nodes: [
      {
        id: p('cpg_root'),
        type: 'variable',
        variableKey: p('cpg_section'),
        prompt: 'Which section of the sample_cpg applies?',
        dataSource: 'patient',
        branches: [
          { label: SECTION_LABELS[0], condition: { op: 'equals', value: 'appropriate_use_criteria_(sample)' }, nextNodeId: p('s0_presentation') },
          { label: SECTION_LABELS[1], condition: { op: 'equals', value: 'scope' }, nextNodeId: p('s1_age') },
          { label: SECTION_LABELS[2], condition: { op: 'equals', value: 'indication_variables' }, nextNodeId: p('s2_red_flags') },
          { label: SECTION_LABELS[3], condition: { op: 'equals', value: 'narrative_notes' }, nextNodeId: p('s3_presentation') },
        ],
      },

      // Section 1 — the real first decision: which presentation is this?
      {
        id: p('s0_presentation'),
        type: 'variable',
        variableKey: 'presentation_type',
        prompt: 'What kind of presentation is this?',
        dataSource: 'referral',
        branches: [
          { label: 'Non-traumatic knee pain', condition: { op: 'equals', value: 'knee' }, nextNodeId: p('s0_knee_mechanical') },
          { label: 'Non-traumatic hip pain', condition: { op: 'equals', value: 'hip' }, nextNodeId: hipTarget },
          { label: VERBOSE_SHOULDER, condition: { op: 'equals', value: 'shoulder' }, nextNodeId: shoulderTarget },
          { label: 'Acute traumatic injury', condition: { op: 'equals', value: 'trauma' }, nextNodeId: p('s0_excluded') },
        ],
      },
      {
        id: p('s0_knee_mechanical'),
        type: 'variable',
        variableKey: 'mechanical_symptoms_present',
        prompt: 'Does the knee lock, catch, or give way?',
        dataSource: 'patient',
        branches: [
          { label: 'Knee locks or catches', condition: { op: 'equals', value: true }, nextNodeId: p('s0_action_hip') },
          { label: 'No locking or catching', condition: { op: 'equals', value: false }, nextNodeId: p('s0_action_hip') },
          // House vocabulary in a stored label — must never reach a screen.
          { label: 'Imaging condition unclear', condition: { op: 'equals', value: 'unclear' }, nextNodeId: p('s0_action_hip') },
        ],
      },
      spec(p('s0_action_hip'), 'Orthopaedic evaluation'),
      spec(p('s0_action_shoulder'), 'Shoulder evaluation'),
      { id: p('s0_excluded'), type: 'escalation', reason: 'Outside the guideline — a person decides.' },

      // Section 2 — an age gate. Everything outside it already goes to a person.
      {
        id: p('s1_age'),
        type: 'variable',
        variableKey: 'patient_age',
        prompt: 'How old is the patient?',
        dataSource: 'referral',
        branches: [
          { label: 'Age 18–75', condition: { op: 'range', min: 18, max: 75 }, nextNodeId: p('s0_action_hip') },
          { label: 'Age < 18 or > 75', condition: { op: 'equals', value: 'out_of_range' }, nextNodeId: p('s1_excluded') },
        ],
      },
      { id: p('s1_excluded'), type: 'escalation', reason: 'Outside the age range this guideline covers.' },

      // Section 3 — a safety route, not a service line.
      {
        id: p('s2_red_flags'),
        type: 'variable',
        variableKey: 'red_flags_present',
        prompt: 'Any red-flag features?',
        dataSource: 'patient',
        branches: [
          { label: 'Red flags present', condition: { op: 'equals', value: true }, nextNodeId: p('s2_urgent') },
          { label: 'No red flags', condition: { op: 'equals', value: false }, nextNodeId: p('s0_action_hip') },
        ],
      },
      { id: p('s2_urgent'), type: 'escalation', reason: 'Red flags need urgent review.' },

      // Section 4 — the SAME decision again, worded differently.
      {
        id: p('s3_presentation'),
        type: 'variable',
        variableKey: 'presentation_type',
        prompt: 'Which presentation does this note describe?',
        dataSource: 'referral',
        branches: [
          { label: 'Knee pain without injury', condition: { op: 'equals', value: 'knee' }, nextNodeId: p('s0_action_hip') },
          { label: 'Hip pain without injury', condition: { op: 'equals', value: 'hip' }, nextNodeId: hipTarget },
          { label: 'Injury-related presentation', condition: { op: 'equals', value: 'trauma' }, nextNodeId: p('s0_excluded') },
        ],
      },
    ],
  }
}

function derive(base: TreeInput): ScopeQuestion[] {
  const input: FlowInput = { tree: TreeSchema.parse(base), roster: [], subspecialty: null, cases: [] }
  return deriveScopeQuestions(input)
}

const wide = () => derive(makeBase('365e38'))
const narrow = () => derive(makeBase('365e38', { narrow: true }))

/** Every string this question puts in front of a surgeon. */
function screenStrings(q: ScopeQuestion): string[] {
  const out = [q.question, q.guidelineLine, q.stakesLine]
  if (q.mode === 'confirm') out.push(q.covers)
  for (const g of q.groups) out.push(g.label, g.guidelineWording, ...g.examples)
  return out
}

const FORBIDDEN =
  /\b(node|endpoint|tree|delta|reconcile|gap sweep|threshold|variable|condition|mapping|band|publish|scope|branch|anchor)s?\b/i

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

const checks: Array<{ name: string; run: () => string | null }> = [
  {
    name: 'no document-section heading is ever offered as something the clinic treats',
    run: () => {
      const strings = [...wide(), ...narrow()].flatMap(screenStrings)
      for (const s of strings) {
        if (s.includes('**')) return `markdown section heading leaked: ${s}`
        for (const heading of SECTION_LABELS) {
          const bare = heading.replace(/\*\*/g, '')
          if (s.includes(bare)) return `section heading "${bare}" offered as a patient group: ${s}`
        }
      }
      if (strings.some((s) => /narrative note|indication variable|appropriate use criteria/i.test(s)))
        return 'a document heading reached a screen'
      return null
    },
  },
  {
    name: 'the real clinical decision under each section supplies the groups',
    run: () => {
      const [q] = wide()
      if (!q) return 'no question derived'
      if (q.mode !== 'choices') return `expected a checklist, got ${q.mode}`
      const labels = q.groups.map((g) => g.label)
      if (labels.length !== 3) return `expected 3 groups, got ${labels.length}: ${labels.join(' | ')}`
      if (!labels.includes('Non-traumatic knee pain')) return `knee group missing: ${labels.join(' | ')}`
      if (!labels.includes('Non-traumatic hip pain')) return `hip group missing: ${labels.join(' | ')}`
      if (q.question !== 'Which of these does your clinic handle?') return `question wrong: ${q.question}`
      if (q.guidelineLine !== 'The guideline covers three kinds of referral.')
        return `guideline line wrong: ${q.guidelineLine}`
      return null
    },
  },
  {
    name: 'the same decision under several sections collapses to one set of groups',
    run: () => {
      const [q] = wide()
      const ids = q.groups.map((g) => g.id)
      if (new Set(ids).size !== ids.length) return `duplicate groups: ${ids.join(' | ')}`
      // Section 4 words the same groups differently — neither wording may
      // appear a second time.
      const labels = q.groups.map((g) => g.label)
      if (labels.some((l) => /without injury/i.test(l)))
        return `the repeat of this decision produced its own rows: ${labels.join(' | ')}`
      return null
    },
  },
  {
    name: 'groups that already go to a person are dropped',
    run: () => {
      const [q] = wide()
      const strings = screenStrings(q)
      if (strings.some((s) => /traumatic injury|injury-related/i.test(s)))
        return 'an already-escalating group was offered'
      if (q.groups.some((g) => /^Acute traumatic/.test(g.label))) return 'escalating group offered as a row'
      return null
    },
  },
  {
    name: 'a safety route is never offered as a service line',
    run: () => {
      const strings = [...wide(), ...narrow()].flatMap(screenStrings)
      if (strings.some((s) => /red flag/i.test(s))) return 'red-flag routing was offered as something to opt out of'
      return null
    },
  },
  {
    name: 'a long guideline sentence is headlined, with its own wording kept for expand',
    run: () => {
      const [q] = wide()
      const shoulder = q.groups.find((g) => /shoulder/i.test(g.label))
      if (!shoulder) return 'shoulder group missing'
      if (shoulder.label.length >= VERBOSE_SHOULDER.length) return `label not headlined: ${shoulder.label}`
      if (shoulder.label.split(/\s+/).length > 11) return `headline too long: ${shoulder.label}`
      if (shoulder.guidelineWording !== VERBOSE_SHOULDER) return `full wording lost: ${shoulder.guidelineWording}`
      return null
    },
  },
  {
    name: 'expanding a group shows presentations from underneath, minus our vocabulary',
    run: () => {
      const [q] = wide()
      const knee = q.groups.find((g) => g.label === 'Non-traumatic knee pain')
      if (!knee) return 'knee group missing'
      if (knee.examples.length < 2 || knee.examples.length > 3)
        return `expected two or three examples, got ${knee.examples.length}`
      if (knee.examples.some((e) => /condition/i.test(e))) return `house vocabulary reached an example: ${knee.examples.join(' | ')}`
      if (q.groups.some((g) => !g.guidelineWording.trim())) return 'a group has blank guideline wording'
      return null
    },
  },
  {
    name: 'unchecking a group anchors to the branch semantically, never by id',
    run: () => {
      const [q] = wide()
      const knee = q.groups.find((g) => g.label === 'Non-traumatic knee pain')
      if (!knee) return 'knee group missing'
      const anchor = knee.anchor
      if (anchor.node.kind !== 'variable') return `expected a key anchor, got ${anchor.node.kind}`
      if (anchor.node.variableKey !== 'presentation_type') return `key not normalized: ${anchor.node.variableKey}`
      if (anchor.conditionFingerprint !== 'equals:string:knee') return `fingerprint wrong: ${anchor.conditionFingerprint}`
      if (anchor.label !== 'Non-traumatic knee pain') return `fallback label missing: ${anchor.label}`
      if (JSON.stringify(anchor).includes('doc_')) return 'a document id leaked into the anchor'
      return null
    },
  },
  {
    name: 'below two real choices we confirm the population instead of listing one',
    run: () => {
      const [q] = narrow()
      if (!q) return 'no question derived for the narrow guideline'
      if (q.mode !== 'confirm') return `expected a confirmation, got ${q.mode}`
      if (q.groups.length !== 0) return 'a confirmation screen must not render rows'
      if (q.covers !== 'non-traumatic knee pain in adults aged 18 to 75') return `subject wrong: ${q.covers}`
      if (
        q.question !==
        'This starting point only covers non-traumatic knee pain in adults aged 18 to 75. Is that right for your clinic?'
      )
        return `question wrong: ${q.question}`
      if (q.stakesLine !== "Nothing is turned away — it just doesn't get routed automatically.")
        return `stakes wrong: ${q.stakesLine}`
      return null
    },
  },
  {
    name: 'an age gate alone is a precondition, never a row to uncheck',
    run: () => {
      const [q] = wide()
      if (q.groups.some((g) => /^Age /.test(g.label))) return 'the age gate was offered as something to uncheck'
      return null
    },
  },
  {
    name: 'ids survive a guideline re-upload with fresh document ids',
    run: () => {
      const a = derive(makeBase('365e38'))
      const b = derive(makeBase('ffff01'))
      if (a[0].id !== b[0].id) return `checklist id moved: ${a[0].id} vs ${b[0].id}`
      const na = derive(makeBase('365e38', { narrow: true }))
      const nb = derive(makeBase('ffff01', { narrow: true }))
      if (na[0].id !== nb[0].id) return `confirmation id moved: ${na[0].id} vs ${nb[0].id}`
      if (!a[0].id.startsWith('scope:')) return `id prefix wrong: ${a[0].id}`
      if (a[0].id.includes('doc_')) return `document id leaked into the question id: ${a[0].id}`
      if (a[0].id === na[0].id) return 'two different screens share one id'
      return null
    },
  },
  {
    name: 'nothing a surgeon reads uses our vocabulary, and nothing is blank',
    run: () => {
      for (const q of [...wide(), ...narrow()]) {
        for (const s of screenStrings(q)) {
          if (!s.trim()) return 'a blank string reached a screen'
          if (FORBIDDEN.test(s)) return `house vocabulary on screen: ${s}`
        }
      }
      return null
    },
  },
  {
    name: 'a tree with nothing to ask about produces no question at all',
    run: () => {
      const base = makeBase('365e38') as TreeInput
      // Strip the two decisions that describe patients; only safety routing left.
      const kept = base.nodes.filter((n) => !/presentation|s1_age/.test(n.id))
      const stripped: TreeInput = {
        ...base,
        nodes: kept.map((n) =>
          n.id.endsWith('cpg_root') && n.type === 'variable'
            ? { ...n, branches: n.branches.filter((b) => /red_flags/.test(b.nextNodeId)) }
            : n,
        ),
      }
      const qs = derive(stripped)
      if (qs.length !== 0) return `expected no question, got ${qs.length}: ${qs[0]?.question}`
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
  throw new Error(`${failures} "what you treat" test(s) failed`)
}
console.log(`reconcile/questions/scope.test.ts — all ${checks.length} passed`)
