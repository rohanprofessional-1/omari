import { z } from 'zod'
import { VariableSpecSchema, type VariableSpec } from '../types/tree'

/**
 * Blume — variable specifications.
 *
 * A lookup keyed by `variableKey` describing every variable the sample tree
 * can ask about. Each spec carries:
 *  - clinicalPrompt:   how a clinician thinks about the variable
 *  - patientQuestion:  plain language a frightened, non-medical patient can answer
 *  - answerType/options: the shape of a valid answer (drives the UI + validation)
 *  - extractionHints:  how an LLM should recognise this variable in messy text
 *
 * The option VALUES here are the same string values the tree's branch
 * conditions compare against — keep them in sync. The LLM extracts these
 * values; the deterministic engine decides where they route.
 */

const VARIABLE_SPECS_RAW: Record<string, VariableSpec> = {
  presentationType: {
    key: 'presentationType',
    clinicalPrompt:
      'Red-flag screen. Classify the overall presentation before any nerve-specific triage: a palpable mass, an acute traumatic injury, typical compressive/neuropathic symptoms, or genuinely unclear.',
    patientQuestion:
      'Which of these best describes what is going on right now?',
    answerType: 'single_choice',
    options: ['mass_lump', 'acute_trauma', 'typical_nerve_symptoms', 'unsure'],
    extractionHints:
      'Map to "mass_lump" for any mention of a lump, bump, swelling, knot, or growth they can feel. Map to "acute_trauma" for a recent injury, cut, accident, fall, fracture, or "it happened suddenly after X". Map to "typical_nerve_symptoms" for ongoing pins-and-needles, numbness, shooting pain, or weakness without a lump or recent injury. Use "unsure" only when the text is too vague to place.',
  },
  dominantSymptom: {
    key: 'dominantSymptom',
    clinicalPrompt:
      'The single most bothersome symptom, used to weight the differential between compressive pain, sensory loss, motor loss, or a mixed picture.',
    patientQuestion:
      'What bothers you the most — pain, numbness or tingling, weakness, or a mix of these?',
    answerType: 'single_choice',
    options: ['pain', 'numbness_tingling', 'weakness', 'mixed'],
    extractionHints:
      'Choose "pain" for aching, burning, shooting, or electric pain as the chief complaint. Choose "numbness_tingling" for numb, asleep, pins-and-needles, or tingling. Choose "weakness" for dropping things, a weak grip, foot drop, or muscles "not working". Choose "mixed" when two or more are described as equally dominant.',
  },
  symptomLocation: {
    key: 'symptomLocation',
    clinicalPrompt:
      'Primary anatomical territory of the symptoms. The main anatomical router: upper limb vs lower limb vs neck-radiating drives which sub-specialty sees the patient.',
    patientQuestion:
      'Where do you feel it the most?',
    answerType: 'single_choice',
    options: ['arm_hand', 'leg_foot', 'neck_radiating'],
    extractionHints:
      'Map to "arm_hand" for fingers, thumb, hand, wrist, forearm, or elbow. Map to "leg_foot" for foot, toes, ankle, calf, leg, or thigh. Map to "neck_radiating" when symptoms start in the neck or shoulder and shoot/travel down into the arm. If both an arm and the neck are mentioned with radiation, prefer "neck_radiating".',
  },
  symptomDuration: {
    key: 'symptomDuration',
    clinicalPrompt:
      'Time course since onset. Acute (days), subacute (weeks), or chronic (months or longer). Influences urgency and the conservative-vs-surgical decision.',
    patientQuestion:
      'How long has this been going on?',
    answerType: 'single_choice',
    options: ['acute', 'subacute', 'chronic'],
    extractionHints:
      'Map to "acute" for hours to a few days, "just started", "since yesterday". Map to "subacute" for roughly 1–6 weeks ("a couple of weeks"). Map to "chronic" for months, years, "for as long as I can remember", or "on and off for ages". Convert any stated number into the closest bucket.',
  },
  emgStatus: {
    key: 'emgStatus',
    clinicalPrompt:
      'Whether nerve conduction studies / EMG have been performed and, if so, the result. Pulled from the referral or medical record rather than the patient.',
    patientQuestion:
      'Have you had a nerve test (sometimes called an EMG or a nerve conduction study) — and if so, what did they tell you?',
    answerType: 'single_choice',
    options: ['not_done', 'done_normal', 'done_abnormal'],
    extractionHints:
      'Map to "not_done" if there is no mention of EMG/NCS or the patient says they have not had one. Map to "done_normal" when a nerve test was done and reported normal/clear/unremarkable. Map to "done_abnormal" when a nerve test showed compression, entrapment, denervation, or any abnormal finding. Treat "electrodiagnostic study", "nerve conduction", and "EMG" as the same test.',
  },
}

/**
 * Validate the whole lookup at import time so a malformed spec (wrong
 * answerType, missing field, etc.) fails loudly the moment the app loads.
 */
export const VARIABLE_SPECS: Record<string, VariableSpec> = z
  .record(z.string(), VariableSpecSchema)
  .parse(VARIABLE_SPECS_RAW)

/** Convenience accessor; throws if a key is requested that has no spec. */
export function getVariableSpec(key: string): VariableSpec {
  const spec = VARIABLE_SPECS[key]
  if (!spec) {
    throw new Error(`No VariableSpec defined for variableKey "${key}".`)
  }
  return spec
}
