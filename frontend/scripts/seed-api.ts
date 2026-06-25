import { sampleTree } from '../src/data/sampleTree'
import { dukeNerveTree } from '../src/data/dukeNerveTree'

const API_URL = 'http://backend:8000/api/v1'

async function seed() {
  for (const tree of [sampleTree, dukeNerveTree]) {
    // 1. Create tree
    const treeRes = await fetch(`${API_URL}/trees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: tree.treeId === 'tree-duke-nerve' ? 'Duke Nerve Tree' : 'Sample Tree',
        root_node_id: tree.rootNodeId,
      })
    })
    if (!treeRes.ok) throw new Error(`Tree failed: ${await treeRes.text()}`)
    const treeData = await treeRes.json()
    const dbTreeId = treeData.id
    console.log(`Created tree ${dbTreeId} for ${tree.treeId}`)

    // 2. Create nodes
    for (const node of tree.nodes) {
      const backendNode: any = {
        id: node.id,
        node_type: node.type,
      }

      if (node.type === 'variable') {
        backendNode.variable_key = node.variableKey
        backendNode.prompt = node.prompt
        backendNode.data_source = node.dataSource
        backendNode.branches = node.branches.map(b => {
          let conditionPayload: any = null
          if (b.condition) {
            conditionPayload = {
              condition_type: b.condition.op,
              value_string: 'value' in b.condition && b.condition.value !== undefined ? String(b.condition.value) : undefined,
              values_list: 'values' in b.condition && b.condition.values ? JSON.stringify(b.condition.values) : undefined,
              min_value: 'min' in b.condition ? b.condition.min : undefined,
              max_value: 'max' in b.condition ? b.condition.max : undefined,
            }
          }
          return {
            label: b.label,
            patient_label: b.patientLabel,
            next_node_id: b.nextNodeId,
            condition: conditionPayload
          }
        })
      } else if (node.type === 'specialist') {
        backendNode.specialist_name = node.specialistName
        backendNode.specialty = node.specialty
        backendNode.urgency = node.urgency
        backendNode.reasoning_template = node.reasoningTemplate
        backendNode.clinical_basis = node.clinicalBasis
        backendNode.confirm_with_dr_li = node.confirmWithDrLi
        backendNode.workup_items = node.workup.map(w => ({
          name: w.name,
          protocol: w.protocol,
          rationale: w.rationale
        }))
      } else if (node.type === 'escalation') {
        backendNode.escalation_reason = node.reason
      }

      const nodeRes = await fetch(`${API_URL}/trees/${dbTreeId}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backendNode)
      })
      if (!nodeRes.ok) {
        console.error('Node payload:', backendNode)
        throw new Error(`Node ${node.id} failed: ${await nodeRes.text()}`)
      }
    }
    console.log(`Successfully seeded ${tree.nodes.length} nodes for ${tree.treeId}.`)
  }
}

seed().catch(console.error)
