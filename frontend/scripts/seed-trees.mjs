// Seed the Postgres tree library with the built-in starter trees by POSTing
// them to the FastAPI /trees/full endpoint. Mirrors the in-app "Import starter
// trees" action; handy for verification and first-run population.
//
//   node scripts/seed-trees.mjs            (defaults to http://localhost:8000)
//   API=http://localhost:5173 node scripts/seed-trees.mjs   (through Vite proxy)
import { build } from 'esbuild'

const API = process.env.API ?? 'http://localhost:8000'

const res = await build({
  stdin: {
    contents: `
      import { sampleTree } from './src/data/sampleTree.ts'
      import { dukeNerveTree } from './src/data/dukeNerveTree.ts'

      const base = ${JSON.stringify(API)}
      const items = [
        { name: 'Peripheral Nerve (sample)', tree: sampleTree },
        { name: 'Duke Nerve Center', tree: dukeNerveTree },
      ]
      for (const { name, tree } of items) {
        const r = await fetch(base + '/api/v1/trees/full', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, rootNodeId: tree.rootNodeId, nodes: tree.nodes }),
        })
        const body = await r.text()
        console.log(r.status, '·', name, '·', body.slice(0, 140))
        if (!r.ok) process.exitCode = 1
      }
    `,
    resolveDir: '.',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})

await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'))
