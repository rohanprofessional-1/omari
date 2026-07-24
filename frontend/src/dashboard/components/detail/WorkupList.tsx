import { useState } from 'react'
import { describeKeyedCondition } from '../../../lib/conditionText'
import type { WithheldWorkupItem } from '../../../lib/engine'
import { formatDate } from '../../lib/demoClock'
import { useDashboardStore } from '../../lib/reviewStore'
import { mergeWorkupItems } from '../../lib/workupMerge'
import WarningIcon from '../shared/WarningIcon'
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
  // Shared merge (lib/workupMerge): live status overrides win over the fixture
  // state, and at-risk is recomputed so a resulted item stops shouting.
  const merged = mergeWorkupItems(items, workupOverrides[referralId] ?? {}, visitDate)

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
