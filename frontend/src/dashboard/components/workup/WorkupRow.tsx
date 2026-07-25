import { daysUntil, formatDate } from '../../lib/demoClock'
import { reviewerNameFor, useDashboardStore } from '../../lib/reviewStore'
import { isWorkupDone, type WorkupEntry } from '../../lib/workupMerge'
import Badge from '../shared/Badge'
import UrgencyBadge from '../shared/UrgencyBadge'
import WarningIcon from '../shared/WarningIcon'
import type { DashboardWorkupItem, WorkupStatus } from '../../types'

/**
 * Workup tracking — one referral card. An at-risk card is calm but
 * unmistakable: amber 2px left rail plus an amber-soft banner strip inside
 * the card header (never a whole-card tint). Every item line carries an
 * inline status select — advancing a status writes to the store (audited)
 * and the whole screen restratifies live.
 */

const STATUS_OPTIONS: WorkupStatus[] = ['needed', 'ordered', 'scheduled', 'resulted', 'reviewed']

/** Shared item-line grid so controls align across every card:
 *  at-risk dot · test name · source chip · responsible · due date · status. */
export const ITEM_GRID =
  'grid grid-cols-[16px_minmax(0,1fr)_112px_136px_120px_116px] items-center gap-x-3'

/** 'in 9d' / 'today' / '3d overdue' from a day delta. */
function relativeDays(days: number): string {
  if (days > 0) return `in ${days}d`
  if (days === 0) return 'today'
  return `${-days}d overdue`
}

function ItemLine({
  referralId,
  item,
}: {
  referralId: string
  item: DashboardWorkupItem
}) {
  const { role, setWorkupStatus } = useDashboardStore()
  const done = isWorkupDone(item.status)
  const overdue = daysUntil(item.dueBy) < 0 && !done

  return (
    <li className={`${ITEM_GRID} py-2`}>
      {/* Item-level at-risk dot (spacer keeps names aligned when calm) */}
      <span
        aria-hidden
        title={item.atRisk ? 'At risk — not back yet and due soon' : undefined}
        className={`h-1.5 w-1.5 justify-self-center rounded-full ${
          item.atRisk ? 'bg-dash-amber' : 'bg-dash-line'
        }`}
      />
      <span
        className={`min-w-0 truncate text-dash-body font-medium ${
          done ? 'text-dash-muted' : 'text-dash-ink'
        }`}
        title={item.name}
      >
        {item.name}
      </span>
      <span>
        {item.source === 'conditional' ? (
          <Badge tone="accent" title={item.conditionalReason}>
            path-specific
          </Badge>
        ) : (
          <Badge tone="neutral">standard</Badge>
        )}
      </span>
      <span className="truncate text-dash-micro text-dash-muted" title={item.responsible}>
        {item.responsible}
      </span>
      <span
        className={`text-dash-micro tabular-nums ${
          overdue || item.atRisk ? 'font-medium text-dash-amber' : 'text-dash-muted'
        }`}
      >
        {overdue && (
          <>
            <WarningIcon size={10} />{' '}
          </>
        )}
        due {formatDate(item.dueBy)}
      </span>
      <select
        value={item.status}
        onChange={(e) =>
          setWorkupStatus(referralId, item.name, e.target.value as WorkupStatus, reviewerNameFor(role), role)
        }
        aria-label={`Status of ${item.name}`}
        title="Advance this item — the change is audited and at-risk recomputes live"
        className="w-full rounded-dash-ctl border border-dash-line bg-dash-surface px-2 py-1 text-dash-body text-dash-ink"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </li>
  )
}

export default function WorkupRow({
  entry,
  onOpen,
}: {
  entry: WorkupEntry
  onOpen: (referralId: string) => void
}) {
  const { referral, destination, urgency, visitDate, syntheticVisit, items, outstanding, atRisk } =
    entry
  const id = referral.payload.referralId
  const visitIn = daysUntil(visitDate)

  return (
    <article
      className={`overflow-hidden rounded-dash-card border border-l-2 border-dash-line bg-dash-surface shadow-dash-card ${
        atRisk ? 'border-l-dash-amber' : 'border-l-transparent'
      }`}
    >
      {atRisk && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-dash-line bg-dash-amber-soft px-4 py-1 text-dash-micro">
          <span className="flex shrink-0 items-center gap-1 font-semibold uppercase tracking-wide text-dash-amber">
            <WarningIcon />
            At risk
          </span>
          <span className="min-w-0 truncate tabular-nums text-dash-ink">
            — visit {relativeDays(visitIn)}, {outstanding} item
            {outstanding === 1 ? '' : 's'} outstanding
          </span>
        </div>
      )}

      {/* Referral header line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3">
        <button
          onClick={() => onOpen(id)}
          title="Open the full referral"
          className="min-w-0 truncate text-left text-dash-row text-dash-ink transition-colors hover:text-dash-accent"
        >
          {referral.payload.patient.name}
        </button>
        <span className="min-w-0 truncate text-dash-body text-dash-muted">→ {destination}</span>
        <UrgencyBadge urgency={urgency} />
        <span className="ml-auto shrink-0 text-dash-micro tabular-nums text-dash-muted">
          Visit {formatDate(visitDate)} ·{' '}
          <span className="font-medium text-dash-ink">{relativeDays(visitIn)}</span>
          {syntheticVisit && (
            <span
              className="ml-1 uppercase tracking-wide text-dash-faint"
              title="Demo behavior — no scheduled visit in the fixture, so a visit date is projected from urgency (routine +10d, expedited +5d, urgent +2d)"
            >
              projected
            </span>
          )}
        </span>
      </div>

      {/* Item lines */}
      <ul className="mt-1 divide-y divide-dash-line/60 px-4 pb-3">
        {items.map((item) => (
          <ItemLine key={item.name} referralId={id} item={item} />
        ))}
      </ul>
    </article>
  )
}
