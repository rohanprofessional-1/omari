import type { ReactNode } from 'react'
import type { QueueGroup as QueueGroupId } from '../../types'
import { QUEUE_GROUP_LABELS } from '../../lib/queueStatus'

/**
 * One worklist group: sticky band header (6px status dot + uppercase label +
 * tabular count + one-line explainer) over its referral rows. Header controls
 * (select-all, bulk bar) slot in for the ready group. Dots read as a quiet
 * severity gradient top→bottom.
 */

const EXPLAINERS: Record<QueueGroupId, string> = {
  ready: 'In scope, confident routing, nothing missing — approve in bulk.',
  needs_info: 'Blocked on one answer — request it from the referrer or patient.',
  needs_judgment: 'Routed, but ambiguous or low-confidence — review before approving.',
  out_of_scope: 'Probably belongs elsewhere — confirm the suggested redirect.',
  escalated: 'Safety or complexity flag — surgeon review required.',
}

/** 6px severity dot per tier — status tokens, kept quiet. */
const DOTS: Record<QueueGroupId, string> = {
  ready: 'bg-dash-green',
  needs_info: 'bg-dash-amber',
  needs_judgment: 'bg-dash-slate',
  out_of_scope: 'bg-dash-faint',
  escalated: 'bg-dash-red',
}

export default function QueueGroup({
  group,
  count,
  headerControls,
  children,
}: {
  group: QueueGroupId
  count: number
  headerControls?: ReactNode
  children: ReactNode
}) {
  return (
    <section>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-dash-line bg-dash-surface px-4 py-2">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[group]}`} />
        <h3 className="text-dash-band uppercase text-dash-strong">{QUEUE_GROUP_LABELS[group]}</h3>
        <span className="text-dash-band tabular-nums text-dash-faint">{count}</span>
        <p className="hidden min-w-0 truncate text-dash-micro text-dash-faint md:block">
          {EXPLAINERS[group]}
        </p>
        {headerControls && <div className="ml-auto flex shrink-0 items-center gap-2">{headerControls}</div>}
      </header>
      {children}
    </section>
  )
}
