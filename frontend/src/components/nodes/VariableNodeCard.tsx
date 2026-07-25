import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import {
  branchHandleId,
  describeCondition,
  edgeColor,
  shortBranchLabel,
  type BuilderFlowNode,
} from '../../lib/treeToFlow'
import { CollapseToggle, DeleteNodeButton, useBuilderActions } from '../BuilderActionsContext'
import { CardExpander } from './CardExpander'

/**
 * Variable (decision) node — periwinkle accent. Shows the variable key, the
 * prompt, and the branches. CRUCIALLY: each branch/bucket has its OWN output
 * handle on the right, so connections are answer-driven — a specific answer
 * leads to a specific node.
 */
function VariableNodeCard({ data, selected }: NodeProps<BuilderFlowNode>) {
  const updateNodeInternals = useUpdateNodeInternals()
  const { onBucketHover } = useBuilderActions()
  const node = data.treeNode
  const view = data.view
  if (node.type !== 'variable') return null

  return (
    <div
      className={`group relative w-[300px] rounded-xl border border-line bg-canvas transition-shadow duration-200 shadow-subtle ${
        selected ? 'ring-2 ring-bright' : ''
      }`}
    >
      {/* Single input handle on the LEFT (incoming) for left-to-right flow. The
          per-bucket OUTPUT handles stay on the right — unchanged. */}
      <Handle type="target" position={Position.Left} className="!bg-nodevar" />

      <div className="flex items-center gap-2 rounded-t-[10px] bg-nodevar px-3 py-1.5 text-white">
        {/* Expand/collapse the downstream subtree — first chip in the header so it
            never overlaps the title, delete button, or canvas wires. */}
        {view?.hasChildren && (
          <CollapseToggle
            id={node.id}
            collapsed={!!view.collapsed}
            hiddenCount={view.hiddenCount}
          />
        )}
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em]">
          Variable
        </span>
        <span className="ml-auto rounded bg-white/15 px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-[0.06em] text-white/90">
          {node.dataSource}
        </span>
        <DeleteNodeButton id={node.id} />
      </div>

      <div className="px-3 pb-3 pt-2.5">
        {/* Always visible: the variable name. */}
        <p className="truncate font-display text-[13px] font-semibold leading-tight text-ink">
          {node.variableKey}
        </p>

        {/* Longer prompt hidden behind Details (keeps the card compact). Toggling
            it changes the card height, which moves the bucket handles below — so
            re-measure node internals to keep their edges anchored correctly. */}
        <CardExpander label="Details" onToggle={() => updateNodeInternals(node.id)}>
          <p className="text-[11px] leading-snug text-muted">{node.prompt}</p>
        </CardExpander>

        {/* Buckets stay fully visible — they ARE the branching logic and carry
            the output connection handles. Do not collapse these. */}
        <p className="mb-1.5 mt-3 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
          Buckets
        </p>
        <ul className="space-y-1">
          {node.branches.map((branch, i) => {
            // Bucket + its outgoing edge share one colour (see edgeColor) so a
            // start dot can be matched to its line.
            const color = edgeColor(i)
            return (
              <li
                key={i}
                onMouseEnter={() => onBucketHover?.({ nodeId: node.id, branchIndex: i })}
                onMouseLeave={() => onBucketHover?.(null)}
                className={`relative flex items-center justify-between gap-2 rounded-md border border-line/70 px-2 py-1.5 pr-3 ${
                  i % 2 === 0 ? 'bg-bg' : 'bg-sky/60'
                }`}
              >
                {/* Short answer only (no "→ destination"). */}
                <span className="truncate text-[11px] font-medium text-ink">
                  {shortBranchLabel(branch)}
                </span>
                <span className="shrink-0 rounded bg-nodevar/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-nodevar">
                  {describeCondition(branch.condition)}
                </span>
                {/* One output handle PER bucket — a clear, colour-matched START DOT
                    anchored to this row's right edge (grows/glows on hover). */}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={branchHandleId(i)}
                  className="omari-bucket-handle"
                  style={{
                    right: -8,
                    width: 13,
                    height: 13,
                    backgroundColor: color,
                    border: '2px solid var(--color-canvas)',
                    boxShadow: `0 0 0 1px ${color}`,
                  }}
                />
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default VariableNodeCard
