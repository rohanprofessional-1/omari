import type { Tree } from '../../types/tree'
import { conditionFingerprint, resolveNodeAnchor } from './resolve'
import { DeltaOpSchema, NodeAnchorSchema, type DeltaOp } from './schema'

/**
 * Blume — anchor repair for assistant-proposed deltas.
 *
 * Sprout anchors branches by node + label only (it can't compute canonical
 * condition fingerprints). Before validation, each branch anchor gets its
 * fingerprint recomputed from the CURRENT compiled tree by resolving the
 * node and matching the label. Anything that can't be repaired is reported,
 * never guessed — same never-silent contract as the compiler.
 */

export interface RepairResult {
  valid: DeltaOp[]
  errors: string[]
}

const BRANCH_FIELDS = ['branch', 'insertAt'] as const

export function repairProposedDeltas(tree: Tree, payloads: unknown[]): RepairResult {
  const valid: DeltaOp[] = []
  const errors: string[] = []

  for (const raw of payloads) {
    if (typeof raw !== 'object' || raw === null) {
      errors.push('Proposal was not an object.')
      continue
    }
    const p = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
    let repairError: string | null = null

    for (const field of BRANCH_FIELDS) {
      const anchor = p[field] as { node?: unknown; label?: string; conditionFingerprint?: string } | undefined
      if (!anchor || typeof anchor !== 'object' || !('node' in anchor)) continue
      if (anchor.conditionFingerprint) continue // already canonical
      const err = repairBranchAnchor(tree, anchor)
      if (err) {
        repairError = err
        break
      }
    }

    if (!repairError) {
      const parsed = DeltaOpSchema.safeParse(p)
      if (parsed.success) {
        valid.push(parsed.data)
        continue
      }
      repairError = parsed.error.issues[0]?.message ?? 'invalid delta'
    }
    errors.push(`${String(p.op ?? 'proposal')}: ${repairError}`)
  }

  return { valid, errors }
}

function repairBranchAnchor(
  tree: Tree,
  anchor: { node?: unknown; label?: string; conditionFingerprint?: string },
): string | null {
  const nodeAnchor = NodeAnchorSchema.safeParse(anchor.node)
  if (!nodeAnchor.success) return 'branch anchor has an invalid node anchor'
  const res = resolveNodeAnchor(tree, nodeAnchor.data)
  if (res.status !== 'resolved') return res.reason ?? `could not resolve the anchored node`
  const node = tree.nodes.find((n) => n.id === res.nodeId)
  if (!node || node.type !== 'variable') return 'branch anchor resolved to a non-variable node'

  const want = (anchor.label ?? '').trim().toLowerCase()
  if (!want) return 'branch anchor has no label to repair from'
  const matches = node.branches.filter((b) => b.label.trim().toLowerCase() === want)
  if (matches.length === 0) return `no branch labelled "${anchor.label}" on "${node.variableKey}"`
  if (matches.length > 1) return `label "${anchor.label}" is ambiguous on "${node.variableKey}"`
  anchor.conditionFingerprint = conditionFingerprint(matches[0].condition)
  return null
}
