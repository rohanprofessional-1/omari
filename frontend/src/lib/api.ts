import type { Tree, Condition } from '../types/tree'
import { TreeSchema } from '../types/tree'

const API_BASE = '/api/v1'

export interface ClinicSummary {
  id: string
  name: string
  type?: string | null
  knowledge_base?: string | null
  group?: string | null
}

export interface TreeSummary {
  id: string
  clinic_id?: string | null
  name: string
}

export interface KnowledgeBaseFileSummary {
  filename: string
  content_type?: string | null
  file_type: string
  text_length: number
  selected_length: number
  selected_chunk_count: number
  relevant_topics: string[]
  matched_specialists: string[]
  matched_diagnoses: string[]
  summary: string
  key_points: string[]
  evidence_quotes: string[]
  model_used?: string | null
}

export interface KnowledgeBasePreviewResponse {
  clinic_id: string
  clinic_name: string
  tree_id: string
  tree_name: string
  overview: string
  focus_terms: string[]
  files: KnowledgeBaseFileSummary[]
  persisted: boolean
  updated_at: string
}

function mapCondition(c: any): Condition {
  if (c.condition_type === 'equals') {
    let val: string | number | boolean = c.value_string
    if (val === 'true') val = true
    else if (val === 'false') val = false
    else if (!isNaN(Number(val))) val = Number(val)
    return { op: 'equals', value: val }
  } else if (c.condition_type === 'range') {
    return { op: 'range', min: c.min_value ?? undefined, max: c.max_value ?? undefined }
  } else if (c.condition_type === 'in') {
    return { op: 'in', values: c.values_list ? JSON.parse(c.values_list) : [] }
  }
  throw new Error(`Unknown condition type: ${c.condition_type}`)
}

export async function fetchClinics(): Promise<ClinicSummary[]> {
  const res = await fetch(`${API_BASE}/clinics`)
  if (!res.ok) throw new Error('Failed to fetch clinics')
  return res.json()
}

export async function fetchTrees(): Promise<TreeSummary[]> {
  const res = await fetch(`${API_BASE}/trees`)
  if (!res.ok) throw new Error('Failed to fetch trees')
  return res.json()
}

export async function fetchTree(id: string): Promise<Tree> {
  const res = await fetch(`${API_BASE}/trees/${id}`)
  if (!res.ok) throw new Error('Failed to fetch tree')
  const data = await res.json()

  // Map backend snake_case format to frontend camelCase Schema
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
          condition: b.condition ? mapCondition(b.condition) : undefined
        }))
      } else if (n.node_type === 'specialist') {
        base.specialistName = n.specialist_name
        base.specialty = n.specialty
        base.urgency = n.urgency
        base.reasoningTemplate = n.reasoning_template
        base.clinicalBasis = n.clinical_basis || undefined
        base.confirmWithDrLi = n.confirm_with_dr_li || undefined
        base.workup = (n.workup_items || []).map((w: any) => ({
          name: w.name,
          protocol: w.protocol,
          rationale: w.rationale
        }))
      } else if (n.node_type === 'escalation') {
        base.reason = n.escalation_reason
      }

      return base
    })
  }

  // Validate to ensure engine compatibility
  return TreeSchema.parse(tree)
}

export async function fetchVariables() {
  const res = await fetch(`${API_BASE}/variables`)
  if (!res.ok) throw new Error('Failed to fetch variables')
  return res.json()
}

export async function fetchSpecialists() {
  const res = await fetch(`${API_BASE}/specialists`)
  if (!res.ok) throw new Error('Failed to fetch specialists')
  return res.json()
}

export async function previewKnowledgeBase(
  clinicId: string,
  formData: FormData,
): Promise<KnowledgeBasePreviewResponse> {
  const res = await fetch(`${API_BASE}/clinics/${clinicId}/knowledge-base/preview`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || 'Failed to preview knowledge base')
  }
  return res.json()
}

export async function startConversation(treeId: string, patientId?: string) {
  const body = patientId ? { tree_id: treeId, patient_id: patientId } : { tree_id: treeId }
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error('Failed to start conversation')
  return res.json()
}

export async function sendChatMessage(conversationId: string, message: string) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Failed to send chat message: ${text}`)
  }
  return res.json()
}

export async function getConversation(conversationId: string) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}`)
  if (!res.ok) throw new Error('Failed to fetch conversation')
  return res.json()
}
