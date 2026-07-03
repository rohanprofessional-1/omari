import type {
  Condition,
  FilledVariables,
  KeyedCondition,
  SpecialistNode,
  Tree,
  WorkupItem,
  WorkupSpec,
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
  /** The path-conditioned workup, resolved against the filled variables. Present only when routed. */
  resolvedWorkup?: ResolvedWorkup
  /** Every node id visited, in order, including the node we stopped on. */
  pathTaken: string[]
  /** The single blocking variable when outcome === 'incomplete'; else []. */
  missingVariables: string[]
  /** Human-readable reason when outcome === 'escalated'. */
  escalationReason?: string
}

/* -------------------------------------------------------------------------- */
/* Workup resolution (schema v2 — path-conditioned workup)                    */
/* -------------------------------------------------------------------------- */

/** One concrete workup item after resolution, with its provenance. */
export interface ResolvedWorkupItem extends WorkupItem {
  source: 'always' | 'conditional'
  /** The surgeon's counterfactual, for conditional items. */
  reason?: string
}

/** An item a do-not-order guard withheld, and why. */
export interface WithheldWorkupItem {
  item: string
  requiredCondition: KeyedCondition
}

export interface ResolvedWorkup {
  /** The concrete ordered list for THIS patient's path. */
  ordered: ResolvedWorkupItem[]
  /** Items suppressed by doNotOrderUnless guards (over-ordering protection). */
  withheld: WithheldWorkupItem[]
  /** True when escalateWorkupIf fired: the surgeon must choose diagnostics. */
  escalated: boolean
  escalationReason?: string
}

/** Evaluate a keyed condition against the filled variables. Missing value ⇒ false. */
function evaluateKeyedCondition(
  condition: KeyedCondition,
  filled: FilledVariables,
): boolean {
  const resolved = filled[condition.key]
  if (resolved === undefined) return false
  return evaluateCondition(condition, resolved.value)
}

/** Case/whitespace-insensitive name match for do-not-order guards. */
function workupNameMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Resolve a WorkupSpec against the patient's filled variables into the
 * concrete ordered/withheld lists. Pure and total — the deterministic engine
 * (never an LLM) decides the workup, exactly like routing.
 *
 * Order of operations (guards win over orders — over-ordering is the failure
 * mode we protect against):
 *   1. take `always`
 *   2. add each `conditional` whose condition holds
 *   3. remove anything a `doNotOrderUnless` guard forbids (condition not met)
 *   4. check `escalateWorkupIf` — ambiguity goes to the surgeon
 */
export function resolveWorkup(
  spec: WorkupSpec,
  filled: FilledVariables,
): ResolvedWorkup {
  const ordered: ResolvedWorkupItem[] = spec.always.map((item) => ({
    ...item,
    source: 'always' as const,
  }))

  for (const rule of spec.conditional) {
    if (evaluateKeyedCondition(rule.when, filled)) {
      ordered.push({ ...rule.item, source: 'conditional', reason: rule.reason })
    }
  }

  const withheld: WithheldWorkupItem[] = []
  const kept: ResolvedWorkupItem[] = []
  for (const item of ordered) {
    const guard = spec.doNotOrderUnless.find((g) =>
      workupNameMatches(g.item, item.name),
    )
    if (guard && !evaluateKeyedCondition(guard.requiredCondition, filled)) {
      withheld.push({ item: item.name, requiredCondition: guard.requiredCondition })
    } else {
      kept.push(item)
    }
  }

  const escalated =
    spec.escalateWorkupIf !== undefined &&
    evaluateKeyedCondition(spec.escalateWorkupIf, filled)

  return {
    ordered: kept,
    withheld,
    escalated,
    escalationReason: escalated
      ? `Workup requires surgeon review (condition on "${spec.escalateWorkupIf!.key}" met).`
      : undefined,
  }
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
      return {
        outcome: 'routed',
        specialist: node,
        resolvedWorkup: resolveWorkup(node.workup, filled),
        pathTaken,
        missingVariables: [],
      }
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
