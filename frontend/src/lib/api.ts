import type { Tree, Condition } from '../types/tree'
import { TreeSchema } from '../types/tree'

// Relative — Vite proxies /api/v1 → FastAPI (Postgres). See vite.config.ts.
const API_BASE = '/api/v1'

/** Tree metadata as returned by the list endpoint (TreeRead). */
export interface TreeSummary {
  id: string
  name: string
  description?: string | null
  version: number
  is_active: boolean
  authored_by?: string | null
  created_at: string
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

export async function fetchTrees(): Promise<TreeSummary[]> {
  const res = await fetch(`${API_BASE}/trees?is_active=true`)
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
        // Prefer the v2 path-conditioned spec (JSONB); fall back to the legacy
        // flat workup_items rows. Either way TreeSchema.parse normalizes to
        // WorkupSpec, so the engine sees one shape.
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

/* -------------------------------------------------------------------------- */
/* Tree library — persist / manage whole trees in Postgres                     */
/* -------------------------------------------------------------------------- */

/**
 * Persist a complete tree (nodes, branches, conditions, workup) to the DB.
 * The frontend Tree shape is already what the /trees/full endpoint accepts.
 */
export async function createTreeFull(
  name: string,
  tree: Tree,
  opts: { description?: string } = {},
): Promise<TreeSummary> {
  const res = await fetch(`${API_BASE}/trees/full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: opts.description,
      rootNodeId: tree.rootNodeId,
      nodes: tree.nodes,
    }),
  })
  if (!res.ok) throw new Error(`Failed to save tree: ${await res.text()}`)
  return res.json()
}

/** Rename a stored tree. */
export async function renameTree(id: string, name: string): Promise<TreeSummary> {
  const res = await fetch(`${API_BASE}/trees/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to rename tree')
  return res.json()
}

/** Soft-delete a stored tree (the backend sets is_active = false). */
export async function deleteTree(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/trees/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error('Failed to delete tree')
}
