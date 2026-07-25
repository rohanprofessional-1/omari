import type { FilledVariables, Tree } from '../../types/tree'
import { runEngine, type RoutingResult } from '../engine'

/**
 * Blume — validation-stage case runner.
 *
 * Runs a synthetic case (groundTruth: variableKey → value) through the real
 * engine. CPG-generated trees carry SYNTHETIC routing roots ("Which section
 * applies?" / master_cpg_root) that case ground truth never contains — for
 * those, every branch value is tried and the best-resolving pathway wins
 * (routed > escalated > incomplete). Real clinical variables are never
 * auto-filled: a missing one honestly returns 'incomplete'.
 */

export interface CaseRunOutcome {
  result: RoutingResult
  /** Values auto-chosen for synthetic root variables, for display. */
  autoFilled: Record<string, unknown>
}

function isSyntheticKey(key: string): boolean {
  return key === 'master_cpg_root' || key.endsWith('cpg_section')
}

export function toFilled(groundTruth: Record<string, unknown>): FilledVariables {
  const filled: FilledVariables = {}
  for (const [key, value] of Object.entries(groundTruth)) {
    filled[key] = { value, confidence: 1 }
  }
  return filled
}

const OUTCOME_RANK: Record<RoutingResult['outcome'], number> = { routed: 0, escalated: 1, incomplete: 2 }

export function runCase(tree: Tree, groundTruth: Record<string, unknown>): CaseRunOutcome {
  return runFrom(tree, toFilled(groundTruth), {}, 0)
}

function runFrom(
  tree: Tree,
  filled: FilledVariables,
  autoFilled: Record<string, unknown>,
  depth: number,
): CaseRunOutcome {
  const result = runEngine(tree, filled)
  if (result.outcome !== 'incomplete' || depth > 8) return { result, autoFilled }

  const missing = result.missingVariables[0]
  if (!missing || !isSyntheticKey(missing)) return { result, autoFilled }

  // Find the stalled synthetic node (last node on the path) and try each of
  // its branch values; keep the best-resolving continuation.
  const nodeId = result.pathTaken[result.pathTaken.length - 1]
  const node = tree.nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== 'variable') return { result, autoFilled }

  let best: CaseRunOutcome | null = null
  for (const branch of node.branches) {
    const value =
      branch.condition.op === 'equals'
        ? branch.condition.value
        : branch.condition.op === 'in'
          ? branch.condition.values[0]
          : (branch.condition.min ?? branch.condition.max ?? 0)
    const attempt = runFrom(
      tree,
      { ...filled, [missing]: { value, confidence: 1 } },
      { ...autoFilled, [missing]: value },
      depth + 1,
    )
    if (!best || OUTCOME_RANK[attempt.result.outcome] < OUTCOME_RANK[best.result.outcome]) best = attempt
    if (best.result.outcome === 'routed') break
  }
  return best ?? { result, autoFilled }
}
