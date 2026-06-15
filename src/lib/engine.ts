import type {
  Condition,
  FilledVariables,
  SpecialistNode,
  Tree,
} from '../types/tree'

/**
 * Blume — deterministic routing engine.
 *
 * ⚠️ NO AI / LLM ANYWHERE IN THIS FILE. This is the brain that decides where
 * a patient routes, and it must be provably correct in isolation. The LLM
 * (added later) only fills `FilledVariables`; it never chooses a branch.
 *
 * The engine is RESUMABLE: it walks the tree as far as the variables it
 * currently has allow, and the moment it reaches a variable node whose value
 * is missing, it stops and reports that ONE variable. That is what lets the
 * conversation ask only for variables on the patient's actual path.
 */

export interface RoutingResult {
  outcome: 'routed' | 'escalated' | 'incomplete'
  /** Present only when outcome === 'routed'. */
  specialist?: SpecialistNode
  /** Every node id visited, in order, including the node we stopped on. */
  pathTaken: string[]
  /** The single blocking variable when outcome === 'incomplete'; else []. */
  missingVariables: string[]
  /** Human-readable reason when outcome === 'escalated'. */
  escalationReason?: string
}

/**
 * Evaluate a single branch condition against a resolved variable value.
 * Pure and total: any value the condition can't sensibly match returns false.
 */
export function evaluateCondition(condition: Condition, value: unknown): boolean {
  switch (condition.op) {
    case 'equals':
      // Strict equality; no coercion. 'yes' !== true, 5 !== '5'.
      return value === condition.value

    case 'range': {
      if (typeof value !== 'number' || Number.isNaN(value)) return false
      if (condition.min !== undefined && value < condition.min) return false
      if (condition.max !== undefined && value > condition.max) return false
      return true
    }

    case 'in':
      // `values` is string[]; compare on the string form of the value.
      return condition.values.includes(String(value))

    default: {
      // Exhaustiveness guard: if a new op is added, TS flags this.
      const _never: never = condition
      void _never
      return false
    }
  }
}

/**
 * Walk `tree` using `filled`, returning where the patient routes — or the
 * single next variable still needed to continue.
 */
export function runEngine(tree: Tree, filled: FilledVariables): RoutingResult {
  const nodesById = new Map(tree.nodes.map((n) => [n.id, n]))
  const pathTaken: string[] = []
  const visited = new Set<string>()

  let currentId = tree.rootNodeId

  // visited-set guard: every step moves to a not-yet-visited node, so the loop
  // can run at most `nodes.length` times before terminating.
  while (true) {
    // Malformed-tree guards — never expected for a Zod-valid, integrity-checked
    // tree, but the engine must remain total rather than loop or throw.
    if (visited.has(currentId)) {
      return {
        outcome: 'escalated',
        pathTaken,
        missingVariables: [],
        escalationReason: `Cycle detected at node "${currentId}"; tree is malformed.`,
      }
    }
    const node = nodesById.get(currentId)
    if (!node) {
      return {
        outcome: 'escalated',
        pathTaken,
        missingVariables: [],
        escalationReason: `Node "${currentId}" not found; tree is malformed.`,
      }
    }

    visited.add(currentId)
    pathTaken.push(currentId)

    if (node.type === 'specialist') {
      return { outcome: 'routed', specialist: node, pathTaken, missingVariables: [] }
    }

    if (node.type === 'escalation') {
      return {
        outcome: 'escalated',
        pathTaken,
        missingVariables: [],
        escalationReason: node.reason,
      }
    }

    // VariableNode: resume point. Stop here if we don't yet have the value.
    const resolved = filled[node.variableKey]
    if (resolved === undefined) {
      return {
        outcome: 'incomplete',
        pathTaken,
        missingVariables: [node.variableKey],
      }
    }

    // Follow the FIRST matching branch (authoring order is significant).
    const match = node.branches.find((b) =>
      evaluateCondition(b.condition, resolved.value),
    )

    if (!match) {
      return {
        outcome: 'escalated',
        pathTaken,
        missingVariables: [],
        escalationReason: `No branch matched value ${JSON.stringify(
          resolved.value,
        )} for variable "${node.variableKey}" at node "${node.id}".`,
      }
    }

    currentId = match.nextNodeId
  }
}
