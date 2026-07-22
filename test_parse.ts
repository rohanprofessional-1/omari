import { TreeSchema } from './frontend/src/types/tree';
import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('tree.json', 'utf8'));

const tree: any = {
    treeId: data.id,
    rootNodeId: data.root_node_id,
    nodes: data.nodes.map((n: any) => {
      const base: any = {
        id: n.id,
        type: n.node_type,
      }

      if (n.node_type === 'variable') {
        base.variableKey = n.variable_key
        base.prompt = n.prompt
        base.dataSource = n.data_source
        base.branches = n.branches.map((b: any) => ({
          label: b.label,
          patientLabel: b.patient_label || undefined,
          nextNodeId: b.next_node_id || '',
          condition: b.condition ? {
              op: b.condition.condition_type,
              value: b.condition.value_string === 'true' ? true : b.condition.value_string === 'false' ? false : !isNaN(Number(b.condition.value_string)) ? Number(b.condition.value_string) : b.condition.value_string
          } : undefined
        }))
      } else if (n.node_type === 'specialist') {
        base.specialistName = n.specialist_name
        base.specialty = n.specialty
        base.urgency = n.urgency || 'routine'
        base.reasoningTemplate = n.reasoning_template || ''
        base.clinicalBasis = n.clinical_basis || undefined
        base.confirmWithDrLi = n.confirm_with_dr_li || undefined
        base.workup = n.workup_spec ?? (n.workup_items || []).map((w: any) => ({
          name: w.name,
          protocol: w.protocol ?? '',
          rationale: w.rationale ?? ''
        }))
      } else if (n.node_type === 'escalation') {
        base.reason = n.escalation_reason
      }
      return base
    })
  }

try {
    TreeSchema.parse(tree);
    console.log("Success");
} catch(e: any) {
    console.error(JSON.stringify(e.issues, null, 2));
}
