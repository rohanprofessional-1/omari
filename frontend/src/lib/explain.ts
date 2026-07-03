import { evaluateCondition } from './engine'
import type { FilledVariables, Tree } from '../types/tree'

/**
 * Blume — "Why this route?" explainability.
 *
 * Derives a plain-English, auditable rationale for a routing/escalation decision
 * purely from the deterministic engine's output (the tree + the path it took +
 * the collected variables). No LLM involved — the rationale is exactly the
 * engine's own logic, replayed. For each variable node on the path it reports
 * the variable, the human-readable answer the patient gave (the branch the
 * engine matched), and the extractor's confidence in that value.
 */

export interface RouteReason {
  variableKey: string
  /** Prettified variable name, e.g. "Emg Status" → shown as the factor. */
  label: string
  /** Human-readable matched answer (branch patientLabel/label, else raw value). */
  answer: string
  /** Extractor confidence for this value (0–1), when available. */
  confidence?: number
}

function prettyKey(key: string): string {
  const words = key.replace(/([A-Z])/g, ' $1').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Strip any internal routing hint ("Both sides → systemic workup" → "Both sides"). */
function cleanLabel(label: string): string {
  return label.split('→')[0].trim()
}

/**
 * Walk the taken path and, for every variable hop, record the factor + the
 * answer that determined the next step. Terminal (specialist/escalation) nodes
 * are skipped — they're the outcome, not a reason.
 */
export function explainRoute(
  tree: Tree,
  pathTaken: string[],
  filled: FilledVariables,
): RouteReason[] {
  const reasons: RouteReason[] = []
  for (const id of pathTaken) {
    const node = tree.nodes.find((n) => n.id === id)
    if (!node || node.type !== 'variable') continue
    const fv = filled[node.variableKey]
    if (!fv) continue
    const branch = node.branches.find((b) => evaluateCondition(b.condition, fv.value))
    const answer = branch?.patientLabel || (branch ? cleanLabel(branch.label) : String(fv.value))
    reasons.push({
      variableKey: node.variableKey,
      label: prettyKey(node.variableKey),
      answer,
      confidence: typeof fv.confidence === 'number' ? fv.confidence : undefined,
    })
  }
  return reasons
}
