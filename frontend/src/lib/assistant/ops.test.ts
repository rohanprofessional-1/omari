/**
 * Blume — Builder assistant applier tests.
 *
 * The assistant's deterministic applier: bounded ops in, valid tree out,
 * all-or-nothing. These checks pin the behaviours the confirm gate relies
 * on — a proposal either becomes exactly the diff the clinician reviewed,
 * or nothing happens at all.
 *
 * Same self-asserting style as engine.test.ts: no framework, non-zero exit
 * code on failure. Run with `npm test`.
 */
import { TreeSchema, type Tree, type TreeInput } from '../../types/tree'
import { applyOps, describeMoves, TreeOpsSchema, type TreeOp } from './ops'
import { diffTrees } from './diff'

declare const process: { exitCode?: number } | undefined

const fixtureInput: TreeInput = {
  treeId: 'test_tree',
  rootNodeId: 'var_side',
  nodes: [
    {
      id: 'var_side',
      type: 'variable',
      variableKey: 'symptom_side',
      prompt: 'Which side is affected?',
      dataSource: 'patient',
      branches: [
        { label: 'Left', condition: { op: 'equals', value: 'left' }, nextNodeId: 'spec_chen' },
        { label: 'Right', condition: { op: 'equals', value: 'right' }, nextNodeId: 'spec_gooch' },
      ],
    },
    {
      id: 'spec_chen',
      type: 'specialist',
      specialistName: 'Dr. Chen',
      specialty: 'Peripheral nerve',
      urgency: 'routine',
      reasoningTemplate: 'Routing to Dr. Chen.',
      // Legacy v1 flat array — the applier must normalize it.
      workup: [{ name: 'EMG/NCS', protocol: '', rationale: 'Baseline conduction study' }],
    },
    {
      id: 'spec_gooch',
      type: 'specialist',
      specialistName: 'Dr. Gooch',
      specialty: 'Plexus',
      urgency: 'routine',
      reasoningTemplate: 'Routing to Dr. Gooch.',
      workup: [],
    },
  ],
}
const fixture: Tree = TreeSchema.parse(fixtureInput)

const ops = (raw: unknown[]): TreeOp[] => TreeOpsSchema.parse(raw)

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'adds a specialist and wires a new branch to it (alias resolution)',
    run: () => {
      const result = applyOps(
        fixture,
        ops([
          { op: 'add_specialist', id: 'new_1', specialistName: 'Dr. Li', specialty: 'Nerve tumor', urgency: 'expedited' },
          {
            op: 'add_branch',
            nodeId: 'var_side',
            branch: { label: 'Both', condition: { op: 'equals', value: 'both' }, nextNodeId: 'new_1' },
          },
        ]),
      )
      if (!result.ok) return `expected ok, got errors: ${result.errors.join('; ')}`
      if (result.addedIds.length !== 1) return `expected 1 added id, got ${result.addedIds.length}`
      const added = result.tree.nodes.find((n) => n.id === result.addedIds[0])
      if (added?.type !== 'specialist') return 'added node is not a specialist'
      const root = result.tree.nodes.find((n) => n.id === 'var_side')
      if (root?.type !== 'variable' || root.branches[2].nextNodeId !== result.addedIds[0])
        return 'new branch not wired to the added node'
      if (!TreeSchema.safeParse(result.tree).success) return 'result tree failed schema'
      return null
    },
  },
  {
    name: 'reroutes a branch located by label and reports it as a clinical diff',
    run: () => {
      const result = applyOps(
        fixture,
        ops([{ op: 'update_branch', nodeId: 'var_side', branchLabel: 'Left', nextNodeId: 'spec_gooch' }]),
      )
      if (!result.ok) return `expected ok, got errors: ${result.errors.join('; ')}`
      if (result.changedIds.join() !== 'var_side') return `changedIds: ${result.changedIds.join()}`
      const diff = diffTrees(fixture, result.tree)
      if (diff.length !== 1) return `expected 1 diff entry, got ${diff.length}`
      if (!diff[0].text.includes('Dr. Gooch') || !diff[0].text.includes('Dr. Chen'))
        return `diff misses old/new destination: ${diff[0].text}`
      return null
    },
  },
  {
    name: 'deletes a node and unwires buckets pointing at it',
    run: () => {
      const result = applyOps(fixture, ops([{ op: 'delete_node', nodeId: 'spec_chen' }]))
      if (!result.ok) return `expected ok, got errors: ${result.errors.join('; ')}`
      if (result.tree.nodes.length !== 2) return `expected 2 nodes, got ${result.tree.nodes.length}`
      const root = result.tree.nodes.find((n) => n.id === 'var_side')
      if (root?.type !== 'variable' || root.branches[0].nextNodeId !== '')
        return 'bucket pointing at the deleted node was not unwired'
      return null
    },
  },
  {
    name: 'edits workup: add, conditional, guard, remove',
    run: () => {
      const result = applyOps(
        fixture,
        ops([
          { op: 'add_workup_item', nodeId: 'spec_gooch', item: { name: 'MRI brachial plexus' } },
          {
            op: 'add_workup_conditional',
            nodeId: 'spec_chen',
            when: { op: 'equals', key: 'mass_present', value: true },
            item: { name: 'MRI with contrast' },
            reason: 'Mass characterization before the visit',
          },
          {
            op: 'add_workup_guard',
            nodeId: 'spec_chen',
            item: 'CT myelogram',
            requiredCondition: { op: 'equals', key: 'emg_status', value: 'inconclusive' },
          },
          { op: 'remove_workup_item', nodeId: 'spec_chen', name: 'emg/ncs' },
        ]),
      )
      if (!result.ok) return `expected ok, got errors: ${result.errors.join('; ')}`
      const chen = result.tree.nodes.find((n) => n.id === 'spec_chen')
      const gooch = result.tree.nodes.find((n) => n.id === 'spec_gooch')
      if (chen?.type !== 'specialist' || gooch?.type !== 'specialist') return 'specialists missing'
      if (chen.workup.always.length !== 0) return 'EMG/NCS not removed (case-insensitive match)'
      if (chen.workup.conditional[0]?.item.name !== 'MRI with contrast') return 'conditional not added'
      if (chen.workup.doNotOrderUnless[0]?.item !== 'CT myelogram') return 'guard not added'
      if (gooch.workup.always[0]?.name !== 'MRI brachial plexus') return 'always item not added'
      return null
    },
  },
  {
    name: 'rejects the WHOLE proposal when any op fails (all-or-nothing)',
    run: () => {
      const result = applyOps(
        fixture,
        ops([
          { op: 'update_specialist', nodeId: 'spec_chen', urgency: 'urgent' },
          { op: 'delete_node', nodeId: 'nonexistent_node' },
        ]),
      )
      if (result.ok) return 'expected failure'
      if (!result.errors[0]?.includes('nonexistent_node')) return `errors: ${result.errors.join('; ')}`
      // The valid first op must NOT have leaked into the returned tree.
      const chen = result.tree.nodes.find((n) => n.id === 'spec_chen')
      if (chen?.type !== 'specialist' || chen.urgency !== 'routine')
        return 'partial application leaked into the returned tree'
      return null
    },
  },
  {
    name: 'rejects wrong-type targeting and ambiguous branch labels',
    run: () => {
      const wrongType = applyOps(fixture, ops([{ op: 'update_variable', nodeId: 'spec_chen', prompt: 'x' }]))
      if (wrongType.ok) return 'update_variable on a specialist should fail'

      const twoLefts = TreeSchema.parse({
        ...fixtureInput,
        nodes: fixtureInput.nodes.map((n) =>
          n.id === 'var_side' && n.type === 'variable'
            ? { ...n, branches: [...n.branches, { label: 'Left arm', condition: { op: 'equals', value: 'l2' }, nextNodeId: '' }, { label: 'Left leg', condition: { op: 'equals', value: 'l3' }, nextNodeId: '' }] }
            : n,
        ),
      })
      // Exact match wins over prefix matches: "Left" is NOT ambiguous here.
      const exact = applyOps(twoLefts, ops([{ op: 'remove_branch', nodeId: 'var_side', branchLabel: 'Left' }]))
      if (!exact.ok) return `exact label match should win: ${exact.errors.join('; ')}`
      // But with the exact branch gone, "Left" prefix-matches two branches.
      const ambiguous = applyOps(exact.tree, ops([{ op: 'remove_branch', nodeId: 'var_side', branchLabel: 'Left' }]))
      if (ambiguous.ok) return 'prefix match over two branches should be ambiguous'
      if (!ambiguous.errors[0]?.includes('ambiguous')) return `errors: ${ambiguous.errors.join('; ')}`
      return null
    },
  },
  {
    name: 'regenerates colliding new-node ids instead of overwriting',
    run: () => {
      const result = applyOps(
        fixture,
        ops([
          { op: 'add_escalation', id: 'spec_chen', reason: 'No clean answer.' },
          { op: 'set_root', nodeId: 'spec_chen' },
        ]),
      )
      if (!result.ok) return `expected ok, got errors: ${result.errors.join('; ')}`
      // The add got a fresh id; later ops using "spec_chen" resolve to the NEW
      // node via the alias (the assistant meant the node it just created).
      if (result.addedIds[0] === 'spec_chen') return 'colliding id was not regenerated'
      if (result.tree.rootNodeId !== result.addedIds[0]) return 'alias did not resolve in set_root'
      if (result.tree.nodes.filter((n) => n.id === 'spec_chen').length !== 1)
        return 'existing node was overwritten'
      return null
    },
  },
  {
    name: 'never mutates the input tree',
    run: () => {
      const snapshot = JSON.stringify(fixture)
      applyOps(fixture, ops([{ op: 'update_specialist', nodeId: 'spec_chen', urgency: 'urgent' }]))
      if (JSON.stringify(fixture) !== snapshot) return 'input tree was mutated'
      return null
    },
  },
  {
    name: 'rejects malformed ops at the Zod boundary',
    run: () => {
      if (TreeOpsSchema.safeParse([{ op: 'drop_table' }]).success) return 'unknown op accepted'
      if (TreeOpsSchema.safeParse([{ op: 'add_variable' }]).success) return 'missing fields accepted'
      if (TreeOpsSchema.safeParse([]).success) return 'empty op list accepted'
      return null
    },
  },
  {
    name: 'move_nodes is layout-only: tree untouched, moves returned, describable',
    run: () => {
      const result = applyOps(
        fixture,
        ops([{ op: 'move_nodes', nodeIds: ['spec_chen', 'spec_gooch'], placement: 'bottom' }]),
      )
      if (!result.ok) return `expected ok, got errors: ${result.errors.join('; ')}`
      if (JSON.stringify(result.tree) !== JSON.stringify(fixture)) return 'move_nodes changed tree data'
      if (diffTrees(fixture, result.tree).length !== 0) return 'move_nodes produced a clinical diff'
      if (result.changedIds.length !== 0) return 'move_nodes reported changedIds'
      if (result.moves.length !== 1) return `expected 1 move, got ${result.moves.length}`
      if (result.moves[0].placement !== 'bottom') return 'placement lost'
      if (result.moves[0].nodeIds.join(',') !== 'spec_chen,spec_gooch') return 'moved ids lost'
      const [line] = describeMoves(fixture, result.moves)
      if (!line.includes('Dr. Chen') || !line.includes('bottom')) return `bad description: ${line}`
      return null
    },
  },
  {
    name: 'move_nodes rejects unknown ids (all-or-nothing) and resolves aliases',
    run: () => {
      const bad = applyOps(
        fixture,
        ops([{ op: 'move_nodes', nodeIds: ['spec_chen', 'ghost_node'], placement: 'left' }]),
      )
      if (bad.ok) return 'unknown node id accepted'
      if (bad.moves.length !== 0) return 'failed proposal leaked moves'
      const aliased = applyOps(
        fixture,
        ops([
          { op: 'add_escalation', id: 'new_1', reason: 'No clean answer.' },
          { op: 'move_nodes', nodeIds: ['new_1'], placement: 'bottom' },
        ]),
      )
      if (!aliased.ok) return `expected ok, got errors: ${aliased.errors.join('; ')}`
      if (aliased.moves[0]?.nodeIds[0] !== aliased.addedIds[0]) return 'placeholder id did not resolve in move'
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
  throw new Error(`${failures} assistant ops test(s) failed`)
}
console.log(`assistant/ops.test.ts — all ${checks.length} passed`)
