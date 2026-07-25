import type { QueueGroup as QueueGroupId } from '../../types'
import { QUEUE_GROUP_LABELS, QUEUE_GROUP_ORDER } from '../../lib/queueStatus'
import { groupAnchor } from './QueueGroup'

/**
 * The whole queue in one line, above the fold.
 *
 * With 13 ready referrals the escalated and out-of-scope tiers sat a full
 * screen below the fold — you had to scroll to learn they existed. These
 * counts are always visible, and each one jumps to its tier.
 */

const DOTS: Record<QueueGroupId, string> = {
  ready: 'bg-dash-green',
  needs_info: 'bg-dash-amber',
  needs_judgment: 'bg-dash-slate',
  out_of_scope: 'bg-dash-faint',
  escalated: 'bg-dash-red',
}

export default function QueueSummary({
  counts,
  doneCount,
}: {
  counts: Map<QueueGroupId, number>
  doneCount: number
}) {
  const jump = (group: QueueGroupId) => {
    const el = document.getElementById(groupAnchor(group))
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const open = QUEUE_GROUP_ORDER.reduce((n, g) => n + (counts.get(g) ?? 0), 0)

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {QUEUE_GROUP_ORDER.map((group) => {
        const count = counts.get(group) ?? 0
        return (
          <button
            key={group}
            type="button"
            disabled={count === 0}
            onClick={() => jump(group)}
            title={count === 0 ? undefined : `Jump to ${QUEUE_GROUP_LABELS[group]}`}
            className="inline-flex items-center gap-2 rounded-dash-ctl border border-dash-line-strong bg-dash-surface px-2.5 py-1.5 transition-colors enabled:hover:border-dash-faint disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent"
          >
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[group]}`} />
            <span className="text-dash-micro text-dash-muted">{QUEUE_GROUP_LABELS[group]}</span>
            <span className="text-dash-micro font-semibold tabular-nums text-dash-ink">{count}</span>
          </button>
        )
      })}
      <span className="ml-auto text-dash-micro tabular-nums text-dash-muted">
        {open} open · {doneCount} completed today
      </span>
    </div>
  )
}
