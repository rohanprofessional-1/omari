/**
 * Audit log API client — fetches audit events from the backend.
 */
import { authHeaders } from './authApi'

const API_URL = '/api/v1'

export interface AuditLogEntry {
  id: string
  patient_id: string
  patient_name: string | null
  patient_mrn: string | null
  actor_id: string | null
  actor_label: string
  action: string
  resource_type: string
  resource_id: string
  detail: Record<string, any> | null
  ip_address: string | null
  timestamp: string
}

export interface AuditLogListResponse {
  items: AuditLogEntry[]
  total: number
  offset: number
  limit: number
}

export interface AuditLogParams {
  patient_id?: string
  patient_name?: string
  action?: string
  actor_id?: string
  limit?: number
  offset?: number
}

export async function fetchAuditLogs(params: AuditLogParams = {}): Promise<AuditLogListResponse> {
  const searchParams = new URLSearchParams()
  if (params.patient_id) searchParams.set('patient_id', params.patient_id)
  if (params.patient_name) searchParams.set('patient_name', params.patient_name)
  if (params.action) searchParams.set('action', params.action)
  if (params.actor_id) searchParams.set('actor_id', params.actor_id)
  if (params.limit) searchParams.set('limit', String(params.limit))
  if (params.offset) searchParams.set('offset', String(params.offset))

  const qs = searchParams.toString()
  const url = `${API_URL}/audit-logs${qs ? `?${qs}` : ''}`

  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error('Failed to fetch audit logs')
  return res.json()
}

export async function fetchPatientAuditLog(
  patientId: string,
  params: { action?: string; limit?: number; offset?: number } = {},
): Promise<AuditLogListResponse> {
  const searchParams = new URLSearchParams()
  if (params.action) searchParams.set('action', params.action)
  if (params.limit) searchParams.set('limit', String(params.limit))
  if (params.offset) searchParams.set('offset', String(params.offset))

  const qs = searchParams.toString()
  const url = `${API_URL}/patients/${patientId}/audit-log${qs ? `?${qs}` : ''}`

  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error('Failed to fetch patient audit log')
  return res.json()
}
