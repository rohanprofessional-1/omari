import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Urgency } from '../../types/tree'
import type { BuilderFlowNode } from '../../lib/treeToFlow'
import { describeKeyedCondition } from '../../lib/conditionText'
import { DeleteNodeButton } from '../BuilderActionsContext'
import { CardExpander } from './CardExpander'

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
      className={`group relative w-[300px] rounded-[11px] border border-line bg-canvas transition-shadow duration-200 shadow-[0_1px_2px_rgba(24,20,16,0.06)] ${
        selected ? 'ring-2 ring-bright' : ''
      }`}
    >
      {/* Incoming edges enter on the LEFT for the left-to-right flow layout. */}
      <Handle type="target" position={Position.Left} className="!bg-nodespec" />

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

      <div className="px-3 pb-2.5 pt-2.5">
        {/* Always visible: who + what + the important confirm flag. */}
        <p className="font-display text-sm font-semibold leading-tight text-ink">
          {node.specialistName}
        </p>
        <p className="mt-0.5 text-[11px] text-muted">{node.specialty}</p>

        {node.confirmWithDrLi && (
          <span className="mt-1.5 inline-block rounded bg-nodeesc/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nodeesc">
            ✓ Confirm with Dr. Li
          </span>
        )}

        {/* Detail on demand — each expander is independent. Basis is Duke-only
            (absent on the simple sample). Nothing is removed, only collapsed. */}
        {node.clinicalBasis && (
          <CardExpander label="Basis">
            <p className="rounded-md border border-line/70 bg-sky/60 px-2 py-1.5 text-[10px] leading-snug text-muted">
              {node.clinicalBasis}
            </p>
          </CardExpander>
        )}

        <CardExpander
          label={`Workup · ${node.workup.always.length + node.workup.conditional.length}`}
        >
          <ul className="space-y-1.5">
            {node.workup.always.map((item, i) => (
              <li key={`a${i}`} className="rounded-md border border-line/70 bg-bg px-2 py-1.5">
                <p className="text-[11px] font-medium text-ink">{item.name}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted">
                  <span className="font-medium text-ink">Protocol:</span> {item.protocol}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted">
                  <span className="font-medium text-ink">Why:</span> {item.rationale}
                </p>
              </li>
            ))}
            {node.workup.conditional.map((rule, i) => (
              <li key={`c${i}`} className="rounded-md border border-line/70 bg-sky/40 px-2 py-1.5">
                <p className="text-[11px] font-medium text-ink">{rule.item.name}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted">
                  <span className="font-medium text-ink">Only if:</span>{' '}
                  {describeKeyedCondition(rule.when)}
                </p>
                {rule.reason && (
                  <p className="mt-0.5 text-[10px] leading-snug text-muted">
                    <span className="font-medium text-ink">Or else:</span> {rule.reason}
                  </p>
                )}
              </li>
            ))}
            {node.workup.doNotOrderUnless.map((guard, i) => (
              <li key={`g${i}`} className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5">
                <p className="text-[10px] leading-snug text-muted">
                  <span className="font-medium text-ink">Don't order {guard.item}</span> unless{' '}
                  {describeKeyedCondition(guard.requiredCondition)}
                </p>
              </li>
            ))}
          </ul>
        </CardExpander>
      </div>
    </div>
  )
}

export default SpecialistNodeCard
