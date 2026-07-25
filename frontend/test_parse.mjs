import { z } from 'zod';
import * as fs from 'fs';

// ... I'll just copy the necessary zod schemas directly into the script to avoid import issues
const ConditionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const EqualsConditionSchema = z.object({ op: z.literal('equals'), value: ConditionValueSchema });
const RangeConditionSchema = z.object({ op: z.literal('range'), min: z.number().optional(), max: z.number().optional() });
const InConditionSchema = z.object({ op: z.literal('in'), values: z.array(z.string()) });
const ConditionSchema = z.discriminatedUnion('op', [EqualsConditionSchema, RangeConditionSchema, InConditionSchema]);
const BranchSchema = z.object({ label: z.string(), patientLabel: z.string().optional(), condition: ConditionSchema, nextNodeId: z.string() });
const DataSourceSchema = z.enum(['patient', 'referral', 'record']);
const UrgencySchema = z.enum(['routine', 'expedited', 'urgent']);
const VariableNodeSchema = z.object({ id: z.string(), type: z.literal('variable'), variableKey: z.string(), prompt: z.string(), dataSource: DataSourceSchema, branches: z.array(BranchSchema) });
const WorkupItemSchema = z.object({ name: z.string(), protocol: z.string(), rationale: z.string() });
const KeyedConditionSchema = z.discriminatedUnion('op', [ EqualsConditionSchema.extend({ key: z.string() }), RangeConditionSchema.extend({ key: z.string() }), InConditionSchema.extend({ key: z.string() }) ]);
const WorkupConditionalSchema = z.object({ when: KeyedConditionSchema, item: WorkupItemSchema, reason: z.string().default('') });
const WorkupGuardSchema = z.object({ item: z.string(), requiredCondition: KeyedConditionSchema });
const WorkupSpecObjectSchema = z.object({ always: z.array(WorkupItemSchema).default([]), conditional: z.array(WorkupConditionalSchema).default([]), doNotOrderUnless: z.array(WorkupGuardSchema).default([]), escalateWorkupIf: KeyedConditionSchema.optional() });
const WorkupSpecSchema = z.union([ z.array(WorkupItemSchema).transform((always) => ({ always, conditional: [], doNotOrderUnless: [] })), WorkupSpecObjectSchema ]);
const SpecialistNodeSchema = z.object({ id: z.string(), type: z.literal('specialist'), specialistName: z.string(), specialty: z.string(), urgency: UrgencySchema, reasoningTemplate: z.string(), workup: WorkupSpecSchema, clinicalBasis: z.string().optional(), confirmWithDrLi: z.boolean().optional() });
const EscalationNodeSchema = z.object({ id: z.string(), type: z.literal('escalation'), reason: z.string() });
const NodeSchema = z.discriminatedUnion('type', [ VariableNodeSchema, SpecialistNodeSchema, EscalationNodeSchema ]);
const TreeSchema = z.object({ treeId: z.string(), rootNodeId: z.string(), nodes: z.array(NodeSchema) });

const data = JSON.parse(fs.readFileSync('../tree.json', 'utf8'));

const tree = {
    treeId: data.id,
    rootNodeId: data.root_node_id,
    nodes: data.nodes.map((n) => {
      const base = {
        id: n.id,
        type: n.node_type,
      }

      if (n.node_type === 'variable') {
        base.variableKey = n.variable_key
        base.prompt = n.prompt
        base.dataSource = n.data_source
        base.branches = n.branches.map((b) => ({
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
        base.workup = n.workup_spec ?? (n.workup_items || []).map((w) => ({
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
} catch(e) {
    console.error(JSON.stringify(e.issues, null, 2));
}
