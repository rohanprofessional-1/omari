import type { ReactNode } from 'react'
import type { QueueGroup as QueueGroupId } from '../../types'
import { QUEUE_GROUP_LABELS } from '../../lib/queueStatus'
import SectionBand, { type BandTone } from '../shared/SectionBand'
import { COLUMN_HEADER_H } from './columns'

/**
 * One worklist tier as its OWN card: a tinted band header (dot · label ·
 * count · explainer · controls) over its rows, separated from the next tier
 * by page background. Previously every tier lived in one long card and the
 * boundaries blurred — the card edge is now the boundary.
 *
 * The band pins directly beneath the sticky column header, so scrolling deep
 * into a 13-row tier never loses which tier you are in.
 */

const EXPLAINERS: Record<QueueGroupId, string> = {
  ready: 'In scope, confident routing, nothing missing — approve in bulk.',
  needs_info: 'Blocked on one answer — request it from the referrer or patient.',
  needs_judgment: 'Routed, but ambiguous or low-confidence — review before approving.',
  out_of_scope: 'Probably belongs elsewhere — confirm the suggested redirect.',
  escalated: 'Safety or complexity flag — surgeon review required.',
}

/** Severity dot per tier — quiet status tokens, gradient top→bottom. */
const TONES: Record<QueueGroupId, BandTone> = {
  ready: 'green',
  needs_info: 'amber',
  needs_judgment: 'slate',
  out_of_scope: 'neutral',
  escalated: 'red',
}

/** Stable anchor id so the summary strip can jump straight to a tier. */
export const groupAnchor = (group: QueueGroupId) => `queue-group-${group}`

export default function QueueGroup({
  group,
  count,
  open,
  onToggle,
  headerControls,
  children,
}: {
  group: QueueGroupId
  count: number
  open: boolean
  onToggle: () => void
  headerControls?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      id={groupAnchor(group)}
      className="scroll-mt-9 rounded-dash-card border border-dash-line-strong bg-dash-surface shadow-dash-card [&>div:last-child]:border-b-0 [&>div:last-child]:rounded-b-dash-card"
    >
      <SectionBand
        tone={TONES[group]}
        label={QUEUE_GROUP_LABELS[group]}
        count={count}
        hint={EXPLAINERS[group]}
        open={open}
        onToggle={onToggle}
        stickyTop={COLUMN_HEADER_H}
        controls={open ? headerControls : undefined}
      />
      {open && children}
    </section>
  )
}
