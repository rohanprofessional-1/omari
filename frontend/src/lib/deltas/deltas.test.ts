/**
 * Blume — delta compiler tests.
 *
 * The invariants the whole rework rests on:
 *   1. Each delta op produces exactly the expected tree change.
 *   2. An empty delta list compiles to the base unchanged (identity).
 *   3. The same deltas replayed against a REGENERATED base (same CPG,
 *      fresh doc id prefixes) apply cleanly — zero stale — and yield the
 *      same clinical semantics.
 *   4. A base that changed underneath a delta surfaces the right stale_*
 *      verdict; no delta is ever silently dropped or misapplied.
 *   5. compile is deterministic: same inputs, byte-identical output.
 *
 * Same self-asserting style as ops.test.ts: no framework, run via `npm test`.
 */
import { TreeSchema, type Tree, type TreeInput } from '../../types/tree'
import { compile, type BaseTreeInput } from './compile'
import { describeDeltas } from './describe'
import { detectThresholdCandidates } from './detectAmbiguous'
import { clinicalBasisHash, conditionFingerprint } from './resolve'
import { DeltaSchema, type Delta, type DeltaOp } from './schema'

declare const process: { exitCode?: number } | undefined

/* -------------------------------------------------------------------------- */
/* Fixtures: a CPG-style scaffold, and its regeneration (fresh ids)           */
/* -------------------------------------------------------------------------- */

const SURVEILLANCE_BASIS = 'Recommendation 1: PSA below 4 ng/mL warrants active surveillance.'
const IMAGING_BASIS = 'Recommendation 2: persistent symptoms warrant MRI before referral.'

/** Build the same clinical scaffold under a given doc namespace. `variant`
 *  shuffles node order and placeholder ids to prove anchors are id-free. */
function makeBase(docId: string, variant = false): BaseTreeInput {
  const p = (s: string) => `doc_${docId}_${s}`
  const ph1 = variant ? 'ph_urology' : 'placeholder_1'
  const emptyWorkup = { always: [], conditional: [], doNotOrderUnless: [] }
  const nodes = [
    {
      id: p('cpg_root'),
      type: 'variable',
      variableKey: p('cpg_section'),
      prompt: 'Which section applies?',
      dataSource: 'patient',
      branches: [
        { label: 'Recommendation 1', condition: { op: 'equals', value: 'recommendation_1' }, nextNodeId: p('s0_psa') },
        { label: 'Recommendation 2', condition: { op: 'equals', value: 'recommendation_2' }, nextNodeId: p('s1_duration') },
      ],
    },
    {
      id: p('s0_psa'),
      type: 'variable',
      variableKey: 'psa_level',
      prompt: 'What is the PSA level?',
      dataSource: 'record',
      branches: [
        { label: 'PSA normal', condition: { op: 'range', max: 4 }, nextNodeId: p('s0_surveillance') },
        { label: 'PSA elevated', condition: { op: 'equals', value: 'elevated' }, nextNodeId: ph1 },
      ],
    },
    {
      id: p('s0_surveillance'),
      type: 'specialist',
      specialistName: 'Active surveillance',
      specialty: 'Urology',
      urgency: 'routine',
      reasoningTemplate: 'Surveillance per guideline.',
      workup: emptyWorkup,
      clinicalBasis: SURVEILLANCE_BASIS,
    },
    {
      id: ph1,
      type: 'specialist',
      specialistName: '[Assign specialist — Action Urology Referral]',
      specialty: 'Action Urology Referral',
      urgency: 'routine',
      reasoningTemplate: '',
      workup: emptyWorkup,
    },
    {
      id: p('s1_duration'),
      type: 'variable',
      variableKey: 'symptom_duration_months',
      prompt: 'How long have symptoms persisted (months)?',
      dataSource: 'patient',
      branches: [
        { label: 'Under 3 months', condition: { op: 'range', max: 3 }, nextNodeId: p('s1_imaging') },
        { label: '3 or more months', condition: { op: 'range', min: 3 }, nextNodeId: p('s1_imaging') },
      ],
    },
    {
      id: p('s1_imaging'),
      type: 'specialist',
      specialistName: 'MRI then referral',
      specialty: 'Radiology',
      urgency: 'routine',
      reasoningTemplate: 'Imaging first per guideline.',
      workup: {
        always: [{ name: 'MRI pelvis', protocol: 'without contrast', rationale: 'Guideline-directed imaging' }],
        conditional: [],
        doNotOrderUnless: [],
      },
      clinicalBasis: IMAGING_BASIS,
    },
  ]
  if (variant) nodes.reverse() // node order must not matter to anchors
  return { rootNodeId: p('cpg_root'), nodes }
}

const base = makeBase('aaa111')
const regenerated = makeBase('beef22', true)

let seq = 0
function delta(id: string, payload: DeltaOp, extra: Partial<Delta> = {}): Delta {
  return DeltaSchema.parse({ id, seq: seq++, payload, provenance: {}, ...extra })
}

const urologyAnchor = { kind: 'terminal', specialistName: '[Assign specialist — Action Urology Referral]' } as const
const surveillanceAnchor = { kind: 'terminal', clinicalBasisHash: clinicalBasisHash(SURVEILLANCE_BASIS) } as const
const imagingAnchor = { kind: 'terminal', clinicalBasisHash: clinicalBasisHash(IMAGING_BASIS) } as const
const elevatedBranchAnchor = {
  node: { kind: 'variable', variableKey: 'psa_level' } as const,
  conditionFingerprint: conditionFingerprint({ op: 'equals', value: 'elevated' }),
  label: 'PSA elevated',
}

/** The full clinic session: one of each op family. Later deltas anchor
 *  against the compiled-so-far tree (the state their author saw): urgency
 *  is set on the BOUND name, and the reword targets a band the split made. */
function sessionDeltas(): Delta[] {
  seq = 0
  return [
    delta('bind1', { op: 'bind_terminal', anchors: [urologyAnchor], target: { kind: 'specialist', specialistName: 'Dr. Osei', specialty: 'Urology' } }),
    delta('urg1', { op: 'set_urgency', anchors: [{ kind: 'terminal', specialistName: 'Dr. Osei' }], urgency: 'expedited' }),
    delta('thr1', {
      op: 'set_threshold',
      branch: elevatedBranchAnchor,
      mode: 'split',
      answerTypeChange: 'string_to_number',
      split: [
        { label: 'PSA 4-10', condition: { op: 'range', min: 4, max: 10 }, target: 'same' },
        { label: 'PSA over 10', condition: { op: 'range', min: 10 }, target: 'sibling', siblingTarget: imagingAnchor },
      ],
    }),
    delta('wk1', { op: 'add_workup', anchor: surveillanceAnchor, item: { name: 'Repeat PSA' } }),
    delta('wk2', {
      op: 'add_workup',
      anchor: imagingAnchor,
      item: { name: 'Renal function panel' },
      when: { op: 'range', min: 3, key: 'symptom_duration_months' },
      reason: 'Contrast decision needs eGFR',
    }),
    delta('wk3', { op: 'remove_workup', anchor: imagingAnchor, itemName: 'MRI pelvis', guardInstead: { op: 'range', min: 3, key: 'symptom_duration_months' } }),
    delta('sup1', {
      op: 'suppress_branch',
      branch: {
        node: { kind: 'variable', variableKey: 'symptom_duration_months' },
        conditionFingerprint: conditionFingerprint({ op: 'range', max: 3 }),
        label: 'Under 3 months',
      },
      reason: 'Clinic only accepts established cases',
    }, { provenance: { author: '', rationale: 'We require 3 months of symptoms first', deviatesFromCpg: true, cpgBasis: IMAGING_BASIS } }),
    delta('rw1', {
      op: 'reword',
      branch: {
        node: { kind: 'variable', variableKey: 'psa_level' },
        conditionFingerprint: conditionFingerprint({ op: 'range', min: 4, max: 10 }),
        label: 'PSA 4-10',
      },
      patientLabel: 'Your PSA result was mildly elevated',
    }),
  ]
}

/** Id-free clinical snapshot for cross-regeneration comparison. */
function semanticSnapshot(tree: Tree): string {
  const nameOf = (id: string): string => {
    const n = tree.nodes.find((x) => x.id === id)
    if (!n) return '<dangling>'
    if (n.type === 'variable') return `var:${n.variableKey.replace(/^doc_[0-9a-f]+_/, '')}`
    if (n.type === 'specialist') return `spec:${n.specialistName}`
    return `esc:${n.reason}`
  }
  const parts = tree.nodes
    .map((n) => {
      if (n.type === 'variable') {
        const key = n.variableKey.replace(/^doc_[0-9a-f]+_/, '')
        return `V ${key} :: ${n.branches.map((b) => `${b.label}|${conditionFingerprint(b.condition)}|${b.patientLabel ?? ''}->${nameOf(b.nextNodeId)}`).join(' ; ')}`
      }
      if (n.type === 'specialist') {
        return `S ${n.specialistName}|${n.urgency}|always:${n.workup.always.map((w) => w.name).join(',')}|cond:${n.workup.conditional.map((c) => c.item.name).join(',')}|guard:${n.workup.doNotOrderUnless.map((g) => g.item).join(',')}`
      }
      return `E ${n.reason}`
    })
    .sort()
  return parts.join('\n')
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'empty delta list compiles to the base unchanged (identity)',
    run: () => {
      const { tree, results } = compile(base, [])
      const parsedBase = TreeSchema.parse({ ...base, treeId: 'base' } as TreeInput)
      if (JSON.stringify(tree) !== JSON.stringify(parsedBase)) return 'compiled tree differs from parsed base'
      if (results.length !== 0) return 'results should be empty'
      return null
    },
  },
  {
    name: 'bind_terminal renames the placeholder and fills its reasoning',
    run: () => {
      seq = 0
      const d = delta('b', { op: 'bind_terminal', anchors: [urologyAnchor], target: { kind: 'specialist', specialistName: 'Dr. Osei', specialty: 'Urology' } })
      const { tree, results } = compile(base, [d])
      if (results[0].status !== 'applied') return `expected applied, got ${results[0].status}: ${results[0].reason}`
      const bound = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName === 'Dr. Osei')
      if (!bound || bound.type !== 'specialist') return 'bound specialist not found'
      if (bound.reasoningTemplate !== 'Routing to Dr. Osei.') return `reasoning not filled: "${bound.reasoningTemplate}"`
      if (tree.nodes.some((n) => n.type === 'specialist' && n.specialistName.startsWith('[Assign'))) return 'placeholder still present'
      return null
    },
  },
  {
    name: 'bind_terminal to escalation replaces the node and rewires inbound branches',
    run: () => {
      seq = 0
      const d = delta('b', { op: 'bind_terminal', anchors: [urologyAnchor], target: { kind: 'escalation', reason: 'No urologist on staff' } })
      const { tree, results } = compile(base, [d])
      if (results[0].status !== 'applied') return `expected applied, got ${results[0].status}: ${results[0].reason}`
      const esc = tree.nodes.find((n) => n.type === 'escalation' && n.reason === 'No urologist on staff')
      if (!esc) return 'escalation node missing'
      const psa = tree.nodes.find((n) => n.type === 'variable' && n.variableKey === 'psa_level')
      if (psa?.type !== 'variable') return 'psa node missing'
      if (psa.branches[1].nextNodeId !== esc.id) return 'inbound branch not rewired to escalation'
      if (tree.nodes.some((n) => n.type === 'specialist' && n.specialistName.startsWith('[Assign'))) return 'old terminal not removed'
      return null
    },
  },
  {
    name: 'set_threshold split lands at the original index, preserves dest, resolves siblings',
    run: () => {
      seq = 0
      const d = delta('t', {
        op: 'set_threshold',
        branch: elevatedBranchAnchor,
        mode: 'split',
        split: [
          { label: 'PSA 4-10', condition: { op: 'range', min: 4, max: 10 }, target: 'same' },
          { label: 'PSA over 10', condition: { op: 'range', min: 10 }, target: 'sibling', siblingTarget: imagingAnchor },
        ],
      })
      const { tree, results } = compile(base, [d])
      if (results[0].status !== 'applied') return `expected applied, got ${results[0].status}: ${results[0].reason}`
      const psa = tree.nodes.find((n) => n.type === 'variable' && n.variableKey === 'psa_level')
      if (psa?.type !== 'variable') return 'psa node missing'
      const labels = psa.branches.map((b) => b.label)
      if (labels.join(',') !== 'PSA normal,PSA 4-10,PSA over 10') return `wrong branch order: ${labels.join(',')}`
      const placeholder = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName.startsWith('[Assign'))
      if (psa.branches[1].nextNodeId !== placeholder?.id) return "'same' band lost the original destination"
      const imaging = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName === 'MRI then referral')
      if (psa.branches[2].nextNodeId !== imaging?.id) return 'sibling band did not resolve to the imaging terminal'
      return null
    },
  },
  {
    name: 'workup ops: always add, conditional add, guard-instead-of-remove',
    run: () => {
      seq = 0
      const ds = [
        delta('a', { op: 'add_workup', anchor: surveillanceAnchor, item: { name: 'Repeat PSA' } }),
        delta('b', { op: 'add_workup', anchor: imagingAnchor, item: { name: 'Renal function panel' }, when: { op: 'range', min: 3, key: 'symptom_duration_months' } }),
        delta('c', { op: 'remove_workup', anchor: imagingAnchor, itemName: 'MRI pelvis', guardInstead: { op: 'range', min: 3, key: 'symptom_duration_months' } }),
      ]
      const { tree, results } = compile(base, ds)
      const bad = results.find((r) => r.status !== 'applied')
      if (bad) return `delta ${bad.deltaId}: ${bad.status} ${bad.reason ?? ''}`
      const surv = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName === 'Active surveillance')
      if (surv?.type !== 'specialist' || !surv.workup.always.some((w) => w.name === 'Repeat PSA')) return 'always item missing'
      const imaging = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName === 'MRI then referral')
      if (imaging?.type !== 'specialist') return 'imaging node missing'
      if (!imaging.workup.conditional.some((c) => c.item.name === 'Renal function panel')) return 'conditional item missing'
      if (!imaging.workup.doNotOrderUnless.some((g) => g.item === 'MRI pelvis')) return 'guard missing'
      if (!imaging.workup.always.some((w) => w.name === 'MRI pelvis')) return 'guardInstead must keep the item (guard withholds at runtime)'
      return null
    },
  },
  {
    name: 'suppress_branch retargets to an escalation without deleting the branch',
    run: () => {
      seq = 0
      const d = delta('s', {
        op: 'suppress_branch',
        branch: {
          node: { kind: 'variable', variableKey: 'symptom_duration_months' },
          conditionFingerprint: conditionFingerprint({ op: 'range', max: 3 }),
          label: 'Under 3 months',
        },
        reason: 'Clinic only accepts established cases',
      })
      const { tree, results } = compile(base, [d])
      if (results[0].status !== 'applied') return `expected applied, got ${results[0].status}: ${results[0].reason}`
      const dur = tree.nodes.find((n) => n.type === 'variable' && n.variableKey === 'symptom_duration_months')
      if (dur?.type !== 'variable') return 'duration node missing'
      if (dur.branches.length !== 2) return 'branch was deleted — must be retargeted only'
      const esc = tree.nodes.find((n) => n.id === dur.branches[0].nextNodeId)
      if (esc?.type !== 'escalation' || !esc.reason.includes('established cases')) return 'branch not retargeted to reasoned escalation'
      return null
    },
  },
  {
    name: 'add_rule gates an edge: continue keeps original dest, escalate makes a new node',
    run: () => {
      seq = 0
      const d = delta('r', {
        op: 'add_rule',
        insertAt: elevatedBranchAnchor,
        variableKey: 'prior_prostate_surgery',
        prompt: 'Has the patient had prior prostate surgery?',
        dataSource: 'referral',
        branches: [
          { label: 'No', condition: { op: 'equals', value: false }, target: 'continue' },
          { label: 'Yes', condition: { op: 'equals', value: true }, target: 'escalate', escalationReason: 'Post-surgical cases need chart review' },
        ],
      })
      const { tree, results } = compile(base, [d])
      if (results[0].status !== 'applied') return `expected applied, got ${results[0].status}: ${results[0].reason}`
      const psa = tree.nodes.find((n) => n.type === 'variable' && n.variableKey === 'psa_level')
      if (psa?.type !== 'variable') return 'psa node missing'
      const gate = tree.nodes.find((n) => n.id === psa.branches[1].nextNodeId)
      if (gate?.type !== 'variable' || gate.variableKey !== 'prior_prostate_surgery') return 'gate not inserted on the edge'
      const placeholder = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName.startsWith('[Assign'))
      if (gate.branches[0].nextNodeId !== placeholder?.id) return "continue branch lost the edge's original destination"
      const esc = tree.nodes.find((n) => n.id === gate.branches[1].nextNodeId)
      if (esc?.type !== 'escalation' || !esc.reason.includes('chart review')) return 'escalate branch missing its escalation'
      return null
    },
  },
  {
    name: 'retarget_branch points a branch at an existing node, and shares the dest slot with suppress',
    run: () => {
      seq = 0
      const durationBranch = {
        node: { kind: 'variable', variableKey: 'symptom_duration_months' } as const,
        conditionFingerprint: conditionFingerprint({ op: 'range', max: 3 }),
        label: 'Under 3 months',
      }
      const ds = [
        delta('sup', { op: 'suppress_branch', branch: durationBranch, reason: 'Not seen here' }),
        delta('ret', { op: 'retarget_branch', branch: durationBranch, target: { kind: 'node', anchor: surveillanceAnchor } }),
      ]
      const { tree, results } = compile(base, ds)
      const by = Object.fromEntries(results.map((r) => [r.deltaId, r.status]))
      if (by.sup !== 'superseded') return `suppress: expected superseded by retarget, got ${by.sup}`
      if (by.ret !== 'applied') return `retarget: expected applied, got ${by.ret}`
      const dur = tree.nodes.find((n) => n.type === 'variable' && n.variableKey === 'symptom_duration_months')
      if (dur?.type !== 'variable') return 'duration node missing'
      const surv = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName === 'Active surveillance')
      if (dur.branches[0].nextNodeId !== surv?.id) return 'branch not retargeted to the anchored node'
      if (tree.nodes.some((n) => n.type === 'escalation' && n.reason === 'Not seen here')) {
        return 'superseded suppress still created its escalation'
      }

      const toEsc = compile(base, [
        delta('e', { op: 'retarget_branch', branch: durationBranch, target: { kind: 'escalation', reason: 'Needs review first' } }),
      ])
      const dur2 = toEsc.tree.nodes.find((n) => n.type === 'variable' && n.variableKey === 'symptom_duration_months')
      if (dur2?.type !== 'variable') return 'duration node missing (esc case)'
      const esc = toEsc.tree.nodes.find((n) => n.id === dur2.branches[0].nextNodeId)
      if (esc?.type !== 'escalation' || esc.reason !== 'Needs review first') return 'escalation retarget failed'
      return null
    },
  },
  {
    name: 'reorder_priority applies the anchored permutation',
    run: () => {
      seq = 0
      const d = delta('o', {
        op: 'reorder_priority',
        node: { kind: 'variable', variableKey: 'psa_level' },
        order: [
          { node: { kind: 'variable', variableKey: 'psa_level' }, conditionFingerprint: conditionFingerprint({ op: 'equals', value: 'elevated' }), label: 'PSA elevated' },
          { node: { kind: 'variable', variableKey: 'psa_level' }, conditionFingerprint: conditionFingerprint({ op: 'range', max: 4 }), label: 'PSA normal' },
        ],
      })
      const { tree, results } = compile(base, [d])
      if (results[0].status !== 'applied') return `expected applied, got ${results[0].status}: ${results[0].reason}`
      const psa = tree.nodes.find((n) => n.type === 'variable' && n.variableKey === 'psa_level')
      if (psa?.type !== 'variable') return 'psa node missing'
      if (psa.branches.map((b) => b.label).join(',') !== 'PSA elevated,PSA normal') return 'order not applied'
      return null
    },
  },
  {
    name: 'REPLAY: full session against a regenerated base — zero stale, same semantics',
    run: () => {
      const first = compile(base, sessionDeltas())
      const replay = compile(regenerated, sessionDeltas())
      const notApplied = [...first.results, ...replay.results].filter((r) => r.status !== 'applied')
      if (notApplied.length > 0) {
        return notApplied.map((r) => `${r.deltaId}: ${r.status} ${r.reason ?? ''}`).join(' | ')
      }
      const a = semanticSnapshot(first.tree)
      const b = semanticSnapshot(replay.tree)
      if (a !== b) return `semantics diverged:\n--- original ---\n${a}\n--- replay ---\n${b}`
      return null
    },
  },
  {
    name: 'STALE: changed / removed / duplicated anchors get the right verdicts, none dropped',
    run: () => {
      // The next CPG revision quantified 'elevated' itself and dropped the
      // surveillance pathway; someone also grafted a second psa_level.
      const mutated = makeBase('cafe33') as BaseTreeInput & { nodes: any[] }
      const psa = mutated.nodes.find((n: any) => n.variableKey === 'psa_level')
      psa.branches[1].condition = { op: 'range', min: 6 } // label kept, condition changed
      mutated.nodes = mutated.nodes.filter((n: any) => n.specialistName !== 'Active surveillance')
      psa.branches[0].nextNodeId = psa.branches[1].nextNodeId
      mutated.nodes.push({
        id: 'dup_psa',
        type: 'variable',
        variableKey: 'psa_level',
        prompt: 'Duplicate',
        dataSource: 'record',
        branches: [{ label: 'x', condition: { op: 'equals', value: 'x' }, nextNodeId: psa.branches[0].nextNodeId }],
      })

      seq = 0
      const ds = [
        // label matches, fingerprint doesn't → the guideline moved → conflict
        delta('conflict', { op: 'set_threshold', branch: { ...elevatedBranchAnchor, node: { kind: 'pinned', nodeId: psa.id, baseHash: '' } }, mode: 'replace', replacement: { op: 'range', min: 4 } }),
        // surveillance terminal is gone → unresolved
        delta('gone', { op: 'add_workup', anchor: surveillanceAnchor, item: { name: 'Repeat PSA' } }),
        // two psa_level variables → ambiguous
        delta('dup', { op: 'reword', node: { kind: 'variable', variableKey: 'psa_level' }, prompt: 'New wording' }),
        // still fine → applied
        delta('ok', { op: 'set_urgency', anchors: [urologyAnchor], urgency: 'urgent' }),
      ]
      const { results } = compile(mutated, ds)
      if (results.length !== ds.length) return `expected ${ds.length} results, got ${results.length} — a delta was dropped`
      const by = Object.fromEntries(results.map((r) => [r.deltaId, r.status]))
      if (by.conflict !== 'stale_conflict') return `conflict: expected stale_conflict, got ${by.conflict}`
      if (by.gone !== 'stale_unresolved') return `gone: expected stale_unresolved, got ${by.gone}`
      if (by.dup !== 'stale_ambiguous') return `dup: expected stale_ambiguous, got ${by.dup}`
      if (by.ok !== 'applied') return `ok: expected applied, got ${by.ok}`
      return null
    },
  },
  {
    name: 'determinism: same inputs compile byte-identical',
    run: () => {
      const a = compile(base, sessionDeltas())
      const b = compile(base, sessionDeltas())
      if (JSON.stringify(a.tree) !== JSON.stringify(b.tree)) return 'trees differ across identical compiles'
      if (JSON.stringify(a.results) !== JSON.stringify(b.results)) return 'results differ across identical compiles'
      return null
    },
  },
  {
    name: 'supersession: later writer on the same slot retires the earlier delta',
    run: () => {
      seq = 0
      const ds = [
        delta('old', { op: 'set_urgency', anchors: [urologyAnchor], urgency: 'expedited' }),
        delta('new', { op: 'set_urgency', anchors: [urologyAnchor], urgency: 'urgent' }),
      ]
      const { tree, results } = compile(base, ds)
      const by = Object.fromEntries(results.map((r) => [r.deltaId, r.status]))
      if (by.old !== 'superseded') return `old: expected superseded, got ${by.old}`
      if (by.new !== 'applied') return `new: expected applied, got ${by.new}`
      const ph = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName.startsWith('[Assign'))
      if (ph?.type !== 'specialist' || ph.urgency !== 'urgent') return 'later urgency not applied'
      return null
    },
  },
  {
    name: 'dismissed deltas are reported, never applied',
    run: () => {
      seq = 0
      const d = delta('d', { op: 'set_urgency', anchors: [urologyAnchor], urgency: 'urgent' }, { status: 'dismissed' })
      const { tree, results } = compile(base, [d])
      if (results[0].status !== 'dismissed') return `expected dismissed, got ${results[0].status}`
      const ph = tree.nodes.find((n) => n.type === 'specialist' && n.specialistName.startsWith('[Assign'))
      if (ph?.type !== 'specialist' || ph.urgency !== 'routine') return 'dismissed delta was applied'
      return null
    },
  },
  {
    name: 'describeDeltas renders every op, flagging CPG deviations',
    run: () => {
      const lines = describeDeltas(sessionDeltas())
      if (lines.length !== sessionDeltas().length) return 'line count mismatch'
      if (!lines[0].includes('Dr. Osei')) return `bind line wrong: ${lines[0]}`
      const deviation = lines.find((l) => l.includes('DEVIATES FROM CPG'))
      if (!deviation || !deviation.includes('3 months of symptoms')) return 'deviation register line missing rationale'
      return null
    },
  },
  {
    name: 'detectThresholdCandidates finds vague equals + ranges, skips synthetic roots',
    run: () => {
      const parsedBase = TreeSchema.parse({ ...base, treeId: 'b' } as TreeInput)
      const candidates = detectThresholdCandidates(parsedBase)
      const kinds = candidates.map((c) => `${c.variableKey}:${c.branchLabel}:${c.kind}`).sort()
      if (!kinds.some((k) => k === 'psa_level:PSA elevated:ambiguous_equals')) return `vague equals missed: ${kinds.join(' | ')}`
      if (!kinds.some((k) => k.startsWith('psa_level:PSA normal:range'))) return 'range condition missed'
      if (candidates.some((c) => c.variableKey.endsWith('cpg_section'))) return 'synthetic root not skipped'
      const withBasis = candidates.find((c) => c.branchLabel === 'PSA normal')
      if (withBasis?.clinicalBasis !== SURVEILLANCE_BASIS) return 'clinicalBasis excerpt not attached'
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
  throw new Error(`${failures} delta compiler test(s) failed`)
}
console.log(`deltas/deltas.test.ts — all ${checks.length} passed`)
