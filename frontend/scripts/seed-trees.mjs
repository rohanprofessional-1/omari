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

      import { DASHBOARD_TREE, DASHBOARD_DELTAS } from './src/dashboard/data/dashboardDeltas.ts'
      import { compile } from './src/lib/deltas/compile.ts'

      const base = ${JSON.stringify(API)}
      
      const items = [
        { name: 'Peripheral Nerve (sample)', tree: sampleTree, deltas: [] },
        { name: 'Duke Nerve Center', tree: dukeNerveTree, deltas: DASHBOARD_DELTAS },
      ]
      
      for (const { name, tree, deltas } of items) {
        const r = await fetch(base + '/api/v1/trees/full', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, rootNodeId: tree.rootNodeId, nodes: tree.nodes }),
        })
        const body = await r.json()
        console.log(r.status, '·', name, '·', body.id)
        if (!r.ok) {
           process.exitCode = 1
           continue
        }
        
        if (deltas.length > 0) {
           const compiled = compile(tree, deltas)
           const rec = await fetch(base + '/api/v1/trees/' + body.id + '/reconcile', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                 tree: {
                   name: name,
                   rootNodeId: compiled.tree.rootNodeId,
                   nodes: compiled.tree.nodes,
                 },
                 delta_results: compiled.results.map((res) => ({
                   delta_id: res.deltaId,
                   status: res.status === 'applied' ? 'active' : res.status,
                   stale_reason: res.reason
                 })),
              }),
           })
           const recBody = await rec.text()
           console.log('  └ reconciled', deltas.length, 'deltas', rec.status)
           
           // And post the deltas themselves
           const d = await fetch(base + '/api/v1/trees/' + body.id + '/deltas', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(deltas.map(d => ({
                 op: d.payload.op,
                 payload: d.payload,
                 provenance: d.provenance
              }))),
           })
           console.log('  └ saved deltas', d.status)
        }
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
