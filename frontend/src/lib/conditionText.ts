import type { Condition, KeyedCondition } from '../types/tree'

/**
 * Blume — tiny plain-English renderers for conditions, used anywhere a
 * WorkupSpec rule or branch condition is shown to a clinician. Deterministic;
 * no LLM.
 */

/** "is below the knee", "is one of a, b", "is between 3 and 6". */
export function describeCondition(condition: Condition): string {
  switch (condition.op) {
    case 'equals':
      return `is ${String(condition.value)}`
    case 'in':
      return `is one of ${condition.values.join(', ')}`
    case 'range': {
      if (condition.min !== undefined && condition.max !== undefined)
        return `is between ${condition.min} and ${condition.max}`
      if (condition.min !== undefined) return `is at least ${condition.min}`
      if (condition.max !== undefined) return `is at most ${condition.max}`
      return 'is any value'
    }
  }
}

/** "symptom_location is below the knee". */
export function describeKeyedCondition(condition: KeyedCondition): string {
  return `${condition.key} ${describeCondition(condition)}`
}
