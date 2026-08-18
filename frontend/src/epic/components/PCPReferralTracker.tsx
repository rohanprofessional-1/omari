import { useEffect, useState } from 'react'
import EpicContainer from './EpicContainer'
import { fetchReferrals } from '../../lib/api'

/**
 * Act 3B — PCP Referral Tracker ("Orders Out")
 *
 * The PCP's outbound referral status view: a table of all referrals they've
 * sent, with live status updates from the backend. This is the "closed loop"
 * the PCP sees after signing an order in Act 1.
 */

interface TrackerReferral {
  id: string
  display_id: string
  received_at: string | null
  channel: string
  priority: string
  status: string
  reason_for_referral: string | null
  patient: { name: string; mrn: string } | null
  routed_specialist_name: string | null
}

interface PCPReferralTrackerProps {
  /** Highlight a specific referral (just submitted from Act 1) */
  highlightId?: string
}

export default function PCPReferralTracker({ highlightId }: PCPReferralTrackerProps) {
  const [referrals, setReferrals] = useState<TrackerReferral[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchReferrals()
      .then((data) => setReferrals(data))
      .catch((err) => console.error('Failed to fetch referrals:', err))
      .finally(() => setLoading(false))
  }, [])

  return (
    <EpicContainer
      title="Referrals Out — Status Tracker"
      subtitle="Cary Family Medicine"
      headerRight={
        <span className="text-[12px] text-white/80">Dr. Alan Pemberly</span>
      }
    >
      <div className="p-5">
        {/* Summary strip */}
        <div className="mb-4 flex items-center gap-4">
          <h2 className="text-[16px] font-bold" style={{ color: 'var(--epic-text-main)' }}>
            My Outbound Referrals
          </h2>
          <span className="text-[12px]" style={{ color: 'var(--epic-text-muted)' }}>
            {referrals.length} referral{referrals.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-[13px]" style={{ color: 'var(--epic-text-muted)' }}>
            Loading referrals…
          </div>
        ) : referrals.length === 0 ? (
          <div className="epic-card py-12 text-center text-[13px]" style={{ color: 'var(--epic-text-muted)' }}>
            No outbound referrals yet.
          </div>
        ) : (
          <div className="epic-card overflow-hidden">
            <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--epic-bg)', borderBottom: '1px solid var(--epic-border)' }}>
                  <Th>Ref ID</Th>
                  <Th>Date</Th>
                  <Th>Patient</Th>
                  <Th>Specialty / Reason</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr
                    key={r.id}
                    className={highlightId === r.display_id ? 'animate-pulse' : ''}
                    style={{
                      borderBottom: '1px solid var(--epic-border-light)',
                      background: highlightId === r.display_id ? '#EFF6FF' : undefined,
                    }}
                  >
                    <Td>
                      <span className="font-mono text-[12px] font-medium">{r.display_id}</span>
                    </Td>
                    <Td>{formatDate(r.received_at)}</Td>
                    <Td>
                      <span className="font-medium">{r.patient?.name || '—'}</span>
                    </Td>
                    <Td>
                      <span className="line-clamp-1">{r.reason_for_referral || '—'}</span>
                    </Td>
                    <Td><StatusBadge status={r.status} specialist={r.routed_specialist_name} /></Td>
                    <Td><PriorityBadge priority={r.priority} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Audit trail placeholder */}
        <div className="mt-4 text-[11px]" style={{ color: 'var(--epic-text-muted)' }}>
          <span className="h-1.5 w-1.5 rounded-full inline-block mr-1" style={{ background: 'var(--epic-green)' }} />
          Connected to Omari Routing Engine · Status updates in real-time
        </div>
      </div>
    </EpicContainer>
  )
}

/* ── Table helpers ─────────────────────────────────────────────────────── */

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: 'var(--epic-text-muted)' }}
    >
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-4 py-3" style={{ color: 'var(--epic-text-main)' }}>
      {children}
    </td>
  )
}

function StatusBadge({ status, specialist }: { status: string; specialist: string | null }) {
  const map: Record<string, { label: string; className: string }> = {
    new: { label: 'Omari Processing', className: 'epic-badge epic-badge-blue' },
    needs_review: { label: specialist ? `Routed → ${specialist}` : 'Omari Triage Pending', className: 'epic-badge epic-badge-blue' },
    reviewed: { label: specialist ? `Accepted by ${specialist}` : 'Reviewed', className: 'epic-badge epic-badge-green' },
    scheduled: { label: 'Appointment Scheduled', className: 'epic-badge epic-badge-green' },
    dismissed: { label: 'Declined', className: 'epic-badge epic-badge-red' },
  }
  const entry = map[status] || { label: status, className: 'epic-badge' }
  return <span className={entry.className}>{entry.label}</span>
}

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'urgent') {
    return <span className="epic-badge epic-badge-amber">Urgent</span>
  }
  return <span className="epic-badge" style={{ background: '#F3F4F6', color: 'var(--epic-text-muted)' }}>Routine</span>
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}
