import type { Tree } from '../../types/tree'
import type { DeltaDraft } from '../deltas/api'
import type { GenCase } from '../generator/types'
import type { SessionAnswer } from './session'

/**
 * Blume — the contract every screen in the guided setup implements.
 *
 * The setup is an INTERVIEW, not a workbench. That means the shell owns
 * everything a person needs in order to act — where they are, how much is
 * left, how to go back, how to defer — and a section only ever supplies the
 * body of one card: the question, what the guideline says, what changes for
 * patients, and the controls.
 *
 * Two rules are enforced by this shape rather than by discipline:
 *
 *   1. EVERY question carries the guideline's own answer, so every screen is
 *      completable in one click and that click is always the safe one.
 *   2. Keeping the guideline calls `onAccept` and writes NO delta. Only a
 *      clinic that differs writes anything, and it writes exactly the delta
 *      the old workbench wrote — the delta model is untouched.
 */

export type SectionId = 'scope' | 'routing' | 'cutoffs' | 'tests' | 'cases' | 'safety'

/** Everything a section needs to derive its questions. Read-only. */
export interface FlowInput {
  /** The COMPILED tree — clinic decisions already applied. */
  tree: Tree
  roster: RosterEntry[]
  subspecialty: string | null
  /** Example referrals for the validation section; empty until they load. */
  cases: GenCase[]
}

export interface RosterEntry {
  id: string
  name: string
  specialty?: string | null
}

/**
 * The three lines every screen leads with. Written as a QUESTION a surgeon
 * would recognise, never as a report of what the software has.
 */
export interface StepQuestion {
  /** Stable across a guideline re-upload — built from normalized keys. */
  id: string
  /** "How long should someone have symptoms before you'll see them?" */
  question: string
  /** What the guideline says today. Always present; never blank. */
  guidelineLine: string
  /** What changes for patients if they answer differently. One sentence. */
  stakesLine: string
}

export interface Step<Q extends StepQuestion = StepQuestion> {
  section: SectionId
  question: Q
}

/** What a section component receives. The shell supplies all of it. */
export interface StepProps<Q extends StepQuestion = StepQuestion> {
  question: Q
  busy: boolean
  /** Set when they've already answered this one and come back to it. */
  recorded?: SessionAnswer
  /** Keep the guideline exactly as written. Writes NO delta. */
  onAccept: (summary: string) => void
  /** This clinic differs. Writes the deltas and records the change. */
  onChange: (drafts: DeltaDraft[], summary: string, note?: string) => void
  /** Needs a person, not a setting. Records a note, changes nothing. */
  onFlag: (summary: string, note: string) => void
}

/** A section's question derivation. Pure; never writes anything. */
export type Deriver<Q extends StepQuestion = StepQuestion> = (input: FlowInput) => Q[]
