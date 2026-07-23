import type { Tree, VariableNode } from '../../types/tree'
import { anchorForBranch } from './resolve'
import type { BranchAnchor } from './schema'

/**
 * Blume — threshold-review queue detector.
 *
 * The CPG generator preserves guideline ambiguity verbatim ("elevated PSA"
 * → equals 'elevated') and never invents numbers. This module finds every
 * branch condition a clinic should be asked to concretize or confirm, so the
 * threshold-review stage surfaces ONLY those — not the whole tree.
 */

export interface ThresholdCandidate {
  nodeId: string
  variableKey: string
  prompt: string
  branchIndex: number
  branchLabel: string
  anchor: BranchAnchor
  kind: 'ambiguous_equals' | 'range'
  /** The verbatim CPG text behind the branch's target, when available. */
  clinicalBasis?: string
}

/** Vague qualitative words that suggest a threshold the guideline never
 *  quantified — the surgeon should either accept the wording or supply
 *  this clinic's number. */
const VAGUE_VALUE_RE =
  /^(elevated|high|low|raised|abnormal|normal|large|small|severe|mild|moderate|prolonged|persistent|significant|positive|negative|borderline)$/i

export function detectThresholdCandidates(tree: Tree, opts: { docScope?: string } = {}): ThresholdCandidate[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const candidates: ThresholdCandidate[] = []

  for (const node of tree.nodes) {
    if (node.type !== 'variable') continue
    // Synthetic routing roots aren't clinical thresholds.
    if (node.variableKey === 'master_cpg_root' || node.variableKey.endsWith('cpg_section')) continue
    node.branches.forEach((branch, branchIndex) => {
      let kind: ThresholdCandidate['kind'] | null = null
      if (branch.condition.op === 'range') {
        kind = 'range'
      } else if (branch.condition.op === 'equals' && typeof branch.condition.value === 'string') {
        if (VAGUE_VALUE_RE.test(branch.condition.value.trim())) kind = 'ambiguous_equals'
      }
      if (!kind) return
      const target = byId.get(branch.nextNodeId)
      candidates.push({
        nodeId: node.id,
        variableKey: node.variableKey,
        prompt: node.prompt,
        branchIndex,
        branchLabel: branch.label,
        anchor: anchorForBranch(node as VariableNode, branchIndex, opts),
        kind,
        ...(target && target.type === 'specialist' && target.clinicalBasis
          ? { clinicalBasis: target.clinicalBasis }
          : {}),
      })
    })
  }
  return candidates
}
