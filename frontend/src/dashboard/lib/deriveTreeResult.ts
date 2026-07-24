import { runEngine, type ResolvedWorkupItem } from '../../lib/engine'
import { explainRoute } from '../../lib/explain'
import { confidenceBand } from '../../lib/orchestrator'
import { classifyEscalation } from '../../lib/escalation'
import { VARIABLE_SPECS } from '../../data/variableSpecs'
import type { Tree, VariableNode } from '../../types/tree'
import { DASHBOARD_TREE, OVERRIDE_NODE_IDS } from '../data/dashboardDeltas'
import { DEMO_NOW, isAtRisk } from './demoClock'
import { buildMissingVariableInfo } from './missingVariables'
import type {
  DashboardWorkupItem,
  DecisionStep,
  ReferralAnnotations,
  ReferralFixture,
  TreeResult,
  VariableSource,
} from '../types'

/**
 * Dashboard — replay one referral through the deterministic engine and derive
 * everything the review UI will need: the routed destination (or the one
 * blocking variable, or the escalation), the audited step-by-step path with
 * extraction provenance, the concrete workup checklist with due dates, and an
 * honest confidence verdict.
 *
 * The ENGINE decides; this module only annotates its output. Runs against
 * DASHBOARD_TREE — the CPG base with the clinic's deltas compiled on top — so
 * clinic overrides (deviatesFromCpg) are surfaced on every step they touch.
 */

const MS_PER_DAY = 86_400_000

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Default due date: visitDate − `daysBefore`, or DEMO_NOW + 14d without a visit. */
function dueByFor(visitDate: string | undefined, daysBefore: number): string {
  if (visitDate) return isoDay(new Date(new Date(visitDate).getTime() - daysBefore * MS_PER_DAY))
  return isoDay(new Date(DEMO_NOW.getTime() + 14 * MS_PER_DAY))
}

function toDashboardWorkup(
  ordered: ResolvedWorkupItem[],
  annotations: ReferralAnnotations | undefined,
): DashboardWorkupItem[] {
  const visitDate = annotations?.visitDate
  return ordered.map((item) => {
    const state = annotations?.workupState?.[item.name]
    const dueBy = dueByFor(visitDate, state?.dueDaysBeforeVisit ?? 14)
    const status = state?.status ?? 'needed'
    return {
      name: item.name,
      protocol: item.protocol || undefined,
      rationale: item.rationale || undefined,
      source: item.source,
      conditionalReason: item.reason || undefined,
      status,
      responsible: state?.responsible ?? 'clinic',
      dueBy,
      atRisk: isAtRisk({ status, dueBy }, visitDate),
    }
  })
}

export function deriveTreeResult(fixture: ReferralFixture): TreeResult {
  const tree: Tree = DASHBOARD_TREE
  const { variables, sources } = fixture.extraction
  const annotations = fixture.annotations
  const result = runEngine(tree, variables)

  /* ---- Path steps: explainRoute covers exactly the variable hops that have
   *      a filled value — align by filtering pathTaken the same way. -------- */
  const nodesById = new Map(tree.nodes.map((n) => [n.id, n]))
  const explainedNodes = result.pathTaken
    .map((id) => nodesById.get(id))
    .filter(
      (n): n is VariableNode => n?.type === 'variable' && variables[n.variableKey] !== undefined,
    )
  const reasons = explainRoute(tree, result.pathTaken, variables)
  const pathTaken: DecisionStep[] = reasons.map((reason, i) => {
    const node = explainedNodes[i]
    const source: VariableSource | 'unknown' = sources[reason.variableKey] ?? 'unknown'
    return {
      ...reason,
      nodeId: node?.id ?? '',
      source,
      citation: node?.prompt,
      overridden: node ? OVERRIDE_NODE_IDS.has(node.id) : false,
    }
  })

  /* ---- Confidence: the weakest filled variable on the actual path. ------- */
  let minConfidence = 1
  let minStep: DecisionStep | undefined
  for (const step of pathTaken) {
    if (typeof step.confidence === 'number' && step.confidence < minConfidence) {
      minConfidence = step.confidence
      minStep = step
    }
  }
  let confidence = confidenceBand(minConfidence)
  let confidenceReason: string
  if (confidence === 'high') {
    confidenceReason = 'All inputs extracted with high confidence.'
  } else {
    const key = minStep?.variableKey ?? 'unknown'
    const label = VARIABLE_SPECS[key]?.clinicalPrompt ?? key
    confidenceReason = `Lowest-confidence input: ${label} (${minConfidence.toFixed(2)}, from ${minStep?.source ?? 'unknown'})`
  }
  const flags = annotations?.flags ?? {}
  // Needs-judgment must never land in ready-to-approve: a flagged ambiguity
  // demotes an otherwise-high extraction confidence.
  if (flags.ambiguousBetween && confidence === 'high') {
    confidence = 'medium'
    confidenceReason = `Plausibly routes to either ${flags.ambiguousBetween[0]} or ${flags.ambiguousBetween[1]} — needs judgment.`
  }

  const base: TreeResult = {
    inScope: true,
    routedTo: null,
    urgency: null,
    pathTaken,
    missingVariables: [],
    requiredWorkup: [],
    escalated: false,
    confidence,
    confidenceReason,
    overrideNodeIds: [...OVERRIDE_NODE_IDS],
    terminalOverridden: false,
    flags,
    visitDate: annotations?.visitDate,
  }

  if (result.outcome === 'routed' && result.specialist && result.resolvedWorkup) {
    const terminalId = result.pathTaken[result.pathTaken.length - 1]
    base.routedTo = {
      specialistName: result.specialist.specialistName,
      specialty: result.specialist.specialty,
      nodeId: terminalId,
    }
    base.urgency = result.specialist.urgency
    base.terminalCitation = result.specialist.clinicalBasis
    base.confirmWithDrLi = result.specialist.confirmWithDrLi
    base.terminalOverridden = OVERRIDE_NODE_IDS.has(terminalId)
    base.resolvedWorkup = result.resolvedWorkup
    base.requiredWorkup = toDashboardWorkup(result.resolvedWorkup.ordered, annotations)
  } else if (result.outcome === 'incomplete') {
    const stopNodeId = result.pathTaken[result.pathTaken.length - 1]
    base.missingVariables = [buildMissingVariableInfo(tree, stopNodeId)]
  } else if (result.outcome === 'escalated') {
    base.escalated = true
    base.escalationReason = result.escalationReason
    base.escalationCategory = classifyEscalation(tree, variables, result).category
  }

  /* ---- Scope annotation wins: out-of-scope referrals never show a routed
   *      destination, but the path stays for transparency. ------------------ */
  if (annotations?.scope) {
    base.inScope = false
    base.routedTo = null
    base.urgency = null
    base.requiredWorkup = []
    base.suggestedRedirect = annotations.scope.suggestedRedirect
  }

  return base
}
