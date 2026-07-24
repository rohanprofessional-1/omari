import { daysUntil, formatDate } from '../../lib/demoClock'
import { reviewerNameFor, useDashboardStore } from '../../lib/reviewStore'
import { isWorkupDone, type WorkupEntry } from '../../lib/workupMerge'
import UrgencyBadge from '../shared/UrgencyBadge'
import WarningIcon from '../shared/WarningIcon'
import type { DashboardWorkupItem, WorkupStatus } from '../../types'

/**
 * Workup tracking — one referral card. An at-risk card is unmistakable: red
 * left border, red-tinted fill, and a danger banner counting down to the
 * visit. Every item line carries an inline status select — advancing a status
 * writes to the store (audited) and the whole screen restratifies live.
 */

const STATUS_OPTIONS: WorkupStatus[] = ['needed', 'ordered', 'scheduled', 'resulted', 'reviewed']

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
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
      {/* Item-level at-risk dot (spacer keeps names aligned when calm) */}
      <span
        aria-hidden
        title={item.atRisk ? 'At risk — not back yet and due soon' : undefined}
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.atRisk ? 'bg-danger' : 'bg-line'}`}
      />
      <span
        className={`min-w-0 flex-1 truncate text-[12.5px] font-medium ${done ? 'text-muted' : 'text-ink'}`}
        title={item.name}
      >
        {item.name}
      </span>
      {item.source === 'conditional' ? (
        <span
          title={item.conditionalReason}
          className="inline-flex shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-accent-strong"
        >
          path-specific
        </span>
      ) : (
        <span className="inline-flex shrink-0 rounded border border-line bg-bg px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.05em] text-muted">
          standard
        </span>
      )}
      <span className="hidden shrink-0 text-[11px] text-muted sm:inline">{item.responsible}</span>
      <span
        className={`shrink-0 text-[11px] tabular-nums ${
          overdue || item.atRisk ? 'font-medium text-danger' : 'text-muted'
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
        className="shrink-0 rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-ink"
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
      className={`overflow-hidden rounded-xl border bg-canvas ${
        atRisk ? 'border-line border-l-4 border-l-danger bg-danger/5' : 'border-line'
      }`}
    >
      {atRisk && (
        <div className="flex items-center gap-1.5 border-b border-danger/20 bg-danger/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-danger">
          <WarningIcon />
          <span className="min-w-0 truncate">
            At risk — visit {relativeDays(visitIn)}, {outstanding} item
            {outstanding === 1 ? '' : 's'} outstanding
          </span>
        </div>
      )}

      {/* Referral header line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2.5">
        <button
          onClick={() => onOpen(id)}
          title="Open the full referral"
          className="min-w-0 truncate text-left text-[13px] font-semibold text-ink hover:text-accent-strong"
        >
          {referral.payload.patient.name}
        </button>
        <span className="min-w-0 truncate text-[12px] text-muted">→ {destination}</span>
        <UrgencyBadge urgency={urgency} />
        <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-muted">
          Visit {formatDate(visitDate)} · <span className="font-medium text-ink">{relativeDays(visitIn)}</span>
          {syntheticVisit && (
            <span
              className="ml-1 text-[10px] uppercase tracking-[0.05em]"
              title="Demo behavior — no scheduled visit in the fixture, so a visit date is projected from urgency (routine +10d, expedited +5d, urgent +2d)"
            >
              projected
            </span>
          )}
        </span>
      </div>

      {/* Item lines */}
      <ul className="mt-1 divide-y divide-line/60 px-3 pb-2">
        {items.map((item) => (
          <ItemLine key={item.name} referralId={id} item={item} />
        ))}
      </ul>
    </article>
  )
}
