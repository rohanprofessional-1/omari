// Bundles the TypeScript test files with esbuild (already a Vite dependency)
// and runs them in Node — no extra test-runner dependency required.
import { build } from 'esbuild'
import { existsSync } from 'node:fs'

const TEST_FILES = [
  'src/lib/engine.test.ts',
  'src/lib/workup.test.ts',
  'src/lib/generator/generator.test.ts',
  'src/lib/orchestrator.test.ts',
  'src/lib/assistant/ops.test.ts',
  'src/lib/assistant/impact.test.ts',
  'src/lib/deltas/deltas.test.ts',
  'src/lib/reconcile/plainLabel.test.ts',
  'src/lib/reconcile/questions/scope.test.ts',
  'src/lib/reconcile/questions/routing.test.ts',
  'src/lib/reconcile/questions/cutoffs.test.ts',
  'src/lib/reconcile/questions/tests.test.ts',
  'src/lib/reconcile/questions/cases.test.ts',
  'src/lib/reconcile/questions/safety.test.ts',
  'src/lib/nodePlacement.test.ts',
  'src/lib/edgeRouting.test.ts',
  'src/dashboard/lib/deriveTreeResult.test.ts',
  'src/dashboard/lib/surgeonBrief.test.ts',
]

for (const entry of TEST_FILES) {
  if (!existsSync(entry)) {
    console.warn(`[skip] ${entry} — not present on this branch`)
    continue
  }
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  })
  const code = res.outputFiles[0].text
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  try {
    await import(dataUrl)
    // Each test module sets process.exitCode = 1 (and throws) on failure.
  } catch (err) {
    console.error(`\n[${entry}] ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  }
}
