import { useState, useEffect } from 'react'
import { fetchReferrals } from '../../lib/api'

/**
 * Act 3A — Patient MyChart Interface
 *
 * The patient's view of their referral after the specialist approves it.
 * Styled to look like Epic MyChart: green/white palette, patient-friendly
 * language, appointment scheduling CTA.
 *
 * Polls the backend for status so it reflects the specialist's decision
 * from Act 2 without needing a page reload.
 */

interface PatientMyChartViewProps {
  /** MRN of the patient to show referral for */
  mrn?: string
  /** Pre-approved: skip polling and show approved state directly */
  approved?: boolean
}

const POLL_INTERVAL_MS = 3000

export default function PatientMyChartView({ mrn = 'MRN-4839201', approved: initialApproved = false }: PatientMyChartViewProps) {
  const [referral, setReferral] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [approved, setApproved] = useState(initialApproved)
  const [scheduled, setScheduled] = useState(false)

  // Poll for the patient's referral status
  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const all = await fetchReferrals()
        const match = all.find((r: any) => r.patient?.mrn === mrn)
        if (!cancelled && match) {
          setReferral(match)
          if (match.status === 'reviewed' || match.status === 'scheduled') {
            setApproved(true)
          }
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    check()
    const timer = setInterval(check, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [mrn])

  const specialist = referral?.routed_specialist_name || 'Dr. Eliana Saltzman'

  return (
    <div className="flex h-full flex-col" style={{ background: '#F0F4F8', fontFamily: 'var(--font-epic, Segoe UI, Arial, sans-serif)' }}>
      {/* MyChart header */}
      <header className="flex h-14 items-center justify-between px-5" style={{ background: '#1B5E20' }}>
        <div className="flex items-center gap-3">
          <MyChartLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">MyChart</span>
          <span className="text-white/50">|</span>
          <span className="text-[13px] text-white/80">Duke Health</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[13px] font-bold text-white">
            MT
          </div>
          <span className="text-[13px] text-white/90">Marla T.</span>
        </div>
      </header>

      {/* Sub-nav */}
      <nav className="flex gap-0 border-b px-5" style={{ background: '#FFFFFF', borderColor: '#D1D5DB' }}>
        {['Health Summary', 'Appointments', 'Messages', 'Test Results', 'Referrals'].map((tab) => (
          <button
            key={tab}
            className="px-4 py-2.5 text-[13px] font-medium transition-colors"
            style={{
              color: tab === 'Referrals' ? '#1B5E20' : '#6B7280',
              borderBottom: tab === 'Referrals' ? '2px solid #1B5E20' : '2px solid transparent',
            }}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <h2 className="mb-4 text-[18px] font-bold" style={{ color: '#1F2937' }}>
          My Referrals
        </h2>

        {loading ? (
          <div className="rounded-xl border bg-white p-8 text-center text-[13px]" style={{ color: '#6B7280' }}>
            Checking your referral status…
          </div>
        ) : approved ? (
          <ApprovedReferralCard
            specialist={specialist}
            referral={referral}
            scheduled={scheduled}
            onSchedule={() => setScheduled(true)}
          />
        ) : (
          <PendingReferralCard referral={referral} />
        )}

        {/* Connection badge */}
        <div className="mt-4 flex items-center gap-2 text-[11px]" style={{ color: '#6B7280' }}>
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Connected to Epic FHIR R4 · Powered by Omari · Status synced in real-time
        </div>
      </div>
    </div>
  )
}

/* ── Referral cards ──────────────────────────────────────────────────── */

function ApprovedReferralCard({
  specialist,
  referral,
  scheduled,
  onSchedule,
}: {
  specialist: string
  referral: any
  scheduled: boolean
  onSchedule: () => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border" style={{ background: '#FFFFFF', borderColor: '#D1D5DB' }}>
      {/* Green approved banner */}
      <div className="flex items-center gap-3 px-5 py-4" style={{ background: '#F0FDF4', borderBottom: '1px solid #BBF7D0' }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: '#D1FAE5' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <span
            className="mr-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
            style={{ background: '#059669', color: 'white' }}
          >
            Approved
          </span>
          <span className="text-[13px] font-medium" style={{ color: '#065F46' }}>
            Your referral has been accepted
          </span>
        </div>
      </div>

      <div className="p-5">
        {/* Specialty */}
        <h3 className="text-[16px] font-bold" style={{ color: '#1F2937' }}>
          Peripheral Nerve / Hand Surgery
        </h3>
        <p className="mt-1 text-[13px]" style={{ color: '#6B7280' }}>
          Your referral has been accepted by the Duke Nerve Center.
        </p>

        {/* Doctor card */}
        <div className="mt-4 flex items-center gap-4 rounded-lg p-3" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full text-[16px] font-bold text-white"
            style={{ background: '#003B71' }}
          >
            {specialist.split(' ').map((w: string) => w[0]).filter(Boolean).slice(-2).join('')}
          </div>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: '#1F2937' }}>{specialist}</p>
            <p className="text-[12px]" style={{ color: '#6B7280' }}>Duke Nerve Center · Hand & Peripheral Nerve Surgery</p>
          </div>
        </div>

        {/* Workup items */}
        {referral?.annotations?.routing?.urgency && (
          <div className="mt-3 flex items-center gap-2 text-[12px]">
            <span style={{ color: '#6B7280' }}>Appointment window:</span>
            <span className="font-medium" style={{ color: '#1F2937' }}>
              {referral.annotations.routing.urgency === 'expedited' ? '< 2 weeks' : '< 4 weeks'}
            </span>
          </div>
        )}

        {/* Schedule CTA */}
        <div className="mt-5">
          {scheduled ? (
            <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className="text-[13px] font-medium" style={{ color: '#065F46' }}>
                Appointment requested — you'll receive confirmation by email
              </span>
            </div>
          ) : (
            <button
              onClick={onSchedule}
              className="w-full rounded-lg py-2.5 text-[14px] font-semibold text-white transition-colors hover:opacity-90"
              style={{ background: '#1B5E20' }}
            >
              Schedule Appointment Now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PendingReferralCard({ referral }: { referral: any }) {
  return (
    <div className="overflow-hidden rounded-xl border" style={{ background: '#FFFFFF', borderColor: '#D1D5DB' }}>
      {/* Pending banner */}
      <div className="flex items-center gap-3 px-5 py-4" style={{ background: '#FEF3C7', borderBottom: '1px solid #FDE68A' }}>
        <PulsingDot />
        <div>
          <span
            className="mr-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
            style={{ background: '#D97706', color: 'white' }}
          >
            Pending
          </span>
          <span className="text-[13px] font-medium" style={{ color: '#92400E' }}>
            Omari is processing your referral
          </span>
        </div>
      </div>

      <div className="p-5">
        <h3 className="text-[16px] font-bold" style={{ color: '#1F2937' }}>
          Peripheral Nerve / Hand Surgery
        </h3>
        <p className="mt-1 text-[13px]" style={{ color: '#6B7280' }}>
          Your referral has been received and is being reviewed by the care team.
          You'll be notified when a specialist has been assigned.
        </p>

        {/* Progress steps */}
        <div className="mt-4 space-y-2">
          <ProgressStep done label="Referral received" />
          <ProgressStep done label="Analyzed by Omari" />
          <ProgressStep active label="Specialist review in progress" />
          <ProgressStep label="Appointment scheduling" />
        </div>
      </div>
    </div>
  )
}

/* ── Small helpers ───────────────────────────────────────────────────── */

function ProgressStep({ done, active, label }: { done?: boolean; active?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <div
        className="flex h-5 w-5 items-center justify-center rounded-full shrink-0"
        style={{
          background: done ? '#059669' : active ? '#D97706' : '#E5E7EB',
        }}
      >
        {done ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : active ? (
          <span className="h-2 w-2 rounded-full bg-white" />
        ) : null}
      </div>
      <span style={{ color: done ? '#059669' : active ? '#D97706' : '#9CA3AF', fontWeight: done || active ? 500 : 400 }}>
        {label}
      </span>
    </div>
  )
}

function PulsingDot() {
  return (
    <div className="relative flex h-3 w-3">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: '#D97706' }} />
      <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: '#D97706' }} />
    </div>
  )
}

function MyChartLogo() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded" style={{ background: 'rgba(255,255,255,0.2)' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    </div>
  )
}
