import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import type { BuilderEdgeData } from '../../lib/treeToFlow'

/**
 * Custom variable-node branch edge. Renders the colour-matched line + arrowhead,
 * the short answer caption centered ON the edge, and a small destination-name
 * chip at the arrow end (where the line lands). Highlight/dim state comes from
 * `data` (computed on the canvas) so hovering/selecting a bucket, edge, or node
 * can isolate a single path. Pure presentation — the wiring is unchanged.
 */
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
  const [path, labelX, labelY] = getSmoothStepPath({
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
  const strokeWidth = active ? 3 : 1.8
  const opacity = dimmed ? 0.14 : active ? 1 : 0.85

  // Destination cue sits just before the arrow (target) end.
  const destX = targetX - 8
  const destY = targetY

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
      <EdgeLabelRenderer>
        {/* Answer caption — centered on the edge; tints to the edge colour when active. */}
        <div
          className="omari-edge-pill"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            opacity: dimmed ? 0.18 : 1,
            ...(active ? { color: d.color, borderColor: d.color } : null),
          }}
        >
          {d.label}
        </div>

        {/* Destination cue — short target name at the arrow end. */}
        <div
          className="omari-edge-dest"
          style={{
            transform: `translate(-100%, -50%) translate(${destX}px, ${destY}px)`,
            opacity: dimmed ? 0.12 : active ? 1 : 0.7,
          }}
        >
          {d.targetName}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default BucketEdge
