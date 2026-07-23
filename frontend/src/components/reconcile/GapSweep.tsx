import { useMemo, useState } from 'react'
import type { Tree, VariableNode } from '../../types/tree'
import { detectBuilderGaps } from '../../lib/assistant/gaps'
import { anchorForBranch, anchorForNode } from '../../lib/deltas/resolve'
import type { BranchAnchor, NodeAnchor } from '../../lib/deltas/schema'

/**
 * Blume — gap sweep (Reconcile stage: "Gap sweep").
 *
 * The safety net before sign-off: every hole the tree can prove about
 * itself gets an auto-proposed fix that routes to human review, so the tree
 * is SAFE even where the session left it incomplete. Batch-accept — one
 * click, not one dialog per gap. Informational findings (no workup,
 * unreachable pathways) are listed but never auto-"fixed".
 */

export interface GapProposal {
  id: string
  label: string
  kind: 'bind_escalation' | 'retarget_escalation'
  anchors?: NodeAnchor[]
  branch?: BranchAnchor
  reason: string
}

export default function GapSweep({
  tree,
  busy,
  onApply,
}: {
  tree: Tree
  busy: boolean
  onApply: (proposals: GapProposal[]) => void
}) {
  const { proposals, informational } = useMemo(() => deriveGaps(tree), [tree])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const included = proposals.filter((p) => !excluded.has(p.id))

  const toggle = (id: string) =>
    setExcluded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-5">
      {proposals.length === 0 ? (
        <div className="rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
          <p className="text-[13.5px] font-medium text-accent-strong">No unsafe endpoints.</p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Every pathway lands on a specialist or a reasoned escalation — the tree is safe to publish.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-[13px] leading-relaxed text-muted">
            {proposals.length} pathway{proposals.length === 1 ? '' : 's'} could strand a patient. Accept the
            proposed fixes to route them to human review — the tree stays safe even where this session left
            it unfinished.
          </p>
          <ul className="space-y-2">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-start gap-3 rounded-lg border border-line bg-canvas px-4 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!excluded.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink">{p.label}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted">Proposed: route to human review — “{p.reason}”</p>
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={() => onApply(included)}
            disabled={busy || included.length === 0}
            className="mt-4 rounded-md bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Make {included.length} pathway{included.length === 1 ? '' : 's'} safe
          </button>
        </>
      )}

      {informational.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
            Worth a look (no automatic fix)
          </h3>
          <ul className="mt-2 space-y-1.5">
            {informational.map((line, i) => (
              <li key={i} className="text-[12.5px] leading-snug text-muted">
                · {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function deriveGaps(tree: Tree): { proposals: GapProposal[]; informational: string[] } {
  const proposals: GapProposal[] = []
  const informational: string[] = []
  const ids = new Set(tree.nodes.map((n) => n.id))

  // Unbound placeholders → bind to escalation until a specialist exists.
  for (const node of tree.nodes) {
    if (node.type === 'specialist' && node.specialistName.startsWith('[Assign')) {
      proposals.push({
        id: `placeholder-${node.id}`,
        label: `“${node.specialty}” has no assigned specialist.`,
        kind: 'bind_escalation',
        anchors: [anchorForNode(node)],
        reason: 'No specialist assigned yet — needs manual triage',
      })
    }
  }

  // Dangling / unwired buckets → retarget to escalation.
  for (const node of tree.nodes) {
    if (node.type !== 'variable') continue
    node.branches.forEach((b, i) => {
      if (!b.nextNodeId || !ids.has(b.nextNodeId)) {
        proposals.push({
          id: `dangling-${node.id}-${i}`,
          label: `“${b.label}” on “${node.variableKey}” leads nowhere.`,
          kind: 'retarget_escalation',
          branch: anchorForBranch(node as VariableNode, i),
          reason: 'Unfinished pathway — needs manual triage',
        })
      }
    })
  }

  // Informational findings from the shared detector (skip ones covered above).
  for (const gap of detectBuilderGaps(tree)) {
    if (gap.id.startsWith('dangling-')) continue
    if (gap.id.startsWith('no-workup-')) {
      informational.push(`${gap.question.split('—')[0].trim()} — review in the Workup stage if needed.`)
    } else if (gap.id.startsWith('unreachable-')) {
      informational.push(`${gap.question.split('.')[0]}. (Suppressed pathways look like this — usually fine.)`)
    } else {
      informational.push(gap.question)
    }
  }

  return { proposals, informational }
}
