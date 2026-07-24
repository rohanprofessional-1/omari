import type { FilledVariables } from '../types/tree'
import type { ResolvedWorkup } from '../lib/engine'
import type { RouteReason } from '../lib/explain'

/**
 * Referral-review dashboard — foundation types.
 *
 * These shapes are the contract between the (mock, later live-Epic) referral
 * source, the derivation layer that replays each referral through the
 * deterministic engine, and the UI that will sit on top. No UI in this layer.
 */

export type SourceChannel = 'epic' | 'fax' | 'phone'

export interface EpicReferralPayload {
  referralId: string
  receivedAt: string
  channel: SourceChannel
  patient: { name: string; mrn: string; dob: string; sex: 'F' | 'M' | 'X'; phone: string }
  referredBy: { provider: string; npi: string; practice: string; phone: string; fax?: string }
  referredToDepartment: string
  priority: 'routine' | 'urgent'
  reasonForReferral: string
  clinicalNote: string
  diagnoses: { icd10: string; description: string }[]
  attachments: { title: string; type: 'note' | 'imaging' | 'emg' | 'labs' | 'photo'; date: string; pages?: number }[]
  structured: { vitals?: Record<string, string>; meds?: string[]; problems?: string[] }
}

export type VariableSource = 'note' | 'structured' | 'attachment' | 'referrer-stated'
export interface ReferralExtraction {
  variables: FilledVariables
  sources: Record<string, VariableSource>
}

export type WorkupStatus = 'needed' | 'ordered' | 'scheduled' | 'resulted' | 'reviewed'
export type ResponsibleParty = 'clinic' | 'referring office' | 'patient'

export interface ReferralAnnotations {
  scope?: { kind: 'out_of_scope'; suggestedRedirect: string; reason: string }
  flags?: { ambiguousBetween?: [string, string]; statedReasonMismatch?: boolean }
  workupState?: Record<string, { status: WorkupStatus; responsible: ResponsibleParty; dueDaysBeforeVisit: number }>
  visitDate?: string
}

export interface ReferralFixture {
  payload: EpicReferralPayload
  extraction: ReferralExtraction
  annotations?: ReferralAnnotations
}

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface DecisionStep extends RouteReason {
  nodeId: string
  source: VariableSource | 'unknown'
  citation?: string
  overridden: boolean
}

export interface MissingVariableInfo {
  variableKey: string
  question: string
  clinicalPrompt: string
  whoCanSupply: 'patient' | 'referring office' | 'medical records'
  gates: { answerLabel: string; leadsTo: string }[]
}

export interface DashboardWorkupItem {
  name: string
  protocol?: string
  rationale?: string
  source: 'always' | 'conditional'
  conditionalReason?: string
  status: WorkupStatus
  responsible: ResponsibleParty
  dueBy: string
  atRisk: boolean
}

export interface TreeResult {
  inScope: boolean
  routedTo: { specialistName: string; specialty: string; nodeId: string } | null
  urgency: 'routine' | 'expedited' | 'urgent' | null
  pathTaken: DecisionStep[]
  missingVariables: MissingVariableInfo[]
  requiredWorkup: DashboardWorkupItem[]
  resolvedWorkup?: ResolvedWorkup
  escalated: boolean
  escalationReason?: string
  escalationCategory?: 'emergency' | 'ambiguous' | 'complex'
  confidence: ConfidenceLevel
  confidenceReason: string
  overrideNodeIds: string[]
  /** Terminal node touched by a deviatesFromCpg delta. */
  terminalOverridden: boolean
  /** SpecialistNode.clinicalBasis. */
  terminalCitation?: string
  confirmWithDrLi?: boolean
  suggestedRedirect?: string
  flags: { ambiguousBetween?: [string, string]; statedReasonMismatch?: boolean }
  visitDate?: string
}

export type ReviewStatus = 'pending' | 'approved' | 'corrected' | 'rejected' | 'escalated' | 'info_requested'
export type Role = 'coordinator' | 'surgeon' | 'admin'

export interface Correction {
  field: 'destination' | 'urgency' | 'scope'
  from: string
  to: string
  reason: string
}

export interface AuditEvent {
  id: string
  referralId: string
  at: string
  actor: string
  role: Role
  action: ReviewStatus | 'viewed' | 'workup_status_changed'
  correction?: Correction
  note?: string
}

export interface ReviewState {
  referralId: string
  status: ReviewStatus
  reviewer?: string
  reviewedAt?: string
  correction?: Correction
  surgeonSeen?: boolean
}

export interface ReviewableReferral {
  payload: EpicReferralPayload
  extraction: ReferralExtraction
  result: TreeResult
}

export interface ReferralSource {
  listReferrals(): Promise<ReviewableReferral[]>
  getReferral(id: string): Promise<ReviewableReferral | null>
}

export type QueueGroup = 'ready' | 'needs_info' | 'needs_judgment' | 'out_of_scope' | 'escalated'
