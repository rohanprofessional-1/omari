import type { AssembledDraft } from './assemble'
import type { ValidationReport } from './validate'
import type { DecidedCase, GenRosterEntry } from './types'

/**
 * Blume generator — Layer 3b: dual-axis gap detection.
 *
 * Deterministic interrogation of the draft: what did the surgeon never say?
 * Every check is plain code over the draft + decisions + validation results.
 * The LLM may later rephrase `question` more warmly (job 3) — it never
 * detects anything.
 */

export type GapKind =
  | 'routing_coverage'
  | 'workup_coverage'
  | 'undifferentiated_specialists'
  | 'over_ordering'
  | 'thin_evidence'
  | 'dead_end'

export interface GapFinding {
  kind: GapKind
  detail: Record<string, unknown>
  /** Deterministic template phrasing (LLM job 3 may soften it later). */
  question: string
}

export function detectGaps(
  draft: AssembledDraft,
  decided: DecidedCase[],
  roster: GenRosterEntry[],
  validation?: ValidationReport,
): GapFinding[] {
  const gaps: GapFinding[] = []
  const tree = draft.tree
  const nodesById = new Map(tree.nodes.map((n) => [n.id, n]))

  /* 1. Routing coverage — a case's facts fall off the tree ("no branch matched"). */
  if (validation) {
    for (const r of validation.results) {
      if (
        r.engine.outcome === 'escalated' &&
        r.engine.escalationReason?.startsWith('No branch matched') &&
        !r.expected.escalated
      ) {
        gaps.push({
          kind: 'routing_coverage',
          detail: { caseId: r.caseId, reason: r.engine.escalationReason },
          question: `One of your decided cases falls off the draft tree (${r.engine.escalationReason}) — which branch should catch it?`,
        })
      }
      if (r.engine.outcome === 'incomplete') {
        gaps.push({
          kind: 'routing_coverage',
          detail: { caseId: r.caseId, missing: r.engine.pathTaken },
          question: `A decided case can't finish routing — the tree asks about something that case never established. Is a branch missing a default?`,
        })
      }
    }
  }

  /* 2. Workup coverage — a routed path with no pre-visit workup at all. */
  for (const node of tree.nodes) {
    if (node.type !== 'specialist') continue
    const empty =
      node.workup.always.length === 0 && node.workup.conditional.length === 0
    if (empty) {
      gaps.push({
        kind: 'workup_coverage',
        detail: { nodeId: node.id, specialistName: node.specialistName },
        question: `Patients reach ${node.specialistName} on this path but no pre-visit workup is specified — intentional, or is their first visit going to be wasted?`,
      })
    }
  }

  /* 3. Undifferentiated specialists — roster members the tree never routes to. */
  const routedNames = new Set(
    tree.nodes
      .filter((n) => n.type === 'specialist')
      .map((n) => (n.type === 'specialist' ? n.specialistName.trim().toLowerCase() : '')),
  )
  for (const r of roster) {
    if (!routedNames.has(r.name.trim().toLowerCase())) {
      gaps.push({
        kind: 'undifferentiated_specialists',
        detail: { specialistName: r.name, specialty: r.specialty },
        question: `No path routes to ${r.name} (${r.specialty}) — what kind of patient is theirs, and what question would identify them?`,
      })
    }
  }

  /* 4. Over-ordering — induction couldn't separate ordered vs not-ordered. */
  for (const amb of draft.workupAmbiguities) {
    gaps.push({
      kind: 'over_ordering',
      detail: amb as unknown as Record<string, unknown>,
      question: `On the path to ${amb.specialistName} you ordered ${amb.test} for some cases but not others, and nothing you've told me separates them — what's the trigger? (It's been left OUT of the draft so nobody gets an unneeded test.)`,
    })
  }
  if (validation) {
    for (const r of validation.results) {
      if (r.refusedButOrdered.length > 0) {
        gaps.push({
          kind: 'over_ordering',
          detail: { caseId: r.caseId, tests: r.refusedButOrdered },
          question: `The draft orders ${r.refusedButOrdered.join(', ')} on a case where you explicitly said you would NOT — this must be resolved before sign-off.`,
        })
      }
    }
  }

  /* 5. Thin evidence — a terminal supported by fewer than 2 decided cases. */
  for (const [nodeId, support] of Object.entries(draft.leafSupport)) {
    const node = nodesById.get(nodeId)
    if (!node || node.type !== 'specialist') continue
    if (support.length < 2) {
      gaps.push({
        kind: 'thin_evidence',
        detail: { nodeId, specialistName: node.specialistName, supportCaseIds: support },
        question: `The path to ${node.specialistName} rests on ${support.length} decided case${support.length === 1 ? '' : 's'} — decide a couple more like it so the branch isn't guessing.`,
      })
    }
  }

  /* 6. Dead ends — branches pointing nowhere / unreachable nodes. */
  const reachable = new Set<string>()
  const stack = [tree.rootNodeId]
  while (stack.length) {
    const id = stack.pop()!
    if (reachable.has(id)) continue
    reachable.add(id)
    const node = nodesById.get(id)
    if (node?.type === 'variable') {
      for (const b of node.branches) {
        if (!b.nextNodeId || !nodesById.has(b.nextNodeId)) {
          gaps.push({
            kind: 'dead_end',
            detail: { nodeId: id, branchLabel: b.label },
            question: `The "${b.label}" answer under "${node.variableKey}" leads nowhere — where should that patient go?`,
          })
        } else {
          stack.push(b.nextNodeId)
        }
      }
    }
  }
  for (const node of tree.nodes) {
    if (!reachable.has(node.id)) {
      gaps.push({
        kind: 'dead_end',
        detail: { nodeId: node.id, unreachable: true },
        question: `A node in the draft can never be reached from the first question — should it be wired in or removed?`,
      })
    }
  }

  void decided // (decided cases already folded in via validation + leafSupport)
  return gaps
}
