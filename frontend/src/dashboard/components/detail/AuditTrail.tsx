import { formatDate } from '../../lib/demoClock'
import { useDashboardStore } from '../../lib/reviewStore'
import type { AuditEvent } from '../../types'

/**
 * Dashboard detail — chronological review activity for one referral, straight
 * from the audit log (newest last). Review actions use the real wall clock,
 * so the trail reads honestly during a demo.
 */

const ACTION_LABELS: Record<AuditEvent['action'], string> = {
  pending: 'Reopened for review',
  approved: 'Approved routing',
  corrected: 'Corrected routing',
  rejected: 'Rejected',
  escalated: 'Escalated to surgeon',
  info_requested: 'Requested information',
  viewed: 'Viewed',
  workup_status_changed: 'Updated workup',
  commented: 'Commented',
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${formatDate(iso)} ${hh}:${mm}`
}

export default function AuditTrail({ referralId }: { referralId: string }) {
  const { audit } = useDashboardStore()
  const events = audit
    .filter((e) => e.referralId === referralId)
    .sort((a, b) => a.at.localeCompare(b.at))

  if (events.length === 0) {
    return <p className="text-[12.5px] text-muted">No review activity yet.</p>
  }

  return (
    <ol className="list-none">
      {events.map((event, i) => (
        <li key={event.id} className="relative flex gap-2.5 pb-2.5 last:pb-0">
          {i < events.length - 1 && (
            <span aria-hidden className="absolute left-[3.5px] top-3 bottom-0 w-px bg-line" />
          )}
          <span aria-hidden className="mt-[6px] h-2 w-2 shrink-0 rounded-full border border-line bg-bg" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] leading-snug text-ink">
              <span className="font-medium">{ACTION_LABELS[event.action]}</span>
              <span className="text-muted"> — {event.actor}</span>
            </p>
            {event.correction && (
              <p className="mt-0.5 text-[11px] leading-snug text-muted">
                {event.correction.field}:{' '}
                <span className="line-through">{event.correction.from}</span> →{' '}
                <span className="font-medium text-ink">{event.correction.to}</span>
                {event.correction.reason && <> — {event.correction.reason}</>}
              </p>
            )}
            {event.note && <p className="mt-0.5 text-[11px] leading-snug text-muted">{event.note}</p>}
            <p className="mt-0.5 text-[10.5px] tabular-nums text-muted">{timeOf(event.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
