import type {
  FilledVariables,
  SpecialistNode,
  VariableNode,
  VariableSpec,
} from '../types/tree'
import { choicePatientText } from './patientLabel'

/**
 * Blume — Runner helpers (deterministic, no AI).
 *
 * Turns a variable node (+ optional VariableSpec) into a concrete question,
 * builds FilledVariables from a transcript, and fills a specialist's
 * reasoning template. Routing itself is done entirely by the engine.
 */

export interface Choice {
  /** INTERNAL label (engine/Builder/clinician). May contain routing hints. */
  label: string
  /** Plain-English, arrow-free phrasing shown to the patient (chips + confirms). */
  patientLabel: string
  value: string | number | boolean
}

export interface DerivedQuestion {
  key: string
  questionText: string
  /** Optional clinician-facing context shown under the question. */
  helpText?: string
  dataSource: VariableNode['dataSource']
  kind: 'choice' | 'number' | 'boolean' | 'text'
  choices: Choice[]
}

/** One answered step in the Runner conversation. */
export interface TranscriptEntry {
  key: string
  questionText: string
  answerLabel: string
  value: string | number | boolean
}

/**
 * Derive the question to ask for a variable node. Choices are taken from the
 * node's OWN branches (human labels + the exact values the engine matches on),
 * so an answer always routes deterministically. The VariableSpec, when present,
 * supplies the friendlier patient-facing wording.
 */
export function deriveQuestion(
  node: VariableNode,
  spec: VariableSpec | undefined,
): DerivedQuestion {
  const choices: Choice[] = []
  let hasRange = false

  for (const branch of node.branches) {
    const c = branch.condition
    const patient = choicePatientText(branch)
    if (c.op === 'equals') {
      choices.push({ label: branch.label, patientLabel: patient, value: c.value })
    } else if (c.op === 'in') {
      if (c.values.length === 1) {
        choices.push({ label: branch.label, patientLabel: patient, value: c.values[0] })
      } else {
        for (const v of c.values)
          choices.push({ label: `${branch.label}: ${v}`, patientLabel: `${patient}: ${v}`, value: v })
      }
    } else {
      hasRange = true
    }
  }

  let kind: DerivedQuestion['kind']
  if (choices.length > 0) kind = 'choice'
  else if (hasRange || spec?.answerType === 'number') kind = 'number'
  else if (spec?.answerType === 'boolean') kind = 'boolean'
  else kind = 'text'

  return {
    key: node.variableKey,
    questionText: spec?.patientQuestion || node.prompt || `What is “${node.variableKey}”?`,
    helpText: spec?.clinicalPrompt,
    dataSource: node.dataSource,
    kind,
    choices,
  }
}

/** Build the engine's FilledVariables from the answered transcript. */
export function buildFilled(transcript: TranscriptEntry[]): FilledVariables {
  const filled: FilledVariables = {}
  for (const entry of transcript) {
    // Manual answers are certain; the LLM (later) would supply a real score.
    filled[entry.key] = { value: entry.value, confidence: 1 }
  }
  return filled
}

/** Resolve {placeholders} in a specialist's reasoning template. */
export function fillTemplate(
  template: string,
  specialist: SpecialistNode,
  filled: FilledVariables,
): string {
  const map: Record<string, string> = {
    specialistName: specialist.specialistName,
    specialty: specialist.specialty,
    urgency: specialist.urgency,
  }
  for (const [key, v] of Object.entries(filled)) {
    map[key] = String(v.value)
  }
  // A template may reference a variable that wasn't asked on this path; show a
  // neutral word rather than a literal {placeholder}.
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in map ? map[key] : 'unspecified',
  )
}
