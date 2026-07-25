import { useState } from 'react'
import { describeKeyedCondition } from '../../../lib/conditionText'
import type { WithheldWorkupItem } from '../../../lib/engine'
import { formatDate } from '../../lib/demoClock'
import { useDashboardStore } from '../../lib/reviewStore'
import { mergeWorkupItems } from '../../lib/workupMerge'
import Badge, { type BadgeTone } from '../shared/Badge'
import WarningIcon from '../shared/WarningIcon'
import type { DashboardWorkupItem, WorkupStatus } from '../../types'

/**
 * Dashboard detail — the concrete pre-visit workup checklist the engine
 * resolved for THIS patient's path, with live status, due dates, and anything
 * a do-not-order guard withheld (over-ordering protection made visible).
 * Read-only here; status changes arrive in the next build step.
 */

/** Status pills from the shared Badge family — one idiom everywhere. */
const STATUS_TONES: Record<WorkupStatus, BadgeTone> = {
  needed: 'amber',
  ordered: 'neutral',
  scheduled: 'slate',
  resulted: 'green',
  reviewed: 'green',
}

function WorkupRow({ item }: { item: DashboardWorkupItem }) {
  const [open, setOpen] = useState(false)
  const hasDetail = Boolean(item.protocol || item.rationale)
  return (
    <li className="rounded-dash-ctl border border-dash-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          onClick={() => hasDetail && setOpen((v) => !v)}
          className={`min-w-0 flex-1 text-left text-dash-body font-medium text-dash-ink ${
            hasDetail ? 'transition-colors hover:text-dash-accent' : 'cursor-default'
          }`}
          title={hasDetail ? (open ? 'Hide protocol' : 'Show protocol') : undefined}
        >
          {item.name}
        </button>
        {item.source === 'conditional' ? (
          <Badge tone="accent" title={item.conditionalReason}>
            path-specific
          </Badge>
        ) : (
          <Badge tone="neutral">standard</Badge>
        )}
        <Badge tone={STATUS_TONES[item.status]}>{item.status}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-dash-micro text-dash-muted">
        <span>{item.responsible}</span>
        <span aria-hidden>·</span>
        <span className={item.atRisk ? 'font-medium text-dash-amber' : ''}>
          {item.atRisk && (
            <>
              <WarningIcon />{' '}
            </>
          )}
          due {formatDate(item.dueBy)}
        </span>
      </div>
      {open && hasDetail && (
        <div className="mt-2 space-y-1 border-l-2 border-dash-line pl-2 text-dash-micro leading-snug text-dash-muted">
          {item.protocol && (
            <p>
              <span className="font-medium text-dash-ink">Protocol:</span> {item.protocol}
            </p>
          )}
          {item.rationale && (
            <p>
              <span className="font-medium text-dash-ink">Why:</span> {item.rationale}
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
    return <p className="text-dash-body text-dash-muted">No pre-visit workup required.</p>
  }

  return (
    <ul className="space-y-2">
      {merged.map((item) => (
        <WorkupRow key={item.name} item={item} />
      ))}
      {withheld.map((w) => (
        <li key={w.item} className="rounded-dash-ctl border border-dashed border-dash-line px-3 py-2">
          <p className="text-dash-body font-medium text-dash-muted line-through">{w.item}</p>
          <p className="mt-1 text-dash-micro leading-snug text-dash-muted">
            withheld: requires {describeKeyedCondition(w.requiredCondition)}
          </p>
        </li>
      ))}
    </ul>
  )
}
