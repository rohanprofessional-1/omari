import type { ReviewState, ReviewableReferral } from '../../types'
import { DEMO_NOW, ageFromDob, waitingSince } from '../../lib/demoClock'
import Badge from '../shared/Badge'
import { ChannelMark } from '../shared/ChannelBadge'
import ConfidencePill from '../shared/ConfidencePill'
import UrgencyBadge from '../shared/UrgencyBadge'
import { RAIL_NONE, ROW_EDGE, ROW_GRID } from './columns'

/**
 * One scannable queue row, aligned to the shared column contract in
 * ./columns. No wrapping — truncate with title attrs. Patient name and
 * destination are the two anchors; provider/practice/reason are support.
 * Attention tiers get a quiet 2px left rail (amber / red); ready rows none.
 *
 * Colour discipline: a cell only earns a tinted chip when it is an EXCEPTION.
 * The common case (routine priority, high confidence, nothing missing) reads
 * as plain quiet text, so the eye lands on the handful of rows that differ.
 */

/** Quiet status rail on attention-tier rows — presentation only. */
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
  const urgency = result.urgency && result.urgency !== 'routine' ? result.urgency : null

  return (
    <div
      onClick={() => onOpen(id)}
      className={`${ROW_GRID} ${ROW_EDGE} h-12 cursor-pointer border-b border-b-dash-line transition-colors ${
        rail ? RAIL[rail] : RAIL_NONE
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
        className="flex min-w-0 items-baseline gap-1.5"
        title={`${payload.patient.name} · ${payload.patient.mrn || 'No MRN'}`}
      >
        <span className="truncate text-dash-row text-dash-ink">{payload.patient.name}</span>
        <span className="shrink-0 text-dash-micro tabular-nums text-dash-faint">
          {age !== null ? age : ''}
          {payload.patient.sex && payload.patient.sex !== 'Unknown' ? payload.patient.sex : (age === null ? 'Unknown' : '')}
        </span>
      </span>

      {/* Source */}
      <span className="min-w-0">
        <ChannelMark channel={payload.channel} />
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

      {/* Priority — chip only when it is not routine */}
      <span className="min-w-0">
        {urgency ? (
          <UrgencyBadge urgency={urgency} />
        ) : (
          <span className="text-dash-micro text-dash-faint">Routine</span>
        )}
      </span>

      {/* Confidence — chip only when the tree is unsure */}
      <span className="min-w-0">
        {result.confidence === 'high' ? (
          <span className="text-dash-micro text-dash-muted" title={result.confidenceReason}>
            High
          </span>
        ) : (
          <ConfidencePill level={result.confidence} title={result.confidenceReason} />
        )}
      </span>

      {/* Missing info count — or the 'requested' badge once info was asked for */}
      <span className="min-w-0">
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
          <span className="text-dash-micro text-dash-faint">None</span>
        )}
      </span>

      {/* Waiting — time since received */}
      <span
        className={`text-right text-dash-micro tabular-nums ${
          stale ? 'font-semibold text-dash-ink' : 'text-dash-muted'
        }`}
        title={`Waiting ${waitingSince(payload.receivedAt)} — received ${payload.receivedAt.replace('T', ' ')}`}
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
