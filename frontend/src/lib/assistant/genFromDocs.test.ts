/**
 * Blume — Sprout document-to-tree generator tests. Same self-asserting style
 * as impact.test.ts: no framework, non-zero exit code on failure. Run with
 * `npm test`.
 *
 * The backend calls are injected (GenerateFromDocsDeps), so these tests pin the
 * ORCHESTRATION Sprout owns — input validation, per-file sequencing, tree
 * naming, base-meta assembly, and the final session patch — without a live
 * server or an LLM. The extraction itself is the backend's contract, tested
 * there; here we prove Sprout drives it correctly and never half-applies.
 */
import type { Tree } from '../../types/tree'
import {
  generateTreeFromDocuments,
  type GenerateFromDocsDeps,
  type GenProgress,
} from './genFromDocs'

declare const process: { exitCode?: number } | undefined

/* ── Test doubles ─────────────────────────────────────────────────────────── */

/** A throwaway File — jsdom-free, just needs a name for the naming rule. */
function fakeFile(name: string, size = 100): File {
  // Node's global File (18+) works; fall back to a shaped object otherwise.
  try {
    return new File([new Uint8Array(size)], name)
  } catch {
    return { name, size } as unknown as File
  }
}

/** A minimal-but-valid-enough tree for the pipeline (no schema parse here). */
function stubTree(rootId: string): Tree {
  return {
    treeId: 't_stub',
    rootNodeId: rootId,
    nodes: [
      {
        id: rootId,
        type: 'specialist',
        specialistName: 'Dr. Stub',
        specialty: 'x',
        urgency: 'routine',
        reasoningTemplate: 'r',
        workup: { always: [], conditional: [], doNotOrderUnless: [] },
      },
    ],
  } as unknown as Tree
}

interface Recorder {
  sessionInputs: unknown[]
  scaffoldCalls: { sessionId: string; fileName: string }[]
  createTreeCalls: { name: string; opts: any }[]
  patchCalls: { id: string; patch: any }[]
}

/** Build a deps stub that records every call and returns canned results. */
function makeDeps(opts?: {
  scaffold?: (sessionId: string, file: File, idx: number) => any
  createTreeId?: string
}): { deps: GenerateFromDocsDeps; rec: Recorder } {
  const rec: Recorder = { sessionInputs: [], scaffoldCalls: [], createTreeCalls: [], patchCalls: [] }
  let scaffoldIdx = 0
  const deps: GenerateFromDocsDeps = {
    createGenSession: async (input) => {
      rec.sessionInputs.push(input)
      return { id: 'sess_1', subspecialty: input.subspecialty, stage: 'init', status: 'active', roster: [] } as any
    },
    generateCPGScaffold: async (sessionId, file) => {
      rec.scaffoldCalls.push({ sessionId, fileName: file.name })
      const custom = opts?.scaffold?.(sessionId, file, scaffoldIdx++)
      if (custom) return custom
      return {
        tree: stubTree(`root_${file.name}`),
        placeholderCount: 2,
        validationIssues: [{ kind: 'dead_end' }],
        baseMeta: { docId: `doc_${file.name}`, documentName: file.name },
      }
    },
    createTreeFull: async (name, _tree, opts2) => {
      rec.createTreeCalls.push({ name, opts: opts2 })
      return { id: opts?.createTreeId ?? 'tree_1', name } as any
    },
    patchGenSession: async (id, patch) => {
      rec.patchCalls.push({ id, patch })
      return { id, subspecialty: 's', stage: patch.stage ?? '', status: patch.status ?? '', roster: [] } as any
    },
  }
  return { deps, rec }
}

/* ── Checks ───────────────────────────────────────────────────────────────── */

interface Check {
  name: string
  run: () => Promise<string | null> | (string | null)
}

async function expectThrows(fn: () => Promise<unknown>, needle: string): Promise<string | null> {
  try {
    await fn()
    return `expected a throw containing "${needle}", but it resolved`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return msg.includes(needle) ? null : `wrong error: ${msg}`
  }
}

const checks: Check[] = [
  {
    name: 'validation: empty subspecialty is refused before any API call',
    run: async () => {
      const { deps, rec } = makeDeps()
      const err = await expectThrows(
        () => generateTreeFromDocuments({ files: [fakeFile('a.pdf')], subspecialty: '   ' }, undefined, deps),
        'subspecialty',
      )
      if (err) return err
      if (rec.sessionInputs.length !== 0) return 'created a session despite invalid input'
      return null
    },
  },
  {
    name: 'validation: no files is refused before any API call',
    run: async () => {
      const { deps, rec } = makeDeps()
      const err = await expectThrows(
        () => generateTreeFromDocuments({ files: [], subspecialty: 'Hand' }, undefined, deps),
        'at least one',
      )
      if (err) return err
      if (rec.scaffoldCalls.length !== 0) return 'called scaffold despite no files'
      return null
    },
  },
  {
    name: 'single file: names the tree from the filename (extension stripped)',
    run: async () => {
      const { deps, rec } = makeDeps()
      const res = await generateTreeFromDocuments(
        { files: [fakeFile('CTS Guideline.pdf')], subspecialty: 'Hand' },
        undefined,
        deps,
      )
      if (rec.createTreeCalls[0].name !== 'CTS Guideline (CPG draft)')
        return `wrong tree name: ${rec.createTreeCalls[0].name}`
      if (res.summary.id !== 'tree_1') return `wrong summary id: ${res.summary.id}`
      if (res.placeholderCount !== 2) return `wrong placeholder count: ${res.placeholderCount}`
      if (res.validationIssues.length !== 1) return `wrong issue count: ${res.validationIssues.length}`
      // A single doc's meta is stored flat, not wrapped in { docs }.
      if (Array.isArray((rec.createTreeCalls[0].opts.baseMeta as any)?.docs))
        return 'single-doc baseMeta should be flat, not wrapped'
      return null
    },
  },
  {
    name: 'multi file: extracts each in order, threads the session id, names from subspecialty',
    run: async () => {
      const { deps, rec } = makeDeps()
      await generateTreeFromDocuments(
        { files: [fakeFile('one.pdf'), fakeFile('two.txt')], subspecialty: 'Peripheral nerve' },
        undefined,
        deps,
      )
      if (rec.scaffoldCalls.length !== 2) return `expected 2 scaffold calls, got ${rec.scaffoldCalls.length}`
      if (rec.scaffoldCalls[0].fileName !== 'one.pdf' || rec.scaffoldCalls[1].fileName !== 'two.txt')
        return `wrong order: ${rec.scaffoldCalls.map((c) => c.fileName).join(', ')}`
      if (rec.scaffoldCalls.some((c) => c.sessionId !== 'sess_1')) return 'scaffold called with wrong session id'
      if (rec.createTreeCalls[0].name !== 'Peripheral nerve (CPG draft)')
        return `wrong multi-doc name: ${rec.createTreeCalls[0].name}`
      // Two docs → base metas wrapped in { docs: [...] }.
      const meta = rec.createTreeCalls[0].opts.baseMeta as any
      if (!Array.isArray(meta?.docs) || meta.docs.length !== 2)
        return `expected 2 wrapped baseMetas, got ${JSON.stringify(meta)}`
      return null
    },
  },
  {
    name: 'session patch: marks the session done with the new tree id',
    run: async () => {
      const { deps, rec } = makeDeps({ createTreeId: 'tree_xyz' })
      await generateTreeFromDocuments({ files: [fakeFile('g.pdf')], subspecialty: 'Hand' }, undefined, deps)
      if (rec.patchCalls.length !== 1) return `expected 1 patch, got ${rec.patchCalls.length}`
      const p = rec.patchCalls[0].patch
      if (p.treeId !== 'tree_xyz' || p.stage !== 'done' || p.status !== 'completed')
        return `wrong patch: ${JSON.stringify(p)}`
      return null
    },
  },
  {
    name: 'progress: reports session, one extract per file, then save — in order',
    run: async () => {
      const { deps } = makeDeps()
      const phases: string[] = []
      await generateTreeFromDocuments(
        { files: [fakeFile('a.pdf'), fakeFile('b.pdf')], subspecialty: 'Hand' },
        (p: GenProgress) => phases.push(p.phase === 'extract' ? `extract:${p.index}/${p.total}` : p.phase),
        deps,
      )
      const expected = ['session', 'extract:0/2', 'extract:1/2', 'save']
      if (phases.join('|') !== expected.join('|')) return `wrong phases: ${phases.join('|')}`
      return null
    },
  },
  {
    name: 'roster: blank names are dropped before the session is created',
    run: async () => {
      const { deps, rec } = makeDeps()
      await generateTreeFromDocuments(
        {
          files: [fakeFile('g.pdf')],
          subspecialty: 'Hand',
          roster: [{ name: 'Dr. Real', specialty: 'x' }, { name: '  ', specialty: 'y' }],
        },
        undefined,
        deps,
      )
      const roster = (rec.sessionInputs[0] as any).roster
      if (roster.length !== 1 || roster[0].name !== 'Dr. Real')
        return `expected only the named specialist, got ${JSON.stringify(roster)}`
      return null
    },
  },
  {
    name: 'empty extraction: a scaffold that yields no tree throws, and never saves',
    run: async () => {
      const { deps, rec } = makeDeps({
        scaffold: () => ({ tree: null, placeholderCount: 0, validationIssues: [], baseMeta: null }),
      })
      const err = await expectThrows(
        () => generateTreeFromDocuments({ files: [fakeFile('empty.pdf')], subspecialty: 'Hand' }, undefined, deps),
        'no tree',
      )
      if (err) return err
      if (rec.createTreeCalls.length !== 0) return 'saved a tree despite empty extraction'
      if (rec.patchCalls.length !== 0) return 'patched the session despite empty extraction'
      return null
    },
  },
]

/* ── Runner ───────────────────────────────────────────────────────────────── */

async function main() {
  let failures = 0
  for (const c of checks) {
    let msg: string | null
    try {
      msg = await c.run()
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err)
    }
    if (msg) {
      failures += 1
      console.error(`\u2717 ${c.name}: ${msg}`)
    } else {
      console.log(`\u2713 ${c.name}`)
    }
  }
  if (failures > 0) {
    if (typeof process !== 'undefined') process.exitCode = 1
    throw new Error(`${failures} genFromDocs test(s) failed`)
  }
  console.log(`assistant/genFromDocs.test.ts — all ${checks.length} passed`)
}

await main()
