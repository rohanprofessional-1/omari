import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { BuilderEdgeData } from '../../lib/treeToFlow'
import { roundedOrthogonalPath, snapRouteToHandles } from '../../lib/edgeRouting'

/**
 * Custom variable-node branch edge — built for "calm by default, detail on demand".
 *
 * ROUTING (in order of preference):
 *  1. The ROUTER ROUTE — ELK's orthogonal, node-avoiding, crossing-minimised,
 *     lane-separated polyline captured at the last layout pass, snapped to the
 *     live handle coordinates and drawn with rounded corners. Wires stay in
 *     their own lanes and never cut through cards.
 *  2. The TRUNK fallback — when an endpoint card has been dragged off its
 *     layout position (so the router route no longer applies), the edge
 *     braids into its destination's own vertical lane just before the target.
 *  3. A smoothstep path for anything else (same-column / cramped geometry).
 *
 * At REST the line is thin, soft and label-less. On HOVER / SELECT / path
 * trace it becomes `active`: full colour, thicker, and it reveals its short
 * answer caption AT THE SOURCE BUCKET (every bucket has its own row, so
 * captions can never pile on top of each other) plus a destination cue at the
 * arrow end — suppressed when several active edges share the target, where
 * stacked identical chips used to turn traces into a smear.
 *
 * Pure presentation — the wiring (source/target/handles) is unchanged.
 */

/** How far in front of the target the shared trunk lane sits (px). */
const TRUNK_APPROACH = 56
/** Corner radius for the rounded orthogonal trunk routing. */
const TRUNK_RADIUS = 14

/**
 * Build a rounded orthogonal path that funnels into a shared vertical lane at
 * `laneX` just before the target, so all edges to the same destination overlap
 * on that lane → a visible trunk. Falls back to a straight segment when there
 * isn't comfortable room (e.g. a backward or same-column edge) so we never draw
 * something broken.
 */
function buildBundledPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  laneX: number,
): string {
  const minLead = TRUNK_RADIUS * 2
  const leadIn = laneX - sx
  const leadOut = tx - laneX
  if (leadIn < minLead || leadOut < minLead) {
    // Not enough horizontal room to route a clean trunk — keep it simple.
    return `M ${sx},${sy} L ${laneX},${sy} L ${laneX},${ty} L ${tx},${ty}`
  }
  const dy = ty - sy
  if (Math.abs(dy) < 1) {
    // Source and target at the same height — straight through the lane.
    return `M ${sx},${sy} L ${tx},${ty}`
  }
  const dir = dy >= 0 ? 1 : -1
  const r = Math.min(TRUNK_RADIUS, leadIn, leadOut, Math.abs(dy) / 2)
  return [
    `M ${sx},${sy}`,
    `L ${laneX - r},${sy}`,
    `Q ${laneX},${sy} ${laneX},${sy + dir * r}`,
    `L ${laneX},${ty - dir * r}`,
    `Q ${laneX},${ty} ${laneX + r},${ty}`,
    `L ${tx},${ty}`,
  ].join(' ')
}

function BucketEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = data as BuilderEdgeData

  const active = d.highlighted || !!selected
  const dimmed = d.dimmed

  let path: string
  if (d.route && d.route.length >= 2) {
    // The real router route, pinned to the live handle coordinates.
    path = roundedOrthogonalPath(
      snapRouteToHandles(d.route, sourceX, sourceY, targetX, targetY),
      12,
    )
  } else if (d.bundled && !active) {
    // Fallback: braid into the destination's own trunk lane.
    const laneX = targetX - TRUNK_APPROACH - (d.laneOffset ?? 0)
    path = buildBundledPath(sourceX, sourceY, targetX, targetY, laneX)
  } else {
    const [smoothPath] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 14,
    })
    path = smoothPath
  }

  // Three calm-by-default states: active (bright/thick), dimmed (very faint),
  // and rest (soft, thin, desaturated — the serene default).
  const strokeWidth = active ? 3 : dimmed ? 1.3 : 1.4
  const opacity = active ? 1 : dimmed ? 0.07 : 0.36

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: d.color,
          strokeWidth,
          opacity,
          transition: 'opacity 140ms ease, stroke-width 140ms ease',
        }}
      />
      {/* Labels are HIDDEN at rest — revealed only when this edge is active
          (hovered / selected / on a traced path). Zero floating text otherwise. */}
      {active && (
        <EdgeLabelRenderer>
          {/* Answer caption — anchored just past the SOURCE bucket handle.
              Buckets each own a row, so simultaneous captions never overlap. */}
          <div
            className="omari-edge-pill"
            style={{
              transform: `translate(0, -50%) translate(${sourceX + 12}px, ${sourceY - 14}px)`,
              color: d.color,
              borderColor: d.color,
            }}
          >
            {d.label}
          </div>

          {/* Destination cue — short target name just before the arrow end.
              Hidden when several active edges share this target (a traced
              fan-in): the chips would stack and the card is already lit. */}
          {d.showDest && (
            <div
              className="omari-edge-dest"
              style={{
                transform: `translate(-100%, -50%) translate(${targetX - 8}px, ${targetY}px)`,
              }}
            >
              {d.targetName}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default BucketEdge
