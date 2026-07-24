import type { ReviewState, ReviewableReferral } from '../../types'
import { DEMO_NOW, ageFromDob, waitingSince } from '../../lib/demoClock'
import Badge from '../shared/Badge'
import ChannelBadge from '../shared/ChannelBadge'
import ConfidencePill from '../shared/ConfidencePill'
import UrgencyBadge from '../shared/UrgencyBadge'

/**
 * One scannable queue row. Fixed grid columns so 60 rows read as a table; no
 * wrapping — truncate with title attrs. Patient name and destination are the
 * two anchors; provider/practice/reason are support. Attention tiers get a
 * quiet 2px left rail (amber / red); ready rows get none.
 */

/** Shared column template — keeps every group's rows AND the completed strip
 *  aligned: checkbox · patient · channel · provider/practice · reason ·
 *  destination · priority+confidence · missing/meta · waiting. */
export const ROW_GRID =
  'grid grid-cols-[24px_184px_72px_190px_minmax(120px,1fr)_190px_124px_80px_52px] items-center gap-x-3'

/** Quiet status rail on attention-tier rows (Phase 5) — presentation only. */
export type RowRail = 'amber' | 'red'

const RAIL: Record<RowRail, string> = {
  amber: 'border-l-dash-amber',
  red: 'border-l-dash-red',
}

const MS_PER_DAY = 86_400_000

export default function ReferralRow({
  referral,
  review,
  selectable = false,
  selected = false,
  rail,
  onToggle,
  onOpen,
}: {
  referral: ReviewableReferral
  review?: ReviewState
  selectable?: boolean
  selected?: boolean
  rail?: RowRail
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
      className={`${ROW_GRID} h-12 cursor-pointer border-b border-l-2 border-b-dash-line px-4 transition-colors ${
        rail ? RAIL[rail] : 'border-l-transparent'
      } ${selected ? 'bg-dash-accent-soft' : 'hover:bg-dash-bg'}`}
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
            className="h-4 w-4 accent-dash-accent-strong"
          />
        )}
      </span>

      {/* Patient — the anchor: name in row-primary ink, age/sex in micro meta */}
      <span
        className="flex min-w-0 items-baseline gap-1"
        title={`${payload.patient.name} · ${payload.patient.mrn}`}
      >
        <span className="truncate text-dash-row text-dash-ink">{payload.patient.name}</span>
        <span className="shrink-0 text-dash-micro text-dash-faint tabular-nums">
          {age}
          {payload.patient.sex}
        </span>
      </span>

      {/* Channel */}
      <span>
        <ChannelBadge channel={payload.channel} />
      </span>

      {/* Referring provider — support; practice on its own micro line */}
      <span
        className="min-w-0"
        title={`${payload.referredBy.provider} — ${payload.referredBy.practice}`}
      >
        <span className="block truncate text-dash-body text-dash-strong">
          {payload.referredBy.provider}
        </span>
        <span className="block truncate text-dash-micro text-dash-faint">
          {payload.referredBy.practice}
        </span>
      </span>

      {/* Reason — support */}
      <span className="truncate text-dash-body text-dash-muted" title={payload.reasonForReferral}>
        {payload.reasonForReferral}
      </span>

      {/* Destination — the second anchor, its own column */}
      <span className="min-w-0">
        <Destination referral={referral} />
      </span>

      {/* Priority + confidence */}
      <span className="flex items-center gap-1">
        {result.urgency && result.urgency !== 'routine' && <UrgencyBadge urgency={result.urgency} />}
        <ConfidencePill level={result.confidence} title={result.confidenceReason} />
      </span>

      {/* Missing info count — or the 'requested' badge once info was asked for */}
      <span>
        {infoRequested ? (
          <Badge
            tone="accent"
            title={`Information requested by ${review?.reviewer ?? 'reviewer'} — still waiting${
              missing > 0 ? ` (${missing} missing)` : ''
            }`}
          >
            requested
          </Badge>
        ) : missing > 0 ? (
          <Badge tone="amber" className="tabular-nums">
            {missing} missing
          </Badge>
        ) : (
          <span className="text-dash-micro text-dash-faint">—</span>
        )}
      </span>

      {/* Waiting time */}
      <span
        className={`text-right text-dash-micro tabular-nums ${
          stale ? 'font-medium text-dash-amber' : 'text-dash-muted'
        }`}
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
      <Badge tone="red" className="max-w-full" title={result.escalationReason}>
        <span className="truncate">No path — needs surgeon</span>
      </Badge>
    )
  }
  if (!result.inScope) {
    return (
      <span
        className="flex min-w-0 items-center gap-1 text-dash-body text-dash-muted"
        title={`Suggested redirect: ${result.suggestedRedirect ?? '—'}`}
      >
        <span aria-hidden className="shrink-0 text-dash-faint">
          →
        </span>
        <span className="truncate italic">{result.suggestedRedirect ?? 'Redirect'}</span>
      </span>
    )
  }
  if (result.routedTo) {
    return (
      <span
        className="flex min-w-0 items-center gap-1 text-dash-body"
        title={`${result.routedTo.specialistName} — ${result.routedTo.specialty}`}
      >
        <span aria-hidden className="shrink-0 text-dash-faint">
          →
        </span>
        <span className="truncate font-medium text-dash-ink">{result.routedTo.specialistName}</span>
      </span>
    )
  }
  return <span className="block truncate text-dash-body text-dash-faint">Awaiting info</span>
}
