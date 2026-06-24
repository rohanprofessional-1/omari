import type { RoutingResult } from './engine'
import type { FilledVariables, Tree } from '../types/tree'

/**
 * Blume — deterministic escalation classification (NO AI).
 *
 * ⚠️ The engine still MAKES the escalation decision (runEngine). This module only
 * CATEGORISES an escalation the engine already returned, so the orchestrator can
 * decide whether to gather more intake before honouring it. It never routes,
 * never calls the LLM, and is pure/total like the engine.
 *
 * Two paths the product cares about:
 *  - EMERGENCY red flag (mass/lump, acute trauma, acute progressive weakness /
 *    cauda-equina signals): escalate IMMEDIATELY — speed is the safe behaviour.
 *  - AMBIGUITY (an "unsure/unclear" value, a value that matched no branch, or a
 *    below-confidence value): try a clarifying question, then gather the full
 *    standard intake, THEN escalate with a complete packet.
 *  - COMPLEX: a confident, non-emergency value the tree still routes to review —
 *    gather full intake first, then escalate.
 */

export type EscalationCategory = 'emergency' | 'ambiguous' | 'complex'

export interface EscalationAnalysis {
  category: EscalationCategory
  /** The variable whose value led to the escalation (last variable on the path). */
  triggerKey?: string
  triggerValue?: string | number | boolean
  triggerConfidence?: number
  /** The engine's raw escalation reason. */
  reasonText: string
  pathTaken: string[]
  /** Variables a clarifying re-ask was attempted on (filled in at finalisation). */
  clarifiedKeys?: string[]
  /** Core-intake variables asked specifically to enrich the packet. */
  gatheredKeys?: string[]
}

// Values that signal a genuine emergency / red flag → escalate fast.
const EMERGENCY_VALUES = new Set(['mass_lump', 'acute_trauma', 'acute', 'cauda_equina'])

// Values that signal the presentation couldn't be pinned down → clarify + gather.
const AMBIGUOUS_VALUES = new Set([
  'unsure',
  'unclear',
  'unknown',
  'not_sure',
  'cannot_classify',
  'uncertain',
])

/** True when a resolved value is an explicit "can't pin this down" answer. */
export function isAmbiguousValue(value: unknown): boolean {
  return value !== undefined && value !== null && AMBIGUOUS_VALUES.has(String(value))
}

/**
 * The list of standard intake variables every patient should be asked, derived
 * from the tree's variable nodes (distinct keys, in authoring order). When an
 * ambiguity escalation fires, the orchestrator asks any of these still missing
 * so the human reviewer receives a complete picture.
 */
export function coreIntakeKeys(tree: Tree): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const node of tree.nodes) {
    if (node.type === 'variable' && !seen.has(node.variableKey)) {
      seen.add(node.variableKey)
      keys.push(node.variableKey)
    }
  }
  return keys
}

/** The last variable node on the path — the one whose value led to escalation. */
function triggerVariable(tree: Tree, pathTaken: string[]): string | undefined {
  for (let i = pathTaken.length - 1; i >= 0; i--) {
    const node = tree.nodes.find((n) => n.id === pathTaken[i])
    if (node?.type === 'variable') return node.variableKey
  }
  return undefined
}

/**
 * Categorise an escalation the engine returned. Deterministic and total.
 * `highThreshold` is the confidence below which a routed value is treated as
 * not-confident-enough → ambiguous.
 */
export function classifyEscalation(
  tree: Tree,
  filled: FilledVariables,
  result: RoutingResult,
  highThreshold = 0.8,
): EscalationAnalysis {
  const pathTaken = result.pathTaken
  const reasonText = result.escalationReason ?? ''
  const triggerKey = triggerVariable(tree, pathTaken)
  const entry = triggerKey ? filled[triggerKey] : undefined
  const triggerValue = entry?.value as string | number | boolean | undefined
  const triggerConfidence = entry?.confidence
  const noBranchMatched = /no branch matched/i.test(reasonText)

  let category: EscalationCategory
  if (triggerValue !== undefined && EMERGENCY_VALUES.has(String(triggerValue))) {
    // Emergency takes precedence — a confident red-flag value never waits.
    category = 'emergency'
  } else if (
    noBranchMatched ||
    (triggerValue !== undefined && AMBIGUOUS_VALUES.has(String(triggerValue))) ||
    (typeof triggerConfidence === 'number' && triggerConfidence < highThreshold)
  ) {
    category = 'ambiguous'
  } else {
    category = 'complex'
  }

  return { category, triggerKey, triggerValue, triggerConfidence, reasonText, pathTaken }
}

/** Human label for the escalation category (clinician packet). */
export function escalationCategoryLabel(analysis: EscalationAnalysis): string {
  switch (analysis.category) {
    case 'emergency':
      return 'Emergency red flag — escalated immediately'
    case 'ambiguous':
      return analysis.clarifiedKeys && analysis.clarifiedKeys.length > 0
        ? 'Ambiguous after clarification'
        : 'Ambiguous presentation'
    case 'complex':
      return 'Complex — needs human judgment'
  }
}
