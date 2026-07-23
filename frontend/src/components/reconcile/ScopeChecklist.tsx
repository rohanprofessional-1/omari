import { useMemo, useState } from 'react'
import type { Tree, VariableNode } from '../../types/tree'
import { anchorForBranch } from '../../lib/deltas/resolve'
import type { BranchAnchor } from '../../lib/deltas/schema'

/**
 * Blume — scope subsetting (Reconcile stage: "Scope").
 *
 * "Which of these pathways does your clinic actually see?" — the top-level
 * pathways of the CPG tree as a checklist, all in-scope by default. Unchecking
 * emits a set_scope delta that retargets the pathway to a reasoned escalation
 * (never deletes it), shrinking every later review queue. Cutting scope FIRST
 * is what keeps a 200-node guideline reviewable in an hour.
 */

export interface ScopeCut {
  anchor: BranchAnchor
  label: string
  reason: string
}

interface ScopeRow {
  label: string
  branchIndex: number
  /** Already suppressed by an earlier set_scope delta (target is an
   *  out-of-scope escalation in the compiled tree). */
  alreadyOut: boolean
  /** How many nodes live under this pathway — a sense of what's being cut. */
  subtreeSize: number
}

export default function ScopeChecklist({
  tree,
  busy,
  onApply,
}: {
  tree: Tree
  busy: boolean
  onApply: (cuts: ScopeCut[]) => void
}) {
  const root = useMemo(
    () => tree.nodes.find((n) => n.id === tree.rootNodeId && n.type === 'variable') as VariableNode | undefined,
    [tree],
  )

  const rows: ScopeRow[] = useMemo(() => {
    if (!root) return []
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    return root.branches.map((b, i) => {
      const target = byId.get(b.nextNodeId)
      const alreadyOut = target?.type === 'escalation' && target.reason.startsWith('Out of scope')
      // Reachability walk from the branch target.
      const seen = new Set<string>()
      const queue = [b.nextNodeId]
      while (queue.length) {
        const id = queue.pop()!
        if (!id || seen.has(id)) continue
        seen.add(id)
        const node = byId.get(id)
        if (node?.type === 'variable') for (const nb of node.branches) queue.push(nb.nextNodeId)
      }
      return { label: b.label, branchIndex: i, alreadyOut, subtreeSize: seen.size }
    })
  }, [tree, root])

  // Checked = in scope. Pathways already cut render unchecked and locked
  // (undo their delta in the rail to restore them).
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set())
  const [reasons, setReasons] = useState<Record<number, string>>({})

  if (!root || rows.length < 2) {
    return (
      <div className="px-5 py-6">
        <p className="text-[13px] text-muted">
          This tree has a single top-level pathway — there's nothing to subset. Move on to mapping endpoints.
        </p>
      </div>
    )
  }

  const toggle = (i: number) =>
    setUnchecked((s) => {
      const next = new Set(s)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const pending = [...unchecked].filter((i) => !rows[i].alreadyOut)

  const apply = () => {
    const cuts: ScopeCut[] = pending.map((i) => ({
      anchor: anchorForBranch(root, i),
      label: rows[i].label,
      reason: reasons[i]?.trim() || 'Not treated at this clinic',
    }))
    onApply(cuts)
    setUnchecked(new Set())
    setReasons({})
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-5">
      <p className="mb-4 text-[13px] leading-relaxed text-muted">
        Does your clinic see all of these? Uncheck any pathway you don't handle — patients on it will be
        routed to human review instead, and it disappears from the rest of this session.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => {
          const out = row.alreadyOut || unchecked.has(row.branchIndex)
          return (
            <li
              key={row.branchIndex}
              className={`rounded-lg border px-4 py-3 ${out ? 'border-line/60 bg-bg' : 'border-line bg-canvas'}`}
            >
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={!out}
                  disabled={row.alreadyOut || busy}
                  onChange={() => toggle(row.branchIndex)}
                />
                <span className={`flex-1 text-[13.5px] ${out ? 'text-muted line-through' : 'font-medium text-ink'}`}>
                  {row.label}
                </span>
                <span className="text-[11px] text-muted">
                  {row.alreadyOut ? 'out of scope — undo in the rail to restore' : `${row.subtreeSize} node${row.subtreeSize === 1 ? '' : 's'}`}
                </span>
              </label>
              {unchecked.has(row.branchIndex) && !row.alreadyOut && (
                <input
                  className="mt-2 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-muted/60"
                  placeholder="Why not? (default: Not treated at this clinic)"
                  value={reasons[row.branchIndex] ?? ''}
                  onChange={(e) => setReasons((r) => ({ ...r, [row.branchIndex]: e.target.value }))}
                />
              )}
            </li>
          )
        })}
      </ul>
      <button
        onClick={apply}
        disabled={busy || pending.length === 0}
        className="mt-4 rounded-md bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending.length === 0 ? 'Everything is in scope' : `Mark ${pending.length} pathway${pending.length === 1 ? '' : 's'} out of scope`}
      </button>
    </div>
  )
}
