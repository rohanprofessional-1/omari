import React, { useCallback } from 'react'
import type { TreeEdge } from '../../types'
import { buildEdgePath, midpoint, getPortCenter, type Rect } from '../../utils/geometry'
import { EDGE_COLORS } from '../../nodes/registry'

interface Props {
  edges: TreeEdge[]
  selectedEdgeId: string | null
  onDeleteEdge: (id: string) => void
  getNodeRect: (id: string) => Rect | null
}

/**
 * EdgeLayer
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders SVG bezier curves for all edges. Edges are color-coded by source
 * port semantics (yes=green, no=red, etc). A small delete button appears at
 * the edge midpoint on hover.
 *
 * getNodeRect is passed in rather than reading the DOM directly — this keeps
 * the component pure and testable.
 */
export function EdgeLayer({ edges, selectedEdgeId, onDeleteEdge, getNodeRect }: Props) {
  return (
    <svg
      className="edges-svg"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5"
          markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9"
            stroke="context-stroke" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </marker>
      </defs>

      {edges.map(edge => {
        const fromRect = getNodeRect(edge.from)
        const toRect   = getNodeRect(edge.to)
        if (!fromRect || !toRect) return null

        const from = getPortCenter(fromRect, edge.fromPort)
        const to   = getPortCenter(toRect,   edge.toPort)
        const d    = buildEdgePath(from, to)
        const mid  = midpoint(from, to)
        const color = EDGE_COLORS[edge.fromPort] ?? 'var(--text-secondary)'
        const isSelected = edge.id === selectedEdgeId

        return (
          <g key={edge.id}>
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={isSelected ? 2 : 1.5}
              opacity={isSelected ? 0.95 : 0.55}
              markerEnd="url(#arrow)"
            />
            {/* Invisible wide hit area for easier interaction */}
            <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} />
            {/* Delete button at midpoint */}
            <EdgeDeleteButton x={mid.x} y={mid.y} onDelete={() => onDeleteEdge(edge.id)} />
          </g>
        )
      })}
    </svg>
  )
}

function EdgeDeleteButton({ x, y, onDelete }: { x: number; y: number; onDelete: () => void }) {
  return (
    <foreignObject x={x - 8} y={y - 8} width={16} height={16} style={{ overflow: 'visible', pointerEvents: 'all' }}>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{
          width: 16, height: 16,
          borderRadius: '50%',
          border: '0.5px solid var(--border-secondary)',
          background: 'var(--bg-primary)',
          color: 'var(--text-danger)',
          fontSize: 10,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: 0,
          transition: 'opacity 0.15s',
          fontFamily: 'inherit',
          lineHeight: 1,
        }}
        className="edge-delete-btn"
        title="Delete connection"
        aria-label="Delete connection"
      >
        ×
      </button>
    </foreignObject>
  )
}
