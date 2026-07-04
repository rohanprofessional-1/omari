/**
 * Blume — routing-impact + gap-detection tests (Sprout's deterministic
 * analysis layer). Same self-asserting style as engine.test.ts: no
 * framework, non-zero exit code on failure. Run with `npm test`.
 */
import { TreeSchema, type Tree, type TreeInput } from '../../types/tree'
import { diffRouting, enumerateRoutes } from './impact'
import { detectBuilderGaps } from './gaps'

declare const process: { exitCode?: number } | undefined

const baseInput: TreeInput = {
  treeId: 't',
  rootNodeId: 'var_side',
  nodes: [
    {
      id: 'var_side',
      type: 'variable',
      variableKey: 'symptom_side',
      prompt: 'Which side?',
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
      reasoningTemplate: 'r',
      workup: [{ name: 'EMG/NCS', protocol: '', rationale: '' }],
    },
    {
      id: 'spec_gooch',
      type: 'specialist',
      specialistName: 'Dr. Gooch',
      specialty: 'Plexus',
      urgency: 'routine',
      reasoningTemplate: 'r',
      workup: [],
    },
  ],
}
const base: Tree = TreeSchema.parse(baseInput)

const withPatch = (patch: (t: Tree) => void): Tree => {
  const copy: Tree = JSON.parse(JSON.stringify(base))
  patch(copy)
  return copy
}

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'impact: identical trees → no routing changes',
    run: () => {
      const impact = diffRouting(base, withPatch(() => {}))
      if (impact.changed.length || impact.added.length || impact.removed.length)
        return `expected clean impact, got ${JSON.stringify(impact)}`
      if (impact.totalAfter !== 2) return `expected 2 paths, got ${impact.totalAfter}`
      return null
    },
  },
  {
    name: 'impact: retargeted branch reports old and new destination',
    run: () => {
      const after = withPatch((t) => {
        const v = t.nodes.find((n) => n.id === 'var_side')
        if (v?.type === 'variable') v.branches[0].nextNodeId = 'spec_gooch'
      })
      const impact = diffRouting(base, after)
      if (impact.changed.length !== 1) return `expected 1 changed path, got ${impact.changed.length}`
      const c = impact.changed[0]
      if (!c.path.includes('Left')) return `wrong path: ${c.path}`
      if (!c.from.includes('Dr. Chen') || !c.to.includes('Dr. Gooch'))
        return `wrong destinations: ${c.from} → ${c.to}`
      return null
    },
  },
  {
    name: 'impact: new unwired bucket shows as a new path to nowhere',
    run: () => {
      const after = withPatch((t) => {
        const v = t.nodes.find((n) => n.id === 'var_side')
        if (v?.type === 'variable')
          v.branches.push({ label: 'Both', condition: { op: 'equals', value: 'both' }, nextNodeId: '' })
      })
      const impact = diffRouting(base, after)
      if (impact.added.length !== 1) return `expected 1 added path, got ${impact.added.length}`
      if (!impact.added[0].to.includes('unwired')) return `expected unwired dest, got ${impact.added[0].to}`
      return null
    },
  },
  {
    name: 'impact: cyclic wiring terminates',
    run: () => {
      const cyclic = withPatch((t) => {
        t.nodes.push({
          id: 'var_loop',
          type: 'variable',
          variableKey: 'loop',
          prompt: 'p',
          dataSource: 'patient',
          branches: [{ label: 'Back', condition: { op: 'equals', value: 'x' }, nextNodeId: 'var_side' }],
        })
        const v = t.nodes.find((n) => n.id === 'var_side')
        if (v?.type === 'variable')
          v.branches.push({ label: 'Loop', condition: { op: 'equals', value: 'l' }, nextNodeId: 'var_loop' })
      })
      const { paths } = enumerateRoutes(cyclic)
      if (paths.length === 0) return 'expected some paths'
      return null // reaching here at all proves termination
    },
  },
  {
    name: 'gaps: dangling bucket, unreachable node, and no-workup specialist all detected',
    run: () => {
      const holey = withPatch((t) => {
        const v = t.nodes.find((n) => n.id === 'var_side')
        if (v?.type === 'variable')
          v.branches.push({ label: 'Both', condition: { op: 'equals', value: 'both' }, nextNodeId: '' })
        t.nodes.push({
          id: 'spec_lost',
          type: 'specialist',
          specialistName: 'Dr. Lost',
          specialty: 'x',
          urgency: 'routine',
          reasoningTemplate: 'r',
          workup: { always: [], conditional: [], doNotOrderUnless: [] },
        })
      })
      const gaps = detectBuilderGaps(holey)
      const ids = gaps.map((g) => g.id)
      if (!ids.some((id) => id.startsWith('dangling-var_side'))) return `missing dangling gap: ${ids.join(', ')}`
      if (!ids.includes('unreachable-spec_lost')) return `missing unreachable gap: ${ids.join(', ')}`
      // Dr. Gooch is reachable with an empty workup → flagged; Dr. Lost is
      // unreachable so it must NOT also get a workup gap.
      if (!ids.includes('no-workup-spec_gooch')) return `missing no-workup gap: ${ids.join(', ')}`
      if (ids.includes('no-workup-spec_lost')) return 'unreachable specialist should not get a workup gap'
      // Every gap must carry node ids to highlight and a question to ask.
      for (const g of gaps) if (g.nodeIds.length === 0 || !g.question) return `malformed gap ${g.id}`
      return null
    },
  },
  {
    name: 'gaps: a structurally clean tree with workups yields none',
    run: () => {
      const clean = withPatch((t) => {
        const gooch = t.nodes.find((n) => n.id === 'spec_gooch')
        if (gooch?.type === 'specialist')
          gooch.workup.always.push({ name: 'MRI', protocol: '', rationale: '' })
      })
      const gaps = detectBuilderGaps(clean)
      if (gaps.length !== 0) return `expected none, got: ${gaps.map((g) => g.id).join(', ')}`
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
  throw new Error(`${failures} impact/gap test(s) failed`)
}
console.log(`assistant/impact.test.ts — all ${checks.length} passed`)
