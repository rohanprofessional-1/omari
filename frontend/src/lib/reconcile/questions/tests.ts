import type { Deriver, FlowInput, StepQuestion } from '../types'

/** Placeholder — replaced by the tests section build. */
export interface TestsQuestion extends StepQuestion {
  kind: 'tests'
}

export const deriveTestQuestions: Deriver<TestsQuestion> = (_input: FlowInput) => []
