import { useState, useEffect } from 'react'
import EpicContainer from './EpicContainer'
import PatientHeaderBanner from './PatientHeaderBanner'
import { fetchReferrals, updateReferral } from '../../lib/api'

/**
 * Act 2 — Omari Triage Dashboard (SMART on FHIR View)
 *
 * Split-pane layout: left shows the raw EHR referral data (what came from
 * Epic), right shows the Omari engine's routing analysis. The specialist
 * can approve or override.
 */

interface TriageReferral {
  id: string
  display_id: string
  received_at: string | null
  channel: string
  priority: string
  status: string
  reason_for_referral: string | null
  clinical_note: string | null
  patient: { name: string; mrn: string; dob?: string; sex?: string } | null
  referred_by: { provider: string; practice: string; npi?: string; phone?: string; fax?: string } | null
  routed_specialist_name: string | null
  extraction: any
  annotations: any
  structured_data: any
}

interface SpecialistTriageViewProps {
  /** If provided, show this specific referral. Otherwise show the first needs_review. */
  referralDisplayId?: string
  /** Called when the specialist approves */
  onApproved?: (referralId: string) => void
}

export default function SpecialistTriageView({ referralDisplayId, onApproved }: SpecialistTriageViewProps) {
  const [referral, setReferral] = useState<TriageReferral | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)

  useEffect(() => {
    fetchReferrals()
      .then((all) => {
        const match = referralDisplayId
          ? all.find((r: any) => r.display_id === referralDisplayId)
          : all.find((r: any) => r.status === 'needs_review' && r.routed_specialist_name)
        setReferral(match || all[0] || null)
      })
      .catch((err) => console.error('Failed to load referrals:', err))
      .finally(() => setLoading(false))
  }, [referralDisplayId])

  const handleApprove = async () => {
    if (!referral) return
    setApproving(true)
    try {
      await updateReferral(referral.id, { status: 'reviewed' })
      setApproved(true)
      onApproved?.(referral.display_id)
    } catch (err) {
      console.error('Failed to approve:', err)
    } finally {
      setApproving(false)
    }
  }

  const specialist = referral?.routed_specialist_name || 'Pending Assignment'
  const routing = referral?.annotations?.routing || {}
  const confidence = extractConfidence(referral?.extraction)
  const rules = buildAppliedRules(routing, referral?.extraction)

  return (
    <EpicContainer
      title="In Basket — Omari Triage"
      subtitle="Duke Nerve Center"
      headerRight={
        <span className="text-[12px] text-white/80">{specialist}</span>
      }
    >
      {referral?.patient && (
        <PatientHeaderBanner
          name={referral.patient.name}
          mrn={referral.patient.mrn}
          dob={referral.patient.dob}
          sex={referral.patient.sex}
          alert={referral.priority === 'urgent' ? 'URGENT' : undefined}
        />
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center text-[13px]" style={{ color: 'var(--epic-text-muted)' }}>
          Loading referral…
        </div>
      ) : !referral ? (
        <div className="flex h-64 items-center justify-center text-[13px]" style={{ color: 'var(--epic-text-muted)' }}>
          No referrals awaiting triage.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left Pane: EHR Context */}
          <div className="w-1/2 overflow-y-auto border-r p-5" style={{ borderColor: 'var(--epic-border)' }}>
            <EhrContextPane referral={referral} />
          </div>

          {/* Right Pane: Omari Engine */}
          <div className="w-1/2 overflow-y-auto p-5" style={{ background: '#FAFBFC' }}>
            <OmariEnginePane
              referral={referral}
              specialist={specialist}
              confidence={confidence}
              rules={rules}
              approved={approved}
              approving={approving}
              onApprove={handleApprove}
            />
          </div>
        </div>
      )}
    </EpicContainer>
  )
}

/* ── Left Pane: EHR Context ───────────────────────────────────────────── */

function EhrContextPane({ referral }: { referral: TriageReferral }) {
  return (
    <div className="space-y-4">
      <SectionTitle>Order Metadata</SectionTitle>
      <div className="epic-card p-4">
        <MetaRow label="Referral ID" value={referral.display_id} />
        <MetaRow label="Channel" value={referral.channel?.toUpperCase() || '—'} />
        <MetaRow label="Priority" value={referral.priority || 'routine'} />
        <MetaRow label="Received" value={formatDate(referral.received_at)} />
        {referral.referred_by && (
          <>
            <MetaRow label="Referring Provider" value={referral.referred_by.provider} />
            <MetaRow label="Practice" value={referral.referred_by.practice || '—'} />
          </>
        )}
      </div>

      <SectionTitle>Clinical Reason</SectionTitle>
      <div className="epic-card p-4">
        <p className="text-[13px] font-medium" style={{ color: 'var(--epic-text-main)' }}>
          {referral.reason_for_referral || 'No reason provided'}
        </p>
        {referral.clinical_note && (
          <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--epic-text-muted)' }}>
            {referral.clinical_note}
          </p>
        )}
      </div>

      {referral.structured_data?.diagnoses?.length > 0 && (
        <>
          <SectionTitle>Diagnoses</SectionTitle>
          <div className="epic-card p-4">
            {referral.structured_data.diagnoses.map((dx: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--epic-text-main)' }}>
                <span className="font-mono text-[11px]" style={{ color: 'var(--epic-blue)' }}>{dx.icd10}</span>
                <span>{dx.description}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Right Pane: Omari Engine ─────────────────────────────────────────── */

function OmariEnginePane({
  referral,
  specialist,
  confidence,
  rules,
  approved,
  approving,
  onApprove,
}: {
  referral: TriageReferral
  specialist: string
  confidence: number
  rules: AppliedRule[]
  approved: boolean
  approving: boolean
  onApprove: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold" style={{ color: 'var(--epic-text-main)' }}>
            Omari Routing Engine
          </h3>
          <p className="text-[12px]" style={{ color: 'var(--epic-text-muted)' }}>
            Automated match {approved ? 'approved' : 'complete'} · {(confidence * 100).toFixed(0)}% confidence
          </p>
        </div>
        <ConfidenceDot confidence={confidence} />
      </div>

      {/* Applied rules */}
      <SectionTitle>Applied Rules</SectionTitle>
      <div className="epic-card p-4 space-y-2">
        {rules.map((rule, i) => (
          <RuleCheckItem key={i} rule={rule} index={i} />
        ))}
      </div>

      {/* Provider assignment */}
      <SectionTitle>Matched Specialist</SectionTitle>
      <div className="epic-card p-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-bold text-white"
            style={{ background: 'var(--epic-navy-700)' }}
          >
            {specialist.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('')}
          </div>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--epic-text-main)' }}>
              {specialist}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--epic-text-muted)' }}>
              {referral.annotations?.routing?.specialty || 'Peripheral Nerve Surgery'}
            </p>
          </div>
        </div>
      </div>

      {/* Action center */}
      <div className="pt-2">
        {approved ? (
          <div
            className="epic-card flex items-center gap-3 p-4"
            style={{ borderLeft: '3px solid var(--epic-green)' }}
          >
            <CheckCircle />
            <div>
              <p className="text-[13px] font-semibold" style={{ color: '#065F46' }}>
                Approved & Routed
              </p>
              <p className="text-[12px]" style={{ color: 'var(--epic-text-muted)' }}>
                Referral accepted. Patient will be notified and workup scheduled.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              className="epic-btn epic-btn-success flex-1 justify-center"
              onClick={onApprove}
              disabled={approving}
            >
              {approving ? 'Approving…' : 'Approve & Route'}
            </button>
            <button className="epic-btn epic-btn-secondary">
              Override Logic
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Shared sub-components ────────────────────────────────────────────── */

interface AppliedRule {
  id: string
  text: string
  passed: boolean
}

function RuleCheckItem({ rule, index }: { rule: AppliedRule; index: number }) {
  return (
    <div
      className="flex items-start gap-2 text-[12px]"
      style={{ animationDelay: `${index * 200}ms` }}
    >
      {rule.passed ? (
        <span style={{ color: 'var(--epic-green)' }}>&#10003;</span>
      ) : (
        <span style={{ color: 'var(--epic-text-muted)' }}>&#8226;</span>
      )}
      <span style={{ color: 'var(--epic-text-main)' }}>
        <span className="font-mono text-[11px]" style={{ color: 'var(--epic-text-muted)' }}>
          [{rule.id}]
        </span>{' '}
        {rule.text}
      </span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--epic-text-muted)' }}>
      {children}
    </h4>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-[12px]">
      <span style={{ color: 'var(--epic-text-muted)' }}>{label}</span>
      <span className="font-medium" style={{ color: 'var(--epic-text-main)' }}>{value}</span>
    </div>
  )
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color = confidence >= 0.9 ? 'var(--epic-green)' : confidence >= 0.7 ? 'var(--epic-amber)' : 'var(--epic-red)'
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="text-[12px] font-semibold" style={{ color }}>{(confidence * 100).toFixed(0)}%</span>
    </div>
  )
}

function CheckCircle() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--epic-green-light)' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  )
}

/* ── Data helpers ─────────────────────────────────────────────────────── */

function extractConfidence(extraction: any): number {
  if (!extraction?.variables) return 0.85
  const values = Object.values(extraction.variables) as any[]
  if (values.length === 0) return 0.85
  const sum = values.reduce((acc: number, v: any) => acc + (v?.confidence ?? 0.8), 0)
  return sum / values.length
}

function buildAppliedRules(routing: any, extraction: any): AppliedRule[] {
  const rules: AppliedRule[] = []
  const vars = extraction?.variables || {}

  if (vars.urgentRedFlag) {
    const isUrgent = vars.urgentRedFlag.value !== 'none'
    rules.push({
      id: '001',
      text: isUrgent ? `Urgent red flag detected: ${vars.urgentRedFlag.value}` : 'No urgent red flags → standard intake',
      passed: true,
    })
  }

  if (vars.presentationCategory) {
    rules.push({
      id: '102',
      text: `Presentation: ${vars.presentationCategory.value.replace(/_/g, ' ')} pattern`,
      passed: true,
    })
  }

  if (vars.symptomRegion) {
    rules.push({
      id: '203',
      text: `Anatomical region: ${vars.symptomRegion.value.replace(/_/g, ' ')}`,
      passed: true,
    })
  }

  if (vars.nerveStudyStatus) {
    rules.push({
      id: '204',
      text: `EMG/NCS status: ${vars.nerveStudyStatus.value.replace(/_/g, ' ')}`,
      passed: true,
    })
  }

  if (routing.specialist_name) {
    rules.push({
      id: '301',
      text: `Matched to specialist: ${routing.specialist_name}`,
      passed: true,
    })
  } else if (routing.outcome === 'escalated') {
    rules.push({
      id: '301',
      text: `Escalated: ${routing.escalation_reason?.slice(0, 80) || 'requires human triage'}`,
      passed: false,
    })
  }

  return rules
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}
