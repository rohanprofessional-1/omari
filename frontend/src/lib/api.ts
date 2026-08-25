import type { Tree, Condition } from '../types/tree'
import { TreeSchema } from '../types/tree'

// Relative — Vite proxies /api/v1 → FastAPI (Postgres). See vite.config.ts.
const API_BASE = '/api/v1'

/**
 * Auth headers for every request in this file.
 *
 * TODO(auth): returns {} today — the backend has no authentication at all
 * (no users table, no JWT, no dependency). Once POST /api/v1/auth/login lands
 * (docs/tree-generator-technical-architecture.md §7 D4), attach
 * `Authorization: Bearer <token>` HERE and route every fetch through it, rather
 * than threading a token through each call site.
 */
export function authHeaders(): Record<string, string> {
  return {}
}

/** Tree metadata as returned by the list endpoint (TreeRead). */
export interface TreeSummary {
  id: string
  name: string
  clinic_id?: string | null
  description?: string | null
  version: number
  is_active: boolean
  authored_by?: string | null
  created_at: string
  updated_at: string
}

export interface ClinicSummary {
  id: string
  name: string
  type?: string | null
  knowledge_base?: string | null
  group?: string | null
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
    return {
      op: 'range',
      min: c.min_value != null ? Number(c.min_value) : undefined,
      max: c.max_value != null ? Number(c.max_value) : undefined
    }
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

export async function fetchTrees(opts: { is_active?: boolean } = {}): Promise<TreeSummary[]> {
  const url = opts.is_active !== undefined 
    ? `${API_BASE}/trees?is_active=${opts.is_active}` 
    : `${API_BASE}/trees`
  const res = await fetch(url)
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
        base.dataSource = n.data_source || 'patient'
        base.branches = n.branches.map((b: any) => ({
          label: b.label,
          patientLabel: b.patient_label || undefined,
          nextNodeId: b.next_node_id || '',
          condition: b.condition ? mapCondition(b.condition) : undefined
        }))
      } else if (n.node_type === 'specialist') {
        base.specialistName = n.specialist_name
        base.specialty = n.specialty
        base.urgency = n.urgency || 'routine'
        base.reasoningTemplate = n.reasoning_template || ''
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
  opts: { description?: string; baseTree?: unknown; baseMeta?: unknown } = {},
): Promise<TreeSummary> {
  const res = await fetch(`${API_BASE}/trees/full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: opts.description,
      rootNodeId: tree.rootNodeId,
      nodes: tree.nodes,
      // Delta layer: raw CPG scaffold + anchoring metadata, stored verbatim.
      baseTree: opts.baseTree,
      baseMeta: opts.baseMeta,
    }),
  })
  if (!res.ok) throw new Error(`Failed to save tree: ${await res.text()}`)
  return res.json()
}

/** Replace an existing tree's draft IN PLACE (same library row, version bumped). */
export async function updateTreeFull(
  id: string,
  tree: Tree,
  opts: { name?: string; description?: string } = {},
): Promise<TreeSummary> {
  const res = await fetch(`${API_BASE}/trees/${id}/full`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: opts.name,
      description: opts.description,
      rootNodeId: tree.rootNodeId,
      nodes: tree.nodes,
    }),
  })
  if (!res.ok) throw new Error(`Failed to update tree: ${await res.text()}`)
  return res.json()
}

/** Publish the draft as an immutable, optionally signed version. */
export async function publishTree(
  id: string,
  opts: { signedBy?: string; validationSummary?: Record<string, unknown> } = {},
): Promise<{ id: string; version_no: number; signed_by?: string | null }> {
  const res = await fetch(`${API_BASE}/trees/${id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signed_by: opts.signedBy, validation_summary: opts.validationSummary }),
  })
  if (!res.ok) throw new Error(`Failed to publish tree: ${await res.text()}`)
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

/** Activate a stored tree (and deactivate others). */
export async function activateTree(id: string): Promise<TreeSummary> {
  const res = await fetch(`${API_BASE}/trees/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: true }),
  })
  if (!res.ok) throw new Error('Failed to activate tree')
  return res.json()
}

/** Soft-delete a stored tree (the backend sets is_active = false). */
export async function deleteTree(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/trees/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error('Failed to delete tree')
}


/* -------------------------------------------------------------------------- */
/* Referrals — the review pipeline                                             */
/* -------------------------------------------------------------------------- */

export interface ApiReferralPayload {
  referralId: string
  receivedAt: string
  channel: string
  patient: { name: string; mrn: string; dob: string; sex: string; phone: string }
  referredBy: { provider: string; npi: string; practice: string; phone: string; fax?: string }
  referredToDepartment: string
  priority: string
  reasonForReferral: string
  clinicalNote: string
  diagnoses: { icd10: string; description: string }[]
  attachments: { title: string; type: string; date: string; pages?: number }[]
  structured: { vitals?: Record<string, string>; meds?: string[]; problems?: string[] }
}

export interface ApiExtractionVariable {
  value: string | number | boolean
  confidence: number
}

export interface ApiReferralExtraction {
  variables: Record<string, ApiExtractionVariable>
  sources: Record<string, string>
}

export interface ApiReferralAnnotations {
  scope?: { kind: string; suggestedRedirect: string; reason: string }
  flags?: { ambiguousBetween?: string[]; statedReasonMismatch?: boolean }
  workupState?: Record<string, { status: string; responsible: string; dueDaysBeforeVisit: number }>
  visitDate?: string
}

export interface ApiReferral {
  id: string
  payload: ApiReferralPayload
  extraction: ApiReferralExtraction
  annotations: ApiReferralAnnotations | null
  created_at: string
  updated_at: string
}

export interface ApiReviewRead {
  id: string
  referral_id: string
  status: string
  reviewer: string | null
  reviewed_at: string | null
  surgeon_seen: boolean
  correction: Record<string, string> | null
  workup_overrides: Record<string, string> | null
  created_at: string
  updated_at: string
}

export interface ApiAuditEvent {
  id: string
  referral_id: string
  at: string
  actor: string
  role: string
  action: string
  correction: Record<string, string> | null
  note: string | null
}

/** Create a new referral from intake (patient chatbot completion). */
export async function createReferral(data: {
  payload: ApiReferralPayload
  extraction: ApiReferralExtraction
  annotations?: ApiReferralAnnotations | null
  clinic_id?: string | null
}): Promise<ApiReferral> {
  const res = await fetch(`${API_BASE}/referrals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to create referral: ${await res.text()}`)
  return res.json()
}

/** Fetch all referrals, optionally scoped by MRN or clinic. */
export async function fetchReferrals(opts?: {
  mrn?: string
  clinicId?: string
}): Promise<ApiReferral[]> {
  const params = new URLSearchParams()
  if (opts?.mrn) params.set('mrn', opts.mrn)
  if (opts?.clinicId) params.set('clinic_id', opts.clinicId)
  const qs = params.toString()
  const res = await fetch(`${API_BASE}/referrals${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error('Failed to fetch referrals')
  return res.json()
}

/** Fetch a single referral by its external referral ID. */
export async function fetchReferral(referralId: string): Promise<ApiReferral> {
  const res = await fetch(`${API_BASE}/referrals/${encodeURIComponent(referralId)}`)
  if (!res.ok) {
    if (res.status === 404) throw new Error('Referral not found')
    throw new Error('Failed to fetch referral')
  }
  return res.json()
}

/** Submit a review decision for a referral. */
export async function submitReview(
  referralId: string,
  data: {
    status: string
    actor: string
    role: string
    correction?: { field: string; from: string; to: string; reason: string }
    note?: string
  },
): Promise<ApiReviewRead> {
  const res = await fetch(`${API_BASE}/referrals/${encodeURIComponent(referralId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to submit review')
  return res.json()
}

/** Fetch all reviews for a referral. */
export async function fetchReviews(referralId: string): Promise<ApiReviewRead[]> {
  const res = await fetch(`${API_BASE}/referrals/${encodeURIComponent(referralId)}/reviews`)
  if (!res.ok) throw new Error('Failed to fetch reviews')
  return res.json()
}

/** Fetch all reviews across all referrals. */
export async function fetchAllReviews(): Promise<ApiReviewRead[]> {
  const res = await fetch(`${API_BASE}/referrals/reviews/all`)
  if (!res.ok) throw new Error('Failed to fetch all reviews')
  return res.json()
}

/** Fetch all audit events across all referrals. */
export async function fetchAllAuditEvents(): Promise<ApiAuditEvent[]> {
  const res = await fetch(`${API_BASE}/referrals/audit/all`)
  if (!res.ok) throw new Error('Failed to fetch audit events')
  return res.json()
}

/** Fetch audit trail for a single referral. */
export async function fetchAuditEvents(referralId: string): Promise<ApiAuditEvent[]> {
  const res = await fetch(`${API_BASE}/referrals/${encodeURIComponent(referralId)}/audit`)
  if (!res.ok) throw new Error('Failed to fetch audit events')
  return res.json()
}

/** Update a workup item's status. */
export async function updateWorkupStatus(
  referralId: string,
  data: { item_name: string; status: string; actor: string; role: string },
): Promise<ApiReviewRead> {
  const res = await fetch(`${API_BASE}/referrals/${encodeURIComponent(referralId)}/workup-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update workup status')
  return res.json()
}
