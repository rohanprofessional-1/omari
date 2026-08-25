import { sampleTree } from '../src/data/sampleTree'
import { dukeNerveTree } from '../src/data/dukeNerveTree'
import { DASHBOARD_TREE, DASHBOARD_DELTAS } from '../src/dashboard/data/dashboardDeltas'
import { compile } from '../src/lib/deltas/compile'

const API = process.env.API ?? 'http://localhost:8000'

async function main() {
  const base = API
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
    const treeId = body.id
    console.log(r.status, '·', name, '·', treeId)
    if (!r.ok) {
       process.exitCode = 1
       continue
    }
    
    if (deltas && deltas.length > 0) {
       // 1. Post the deltas to get their backend-generated IDs
       const d = await fetch(base + '/api/v1/trees/' + treeId + '/deltas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(deltas.map(delta => ({
             op: delta.payload.op,
             payload: delta.payload,
             provenance: delta.provenance
          }))),
       })
       const savedDeltas = await d.json()
       console.log('  └ saved deltas', d.status)
       
       // 2. Map our local deltas to the saved ones to get the right IDs
       const updatedDeltas = deltas.map((d, i) => ({
         ...d,
         id: savedDeltas[i].id
       }))
       
       // 3. Compile with the correct IDs
       const compiled = compile(tree, updatedDeltas)
       
       // 4. Reconcile
       const rec = await fetch(base + '/api/v1/trees/' + treeId + '/reconcile', {
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
       console.log('  └ reconciled', updatedDeltas.length, 'deltas', rec.status)
    }
  }
}

main().catch(console.error)
