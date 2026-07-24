import { VARIABLE_SPECS } from '../../data/variableSpecs'
import type { Branch, Tree, VariableNode } from '../../types/tree'
import type { MissingVariableInfo } from '../types'

/**
 * Dashboard — "what is this referral waiting on, and what hangs on the answer?"
 *
 * When the engine halts incomplete, the stop node is the ONE variable blocking
 * the route. This module turns that node into a coordinator-facing packet: the
 * question, who can answer it, and — per possible answer — where the referral
 * would go next (the gates).
 */

/** Strip any internal routing hint ('EMG abnormal → surgical eval' → 'EMG abnormal'). */
function cleanLabel(label: string): string {
  return label.split('→')[0].trim()
}

/** Every distinct terminal (specialist/escalation) node id reachable from
 *  `startId`, walking through any number of variable nodes. Cycle-guarded. */
function reachableTerminals(tree: Tree, startId: string): number {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const terminals = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (!node) continue
    if (node.type === 'variable') {
      for (const branch of node.branches) queue.push(branch.nextNodeId)
    } else {
      terminals.add(node.id)
    }
  }
  return terminals.size
}

/** Where one answer (branch) leads: a concrete destination when no further
 *  variable gates it, otherwise the count of destinations still in play. */
function gateFor(tree: Tree, branch: Branch): { answerLabel: string; leadsTo: string } {
  const answerLabel = cleanLabel(branch.label)
  const target = tree.nodes.find((n) => n.id === branch.nextNodeId)
  if (!target) return { answerLabel, leadsTo: 'unknown destination' }
  if (target.type === 'specialist') {
    return { answerLabel, leadsTo: `${target.specialistName} (${target.specialty})` }
  }
  if (target.type === 'escalation') {
    return { answerLabel, leadsTo: `Escalation: ${target.reason}` }
  }
  // A further variable node intervenes — count what is still reachable beyond it.
  const count = reachableTerminals(tree, target.id)
  return {
    answerLabel,
    leadsTo: `depends on ${target.variableKey} — ${count} possible destination${count === 1 ? '' : 's'}`,
  }
}

const WHO_CAN_SUPPLY: Record<VariableNode['dataSource'], MissingVariableInfo['whoCanSupply']> = {
  patient: 'patient',
  referral: 'referring office',
  record: 'medical records',
}

/**
 * Build the missing-variable packet for the variable node the engine halted on
 * (the last entry of RoutingResult.pathTaken when outcome === 'incomplete').
 */
export function buildMissingVariableInfo(tree: Tree, stopNodeId: string): MissingVariableInfo {
  const node = tree.nodes.find((n) => n.id === stopNodeId)
  if (!node || node.type !== 'variable') {
    throw new Error(`buildMissingVariableInfo: stop node "${stopNodeId}" is not a variable node.`)
  }
  const spec = VARIABLE_SPECS[node.variableKey]
  return {
    variableKey: node.variableKey,
    question: spec?.patientQuestion ?? node.prompt,
    clinicalPrompt: spec?.clinicalPrompt ?? node.prompt,
    whoCanSupply: WHO_CAN_SUPPLY[node.dataSource],
    gates: node.branches.map((branch) => gateFor(tree, branch)),
  }
}
