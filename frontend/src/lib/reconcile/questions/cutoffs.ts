import type { Deriver, FlowInput, StepQuestion } from '../types'

/** Placeholder — replaced by the cutoffs section build. */
export interface CutoffQuestion extends StepQuestion {
  kind: 'cutoffs'
}

export const deriveCutoffQuestions: Deriver<CutoffQuestion> = (_input: FlowInput) => []
