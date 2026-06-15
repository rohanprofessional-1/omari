import { Handle, Position, type NodeProps } from '@xyflow/react'
import { branchHandleId, describeCondition, type BuilderFlowNode } from '../../lib/treeToFlow'
import { DeleteNodeButton } from '../BuilderActionsContext'

/**
 * Variable (decision) node — periwinkle accent. Shows the variable key, the
 * prompt, and the branches. CRUCIALLY: each branch/bucket has its OWN output
 * handle on the right, so connections are answer-driven — a specific answer
 * leads to a specific node.
 */
function VariableNodeCard({ data, selected }: NodeProps<BuilderFlowNode>) {
  const node = data.treeNode
  if (node.type !== 'variable') return null

  return (
    <div
      className={`group relative w-[300px] rounded-[11px] border border-line bg-canvas transition-shadow duration-200 shadow-[0_1px_2px_rgba(22,32,46,0.06)] ${
        selected ? 'ring-2 ring-bright' : ''
      }`}
    >
      {/* Single input handle (top). */}
      <Handle type="target" position={Position.Top} className="!bg-nodevar" />

      <div className="flex items-center gap-2 rounded-t-[10px] bg-nodevar px-3 py-1.5 text-white">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em]">
          Variable
        </span>
        <span className="ml-auto rounded bg-white/15 px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-[0.06em] text-white/90">
          {node.dataSource}
        </span>
        <DeleteNodeButton id={node.id} />
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <p className="truncate font-display text-[13px] font-semibold leading-tight text-ink">
          {node.variableKey}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted">{node.prompt}</p>

        <p className="mb-1.5 mt-3 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
          Buckets
        </p>
        <ul className="space-y-1">
          {node.branches.map((branch, i) => (
            <li
              key={i}
              className={`relative flex items-center justify-between gap-2 rounded-md border border-line/70 px-2 py-1.5 pr-3 ${
                i % 2 === 0 ? 'bg-bg' : 'bg-sky/60'
              }`}
            >
              <span className="truncate text-[11px] font-medium text-ink">{branch.label}</span>
              <span className="shrink-0 rounded bg-nodevar/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-nodevar">
                {describeCondition(branch.condition)}
              </span>
              {/* One output handle PER bucket, anchored to this row's right edge. */}
              <Handle
                type="source"
                position={Position.Right}
                id={branchHandleId(i)}
                className="!bg-nodevar"
                style={{ right: -7 }}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default VariableNodeCard
