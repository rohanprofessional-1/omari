import type { Deriver, FlowInput, StepQuestion } from '../types'

/** Placeholder — replaced by the safety section build. */
export interface SafetyQuestion extends StepQuestion {
  kind: 'safety'
}

export const deriveSafetyQuestions: Deriver<SafetyQuestion> = (_input: FlowInput) => []
