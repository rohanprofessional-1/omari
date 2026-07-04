// Bundles the TypeScript test files with esbuild (already a Vite dependency)
// and runs them in Node — no extra test-runner dependency required.
import { build } from 'esbuild'

const TEST_FILES = [
  'src/lib/engine.test.ts',
  'src/lib/workup.test.ts',
  'src/lib/generator/generator.test.ts',
  'src/lib/orchestrator.test.ts',
  'src/lib/assistant/ops.test.ts',
  'src/lib/assistant/impact.test.ts',
]

for (const entry of TEST_FILES) {
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
