import { useState } from 'react'
import { describeKeyedCondition } from '../../../lib/conditionText'
import type { WithheldWorkupItem } from '../../../lib/engine'
import { formatDate, isAtRisk } from '../../lib/demoClock'
import { useDashboardStore } from '../../lib/reviewStore'
import type { DashboardWorkupItem, WorkupStatus } from '../../types'

/**
 * Dashboard detail — the concrete pre-visit workup checklist the engine
 * resolved for THIS patient's path, with live status, due dates, and anything
 * a do-not-order guard withheld (over-ordering protection made visible).
 * Read-only here; status changes arrive in the next build step.
 */

const STATUS_STYLES: Record<WorkupStatus, string> = {
  needed: 'border border-line bg-bg text-muted',
  ordered: 'bg-accent/10 text-accent-strong',
  scheduled: 'bg-sky text-accent-strong',
  resulted: 'bg-success-soft text-success-deep',
  reviewed: 'bg-success-soft text-success-deep',
}

function WarningIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="inline-block align-[-1px]"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}

function WorkupRow({ item }: { item: DashboardWorkupItem }) {
  const [open, setOpen] = useState(false)
  const hasDetail = Boolean(item.protocol || item.rationale)
  return (
    <li className="rounded-lg border border-line px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          onClick={() => hasDetail && setOpen((v) => !v)}
          className={`min-w-0 flex-1 text-left text-[12.5px] font-medium text-ink ${
            hasDetail ? 'hover:text-accent-strong' : 'cursor-default'
          }`}
          title={hasDetail ? (open ? 'Hide protocol' : 'Show protocol') : undefined}
        >
          {item.name}
        </button>
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
        <span
          className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${STATUS_STYLES[item.status]}`}
        >
          {item.status}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted">
        <span>{item.responsible}</span>
        <span aria-hidden>·</span>
        <span className={item.atRisk ? 'font-medium text-danger' : ''}>
          {item.atRisk && (
            <>
              <WarningIcon />{' '}
            </>
          )}
          due {formatDate(item.dueBy)}
        </span>
      </div>
      {open && hasDetail && (
        <div className="mt-1.5 space-y-0.5 border-l-2 border-line pl-2 text-[12px] leading-snug text-muted">
          {item.protocol && (
            <p>
              <span className="font-medium text-ink">Protocol:</span> {item.protocol}
            </p>
          )}
          {item.rationale && (
            <p>
              <span className="font-medium text-ink">Why:</span> {item.rationale}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export default function WorkupList({
  referralId,
  items,
  withheld,
  visitDate,
}: {
  referralId: string
  items: DashboardWorkupItem[]
  withheld: WithheldWorkupItem[]
  visitDate?: string
}) {
  const { workupOverrides } = useDashboardStore()
  const overrides = workupOverrides[referralId] ?? {}
  // Live status overrides (from review actions) win over the fixture state;
  // at-risk is recomputed so a resulted item stops shouting.
  const merged = items.map((item) => {
    const status = overrides[item.name] ?? item.status
    return status === item.status
      ? item
      : { ...item, status, atRisk: isAtRisk({ status, dueBy: item.dueBy }, visitDate) }
  })

  if (merged.length === 0 && withheld.length === 0) {
    return <p className="text-[12.5px] text-muted">No pre-visit workup required.</p>
  }

  return (
    <ul className="space-y-1.5">
      {merged.map((item) => (
        <WorkupRow key={item.name} item={item} />
      ))}
      {withheld.map((w) => (
        <li key={w.item} className="rounded-lg border border-dashed border-line px-2.5 py-2">
          <p className="text-[12.5px] font-medium text-muted line-through">{w.item}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            withheld: requires {describeKeyedCondition(w.requiredCondition)}
          </p>
        </li>
      ))}
    </ul>
  )
}
