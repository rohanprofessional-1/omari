import type { Deriver, FlowInput, StepQuestion } from '../types'

/** Placeholder — replaced by the routing section build. */
export interface RoutingQuestion extends StepQuestion {
  kind: 'routing'
}

export const deriveRoutingQuestions: Deriver<RoutingQuestion> = (_input: FlowInput) => []
