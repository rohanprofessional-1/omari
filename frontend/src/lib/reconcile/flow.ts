import type { Provenance } from '../deltas/schema'
import { deriveCaseQuestions } from './questions/cases'
import { deriveCutoffQuestions } from './questions/cutoffs'
import { deriveRoutingQuestions } from './questions/routing'
import { deriveSafetyQuestions } from './questions/safety'
import { deriveScopeQuestions } from './questions/scope'
import { deriveTestQuestions } from './questions/tests'
import type { FlowInput, SectionId, Step } from './types'

/**
 * Blume — the guided setup: which questions get asked, in what order.
 *
 * Six sections, one question per screen, always in the same sequence. A
 * surgeon can't land mid-process with no context, because there is no
 * mid-process to land in — only "question 12 of 23" with a way back.
 *
 * SECTION IDS ARE DISPLAY. `sessionStage` is the STORED vocabulary that goes
 * on every delta's provenance and must never be renamed; the labels beside it
 * are what a surgeon reads and are plain clinical language only.
 */

export interface SectionMeta {
  id: SectionId
  /** What the surgeon sees in the progress header and the jump list. */
  label: string
  /** Persisted on every delta this section writes. Never renamed. */
  sessionStage: NonNullable<Provenance['sessionStage']>
  /** One line in the opening screen's preview, given the question count. */
  preview: (count: number) => string
}

export const SECTIONS: SectionMeta[] = [
  {
    id: 'scope',
    label: 'What you treat',
    sessionStage: 'scope',
    preview: (n) => (n === 1 ? '1 question' : `${n} questions`),
  },
  {
    id: 'routing',
    label: 'Who sees what',
    sessionStage: 'mapping',
    preview: (n) => (n === 1 ? '1 kind of referral' : `${n} kinds of referral`),
  },
  {
    id: 'cutoffs',
    label: 'Your cutoffs',
    sessionStage: 'thresholds',
    preview: (n) => (n === 1 ? '1 question' : `${n} questions`),
  },
  {
    id: 'tests',
    label: 'Tests before the visit',
    sessionStage: 'workup',
    preview: (n) => (n === 1 ? '1 group of patients' : `${n} groups of patients`),
  },
  {
    id: 'cases',
    label: 'Check it against real patients',
    sessionStage: 'validation',
    preview: (n) => (n === 1 ? '1 referral' : `${n} referrals`),
  },
  {
    id: 'safety',
    label: 'Safety check',
    sessionStage: 'gaps',
    preview: () => 'a last look',
  },
]

export function sectionMeta(id: SectionId): SectionMeta {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]
}

/** The whole interview, in order. */
export function buildSteps(input: FlowInput): Step[] {
  const bySection: Array<[SectionId, Array<{ id: string; question: string; guidelineLine: string; stakesLine: string }>]> = [
    ['scope', deriveScopeQuestions(input)],
    ['routing', deriveRoutingQuestions(input)],
    ['cutoffs', deriveCutoffQuestions(input)],
    ['tests', deriveTestQuestions(input)],
    ['cases', deriveCaseQuestions(input)],
    ['safety', deriveSafetyQuestions(input)],
  ]
  const steps: Step[] = []
  for (const [section, questions] of bySection) {
    for (const question of questions) steps.push({ section, question })
  }
  return steps
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

/** Seconds a confirmation costs. Most screens are one click. */
const SECONDS_PER_QUESTION = 45

export function estimateMinutes(remaining: number): number {
  const minutes = Math.ceil((remaining * SECONDS_PER_QUESTION) / 60)
  if (minutes <= 1) return 1
  if (minutes <= 10) return minutes
  return Math.round(minutes / 5) * 5
}

/** "about 12 minutes left" — or an honest "last one". */
export function timeRemainingLine(remaining: number): string {
  if (remaining <= 0) return 'done'
  if (remaining === 1) return 'last one'
  const m = estimateMinutes(remaining)
  return `about ${m} minute${m === 1 ? '' : 's'} left`
}

/** How long the whole session will take, for the opening screen. */
export function totalTimeLine(total: number): string {
  const m = estimateMinutes(total)
  return m <= 1 ? 'a minute or two' : `about ${m} minutes`
}

/** Where each section starts, so "jump to a section" and the rail agree. */
export function sectionOffsets(steps: Step[]): Map<SectionId, { start: number; count: number }> {
  const out = new Map<SectionId, { start: number; count: number }>()
  steps.forEach((step, i) => {
    const entry = out.get(step.section)
    if (entry) entry.count += 1
    else out.set(step.section, { start: i, count: 1 })
  })
  return out
}

/** "Question 3 of 5" — position WITHIN the current section, not the whole run. */
export function positionInSection(steps: Step[], index: number): { position: number; total: number } {
  const section = steps[index]?.section
  if (!section) return { position: 0, total: 0 }
  const offsets = sectionOffsets(steps).get(section)
  if (!offsets) return { position: 0, total: 0 }
  return { position: index - offsets.start + 1, total: offsets.count }
}
