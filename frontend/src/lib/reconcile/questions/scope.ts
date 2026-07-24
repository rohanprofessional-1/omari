import type { Deriver, FlowInput, StepQuestion } from '../types'

/** Placeholder — replaced by the scope section build. */
export interface ScopeQuestion extends StepQuestion {
  kind: 'scope'
}

export const deriveScopeQuestions: Deriver<ScopeQuestion> = (_input: FlowInput) => []
