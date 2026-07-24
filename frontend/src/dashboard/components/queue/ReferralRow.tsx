import type { ReviewState, ReviewableReferral } from '../../types'
import { DEMO_NOW, ageFromDob, waitingSince } from '../../lib/demoClock'
import ChannelBadge from '../shared/ChannelBadge'
import ConfidencePill from '../shared/ConfidencePill'
import UrgencyBadge from '../shared/UrgencyBadge'

/**
 * One scannable queue row. Fixed grid columns so 60 rows read as a table; no
 * wrapping — truncate with title attrs. ~40px tall.
 */

/** Shared column template — keeps every group's rows aligned. */
export const ROW_GRID =
  'grid grid-cols-[20px_180px_74px_200px_minmax(140px,1fr)_230px_64px_76px_44px] items-center gap-x-2'

const MS_PER_DAY = 86_400_000

export default function ReferralRow({
  referral,
  review,
  selectable = false,
  selected = false,
  onToggle,
  onOpen,
}: {
  referral: ReviewableReferral
  review?: ReviewState
  selectable?: boolean
  selected?: boolean
  onToggle?: (referralId: string) => void
  onOpen: (referralId: string) => void
}) {
  const { payload, result } = referral
  const id = payload.referralId
  const age = ageFromDob(payload.patient.dob)
  const missing = result.missingVariables.length
  const infoRequested = review?.status === 'info_requested'
  const waitedDays = (DEMO_NOW.getTime() - new Date(payload.receivedAt).getTime()) / MS_PER_DAY
  const stale = waitedDays > 3

  return (
    <div
      onClick={() => onOpen(id)}
      className={`${ROW_GRID} h-10 cursor-pointer border-b border-line/60 px-4 text-[12.5px] hover:bg-sky/50 ${
        selected ? 'bg-sky/40' : ''
      }`}
    >
      {/* Checkbox — ready group only; empty spacer elsewhere keeps alignment */}
      <span className="flex items-center">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle?.(id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${payload.patient.name}`}
          />
        )}
      </span>

      {/* Patient */}
      <span className="truncate" title={`${payload.patient.name} · ${payload.patient.mrn}`}>
        <span className="font-medium text-ink">{payload.patient.name}</span>{' '}
        <span className="text-muted">
          {age}
          {payload.patient.sex}
        </span>
      </span>

      {/* Channel */}
      <span>
        <ChannelBadge channel={payload.channel} />
      </span>

      {/* Referring provider (practice muted) */}
      <span className="truncate" title={`${payload.referredBy.provider} — ${payload.referredBy.practice}`}>
        <span className="text-ink">{payload.referredBy.provider}</span>{' '}
        <span className="text-[11.5px] text-muted">{payload.referredBy.practice}</span>
      </span>

      {/* Reason */}
      <span className="truncate text-muted" title={payload.reasonForReferral}>
        {payload.reasonForReferral}
      </span>

      {/* Destination + urgency */}
      <span className="flex min-w-0 items-center gap-1.5">
        <Destination referral={referral} />
        {result.urgency && result.urgency !== 'routine' && <UrgencyBadge urgency={result.urgency} />}
      </span>

      {/* Confidence */}
      <span>
        <ConfidencePill level={result.confidence} title={result.confidenceReason} />
      </span>

      {/* Missing info count — or the 'requested' sub-pill once info was asked for */}
      {infoRequested ? (
        <span>
          <span
            className="inline-flex rounded bg-sky px-1.5 py-0.5 text-[10px] font-medium text-accent-strong"
            title={`Information requested by ${review?.reviewer ?? 'reviewer'} — still waiting${
              missing > 0 ? ` (${missing} missing)` : ''
            }`}
          >
            requested
          </span>
        </span>
      ) : (
        <span className={missing > 0 ? 'font-medium text-danger' : 'text-muted'}>
          {missing > 0 ? `${missing} missing` : '—'}
        </span>
      )}

      {/* Waiting time */}
      <span
        className={`text-right tabular-nums ${stale ? 'font-medium text-danger' : 'text-muted'}`}
        title={`Received ${payload.receivedAt.replace('T', ' ')}`}
      >
        {waitingSince(payload.receivedAt)}
      </span>
    </div>
  )
}

function Destination({ referral }: { referral: ReviewableReferral }) {
  const { result } = referral
  if (result.escalated) {
    return (
      <span className="truncate font-medium text-danger" title={result.escalationReason}>
        No path — needs surgeon
      </span>
    )
  }
  if (!result.inScope) {
    return (
      <span className="truncate italic text-muted" title={`Suggested redirect: ${result.suggestedRedirect ?? '—'}`}>
        → {result.suggestedRedirect ?? 'Redirect'}
      </span>
    )
  }
  if (result.routedTo) {
    return (
      <span className="truncate text-ink" title={`${result.routedTo.specialistName} — ${result.routedTo.specialty}`}>
        → {result.routedTo.specialistName}
      </span>
    )
  }
  return <span className="truncate text-muted">Awaiting info</span>
}
