import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Urgency } from '../../types/tree'
import type { BuilderFlowNode } from '../../lib/treeToFlow'
import { DeleteNodeButton } from '../BuilderActionsContext'

// Urgency badge sits on the Carolina-blue header (light → dark text for routine).
const URGENCY_STYLES: Record<Urgency, string> = {
  routine: 'bg-white/20 text-white',
  expedited: 'bg-nodeesc text-white',
  urgent: 'bg-danger text-white',
}

/**
 * Specialist (routing endpoint) node — teal accent. Shows the specialist, their
 * specialty, an urgency badge, and the recommended workup list.
 */
function SpecialistNodeCard({ data, selected }: NodeProps<BuilderFlowNode>) {
  const node = data.treeNode
  if (node.type !== 'specialist') return null

  return (
    <div
      className={`group relative w-[300px] rounded-[11px] border border-line bg-canvas transition-shadow duration-200 shadow-[0_1px_2px_rgba(22,32,46,0.06)] ${
        selected ? 'ring-2 ring-bright' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-nodespec" />

      <div className="flex items-center gap-2 rounded-t-[10px] bg-nodespec px-3 py-1.5 text-white">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em]">
          Specialist
        </span>
        <span
          className={`ml-auto rounded px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-[0.06em] ${URGENCY_STYLES[node.urgency]}`}
        >
          {node.urgency}
        </span>
        <DeleteNodeButton id={node.id} />
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <p className="font-display text-sm font-semibold leading-tight text-ink">
          {node.specialistName}
        </p>
        <p className="mt-0.5 text-[11px] text-muted">{node.specialty}</p>

        <p className="mb-1.5 mt-3 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
          Workup
        </p>
        <ul className="space-y-1.5">
          {node.workup.map((item, i) => (
            <li key={i} className="rounded-md border border-line/70 bg-bg px-2 py-1.5">
              <p className="text-[11px] font-medium text-ink">{item.name}</p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-muted">{item.rationale}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default SpecialistNodeCard
