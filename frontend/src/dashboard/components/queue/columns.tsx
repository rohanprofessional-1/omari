/**
 * The queue's column contract — one place, so the header row, every referral
 * row and the completed strip cannot drift apart.
 *
 * Ten columns: checkbox · patient · source · referring provider · reason ·
 * routed to · priority · confidence · missing info · waiting.
 *
 * `border-l-2 border-l-transparent` appears on the header too (not just rows)
 * because attention rows spend that 2px on their status rail — without it the
 * header would sit 2px left of every cell it labels.
 */

export const ROW_GRID =
  'grid grid-cols-[24px_180px_64px_172px_minmax(112px,1fr)_180px_78px_88px_76px_68px] items-center gap-x-3'

/**
 * Shared left-edge geometry: rail gutter + cell padding. The gutter is
 * COLOURLESS here on purpose — attention rows add `border-l-dash-amber` etc.
 * and if this string also carried `border-l-transparent` the winner would come
 * down to stylesheet order, not intent, and the rails would silently vanish.
 * Callers with no rail pass RAIL_NONE.
 */
export const ROW_EDGE = 'border-l-2 px-4'

/** Explicit "no status rail" — keeps the 2px gutter, paints nothing. */
export const RAIL_NONE = 'border-l-transparent'

/** Column header height — group bands stick directly beneath it. */
export const COLUMN_HEADER_H = 36

/**
 * Sticky column header. Every label answers a question the raw cell can't:
 * "expedited" is a Priority, "High" is a Confidence, "17h" is how long the
 * referral has been Waiting.
 */
export default function QueueColumnHeader() {
  return (
    <div
      className={`${ROW_GRID} ${ROW_EDGE} ${RAIL_NONE} sticky top-0 z-20 h-9 rounded-dash-card border border-dash-line-strong bg-dash-header text-dash-col uppercase text-dash-muted [&>span]:truncate`}
    >
      <span />
      <span>Patient</span>
      <span title="How the referral arrived">Source</span>
      <span>Referring provider</span>
      <span>Reason for referral</span>
      <span>Routed to</span>
      <span title="Routing urgency proposed by the decision tree">Priority</span>
      <span title="How confident the tree is in this routing">Confidence</span>
      <span title="Required answers the referral is still missing">Missing</span>
      <span className="text-right" title="Time since the referral was received">
        Waiting
      </span>
    </div>
  )
}
