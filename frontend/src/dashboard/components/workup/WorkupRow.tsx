import { daysUntil, formatDate, formatDateShort } from '../../lib/demoClock'
import { reviewerNameFor, useDashboardStore } from '../../lib/reviewStore'
import { isWorkupDone, type WorkupEntry } from '../../lib/workupMerge'
import Badge from '../shared/Badge'
import SignalDot from '../shared/SignalDot'
import UrgencyBadge from '../shared/UrgencyBadge'
import WarningIcon from '../shared/WarningIcon'
import type { DashboardWorkupItem, WorkupStatus } from '../../types'

/**
 * Workup tracking — one referral as a row inside its stratum card.
 *
 * The header line answers the three chasing questions in a fixed order: WHO
 * (patient → destination), HOW FAR ALONG (a segment per item, plus the count),
 * and HOW LONG LEFT (visit distance). There is no "AT RISK" banner: with eight
 * at-risk referrals stacked, a banner on every one of them distinguished
 * nothing — the stratum band says it once, and the amber rail, the amber visit
 * distance and the amber item dots say which parts are actually late.
 *
 * Item lines keep their columns (they must align down the card) but the meta
 * now sits next to the test name instead of a screen away from it, and only
 * EXCEPTIONS are chipped: 'path-specific' is worth a chip, 'standard' is not.
 * The status control carries the pipeline as colour — gray → blue-gray → blue
 * → green — while amber stays reserved for risk.
 */

const STATUS_OPTIONS: WorkupStatus[] = ['needed', 'ordered', 'scheduled', 'resulted', 'reviewed']

/**
 * Progress, not risk — a tonal ramp rather than a hue ramp: empty white →
 * two steps of gray fill → the solid GO signal once the result is in. Amber
 * stays out of this control entirely; risk is the dot's job.
 */
const STATUS_CTL: Record<WorkupStatus, string> = {
  needed: 'border-dash-line-strong bg-dash-surface text-dash-ink',
  ordered: 'border-transparent bg-dash-header text-dash-strong',
  scheduled: 'border-transparent bg-dash-neutral-soft text-dash-ink',
  resulted: 'border-transparent bg-dash-green text-dash-ink',
  reviewed: 'border-transparent bg-dash-green text-dash-ink',
}

/**
 * Item-line grid: at-risk dot · test name · who owes it · when it's due ·
 * status. The name track is capped so its meta sits beside it rather than
 * across a 400px gap; the trailing 1fr parks the one control on the right
 * edge, where the eye can run straight down the column of them.
 */
export const ITEM_GRID =
  'grid grid-cols-[14px_minmax(0,26rem)_104px_136px_1fr] items-center gap-x-3'

/** 'in 9d' / 'today' / '3d overdue' from a day delta. */
function relativeDays(days: number): string {
  if (days > 0) return `in ${days}d`
  if (days === 0) return 'today'
  return `${-days}d overdue`
}

/** One segment per item — filled green when it's back, amber when it's late. */
function Progress({ items }: { items: DashboardWorkupItem[] }) {
  const done = items.filter((item) => isWorkupDone(item.status)).length
  return (
    <span
      className="flex shrink-0 items-center gap-2"
      title={`${done} of ${items.length} back · ${items.length - done} outstanding`}
    >
      <span aria-hidden className="flex items-center gap-1">
        {items.map((item) => (
          <span
            key={item.name}
            className={`h-1 w-4 rounded-full ${
              isWorkupDone(item.status)
                ? 'bg-dash-green'
                : item.atRisk
                  ? 'bg-dash-amber'
                  : 'bg-dash-line-strong'
            }`}
          />
        ))}
      </span>
      <span className="text-dash-micro tabular-nums text-dash-muted">
        {done}/{items.length}
      </span>
    </span>
  )
}

function ItemLine({ referralId, item }: { referralId: string; item: DashboardWorkupItem }) {
  const { role, setWorkupStatus } = useDashboardStore()
  const done = isWorkupDone(item.status)
  const dueIn = daysUntil(item.dueBy)
  const overdue = dueIn < 0 && !done
  const late = overdue || item.atRisk

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

      {/* Name — plus a chip ONLY when this test is specific to the tree path */}
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`truncate text-dash-body font-medium ${
            done ? 'text-dash-muted' : 'text-dash-ink'
          }`}
          title={item.name}
        >
          {item.name}
        </span>
        {item.source === 'conditional' && (
          <Badge tone="accent" title={item.conditionalReason}>
            path-specific
          </Badge>
        )}
      </span>

      <span className="truncate text-dash-micro text-dash-muted" title={`Owed by the ${item.responsible}`}>
        {item.responsible}
      </span>

      {/* Due — the distance leads, the calendar date confirms it */}
      <span
        className="min-w-0 truncate text-dash-micro tabular-nums"
        title={`Due ${formatDate(item.dueBy)}`}
      >
        {late && !done && (
          <span className="text-dash-ink">
            <WarningIcon size={10} />{' '}
          </span>
        )}
        <span className={late && !done ? 'font-semibold text-dash-ink' : 'text-dash-muted'}>
          due {relativeDays(dueIn)}
        </span>{' '}
        <span className="text-dash-faint">{formatDateShort(item.dueBy)}</span>
      </span>

      <select
        value={item.status}
        onChange={(e) =>
          setWorkupStatus(referralId, item.name, e.target.value as WorkupStatus, reviewerNameFor(role), role)
        }
        aria-label={`Status of ${item.name}`}
        title="Advance this item — the change is audited and at-risk recomputes live"
        className={`w-28 justify-self-end rounded-dash-ctl border px-2 py-1 text-dash-micro font-medium transition-colors ${STATUS_CTL[item.status]}`}
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
  const { referral, destination, urgency, visitDate, syntheticVisit, items, atRisk } = entry
  const id = referral.payload.referralId
  const visitIn = daysUntil(visitDate)

  return (
    <article
      className={`border-b border-l-2 border-b-dash-line px-4 py-2 ${
        atRisk ? 'border-l-dash-amber' : 'border-l-transparent'
      }`}
    >
      {/* Header line — who · where · how far along · how long left */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 items-center gap-x-2">
          <button
            onClick={() => onOpen(id)}
            title="Open the full referral"
            className="min-w-0 truncate text-left text-dash-row text-dash-ink transition-colors hover:text-dash-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent"
          >
            {referral.payload.patient.name}
          </button>
          <span className="min-w-0 truncate text-dash-body text-dash-muted" title={destination}>
            → {destination}
          </span>
          <UrgencyBadge urgency={urgency} />
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <Progress items={items} />
          <span
            className={`flex shrink-0 items-center gap-1 text-dash-micro tabular-nums ${
              atRisk ? 'font-semibold text-dash-ink' : 'text-dash-muted'
            }`}
            title={`Visit ${formatDate(visitDate)}`}
          >
            {atRisk && <SignalDot tone="amber" title="At risk — tests not back and the visit is close" />}
            visit {relativeDays(visitIn)}{' '}
            <span className="font-normal text-dash-faint">{formatDateShort(visitDate)}</span>
            {syntheticVisit && (
              <span
                className="ml-1 font-normal uppercase tracking-wide text-dash-faint"
                title="Demo behavior — no scheduled visit in the fixture, so a visit date is projected from urgency (routine +10d, expedited +5d, urgent +2d)"
              >
                projected
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Item lines */}
      <ul className="mt-1 divide-y divide-dash-line/60">
        {items.map((item) => (
          <ItemLine key={item.name} referralId={id} item={item} />
        ))}
      </ul>
    </article>
  )
}
