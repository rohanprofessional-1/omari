import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { BuilderFlowNode } from '../../lib/treeToFlow'
import { DeleteNodeButton } from '../BuilderActionsContext'

/**
 * Escalation node — amber accent (caution, not alarm). A clear "Human review"
 * label and the reason the tree hands off to a human instead of auto-routing.
 */
function EscalationNodeCard({ data, selected }: NodeProps<BuilderFlowNode>) {
  const node = data.treeNode
  if (node.type !== 'escalation') return null

  return (
    <div
      className={`group relative w-[300px] rounded-[11px] border border-line bg-canvas transition-shadow duration-200 shadow-[0_1px_2px_rgba(22,32,46,0.06)] ${
        selected ? 'ring-2 ring-bright' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-nodeesc" />

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
        <p className="mt-2 text-[11px] leading-snug text-ink">{node.reason}</p>
      </div>
    </div>
  )
}

export default EscalationNodeCard
