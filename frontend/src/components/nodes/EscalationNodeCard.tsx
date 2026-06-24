import { useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { BuilderFlowNode } from '../../lib/treeToFlow'
import { DeleteNodeButton } from '../BuilderActionsContext'

/**
 * Escalation node — amber accent (caution, not alarm). A clear "Human review"
 * label and the reason the tree hands off to a human instead of auto-routing.
 */
function EscalationNodeCard({ data, selected }: NodeProps<BuilderFlowNode>) {
  const [open, setOpen] = useState(false)
  const node = data.treeNode
  if (node.type !== 'escalation') return null

  // Only a genuinely long reason needs the one-line truncation + "More" toggle.
  const isLong = node.reason.length > 64

  return (
    <div
      className={`group relative w-[300px] rounded-[11px] border border-line bg-canvas transition-shadow duration-200 shadow-[0_1px_2px_rgba(22,32,46,0.06)] ${
        selected ? 'ring-2 ring-bright' : ''
      }`}
    >
      {/* Incoming edges enter on the LEFT for the left-to-right flow layout. */}
      <Handle type="target" position={Position.Left} className="!bg-nodeesc" />

      <div className="flex items-center gap-2 rounded-t-[10px] bg-nodeesc px-3 py-1.5 text-white">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em]">
          Escalation
        </span>
        <span className="ml-auto">
          <DeleteNodeButton id={node.id} />
        </span>
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <span className="inline-flex items-center gap-1 rounded bg-nodeesc/15 px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-nodeesc" aria-hidden />
          Human review
        </span>
        {isLong ? (
          <>
            <p className={`mt-2 text-[11px] leading-snug text-ink ${open ? '' : 'line-clamp-1'}`}>
              {node.reason}
            </p>
            <button
              type="button"
              aria-expanded={open}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setOpen((o) => !o)
              }}
              className="nodrag mt-1 flex items-center gap-1.5 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-muted transition-colors hover:text-ink"
            >
              <span
                aria-hidden
                className={`inline-block text-[9px] leading-none transition-transform duration-200 ${
                  open ? 'rotate-90' : ''
                }`}
              >
                ▸
              </span>
              {open ? 'Less' : 'More'}
            </button>
          </>
        ) : (
          <p className="mt-2 text-[11px] leading-snug text-ink">{node.reason}</p>
        )}
      </div>
    </div>
  )
}

export default EscalationNodeCard
