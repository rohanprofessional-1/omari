import type { Deriver, FlowInput, StepQuestion } from '../types'

/** Placeholder — replaced by the cases section build. */
export interface CaseQuestion extends StepQuestion {
  kind: 'cases'
}

export const deriveCaseQuestions: Deriver<CaseQuestion> = (_input: FlowInput) => []
