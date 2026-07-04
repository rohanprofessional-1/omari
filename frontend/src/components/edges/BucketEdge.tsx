import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { BuilderEdgeData } from '../../lib/treeToFlow'

/**
 * Custom variable-node branch edge — built for "calm by default, detail on demand".
 *
 * At REST the line is thin, soft and label-less, and it braids into a shared
 * vertical "trunk" just before its destination (Layer 3) so many wires to the
 * same target read as one rope instead of a tangle. On HOVER / SELECT / path
 * trace the edge becomes `active`: it un-bundles back to its own direct path,
 * brightens to full colour, and reveals its short answer caption + destination
 * cue (Layers 1 & 2). Everything else stays bundled and dimmed.
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

  // The smoothstep path is the un-bundled route — used when the edge is active,
  // and always used to anchor the caption (labels only ever show when active).
  const [smoothPath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 14,
  })

  const active = d.highlighted || !!selected
  const dimmed = d.dimmed
  const bundled = d.bundled && !active

  // Each destination gets its own staggered lane just before the target node.
  const laneX = targetX - TRUNK_APPROACH - (d.laneOffset ?? 0)
  const path = bundled ? buildBundledPath(sourceX, sourceY, targetX, targetY, laneX) : smoothPath

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
          {/* Answer caption — centered on the edge, tinted to the edge colour. */}
          <div
            className="omari-edge-pill"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color: d.color,
              borderColor: d.color,
            }}
          >
            {d.label}
          </div>

          {/* Destination cue — short target name just before the arrow end. */}
          <div
            className="omari-edge-dest"
            style={{
              transform: `translate(-100%, -50%) translate(${targetX - 8}px, ${targetY}px)`,
            }}
          >
            {d.targetName}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default BucketEdge
