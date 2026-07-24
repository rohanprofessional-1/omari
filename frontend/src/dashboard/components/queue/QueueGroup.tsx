import type { ReactNode } from 'react'
import type { QueueGroup as QueueGroupId } from '../../types'
import { QUEUE_GROUP_LABELS } from '../../lib/queueStatus'

/**
 * One worklist group: sticky header (label + count chip + one-line explainer)
 * over its referral rows. Header controls (select-all, bulk bar) slot in for
 * the ready group.
 */

const EXPLAINERS: Record<QueueGroupId, string> = {
  ready: 'In scope, confident routing, nothing missing — approve in bulk.',
  needs_info: 'Blocked on one answer — request it from the referrer or patient.',
  needs_judgment: 'Routed, but ambiguous or low-confidence — review before approving.',
  out_of_scope: 'Probably belongs elsewhere — confirm the suggested redirect.',
  escalated: 'Safety or complexity flag — surgeon review required.',
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
      <header className="sticky top-0 z-[1] flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-1.5 backdrop-blur">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
          {QUEUE_GROUP_LABELS[group]}
        </h3>
        <span className="rounded bg-sky px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-strong">
          {count}
        </span>
        <p className="hidden truncate text-[11.5px] text-muted md:block">{EXPLAINERS[group]}</p>
        {headerControls && <div className="ml-auto flex items-center gap-2">{headerControls}</div>}
      </header>
      {children}
    </section>
  )
}
