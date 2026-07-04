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

  /* ====================================================================== */
  /* Duke Nerve Center tree — deeper variable set (distinct keys so they do  */
  /* not collide with the simple sample tree's same-named variables).       */
  /* ====================================================================== */

  urgentRedFlag: {
    key: 'urgentRedFlag',
    clinicalPrompt:
      'Up-front red-flag / urgent-access screen (the center’s <72h SLA for acute nerve injury). Detect EMERGENCY presentations that must bypass full intake. The emergency VALUE strings deliberately match the engine’s emergency set so they short-circuit.',
    patientQuestion:
      'First, a quick safety check: is any of these happening — a recent serious injury or cut to the area; a lump that is growing fast; or weakness that is getting worse quickly (like a foot or hand suddenly not working)?',
    answerType: 'single_choice',
    options: ['acute_trauma', 'mass_lump', 'acute', 'none'],
    extractionHints:
      'Map to "acute_trauma" for an acute injury: laceration/knife/blast, avulsion, stretch or crush (e.g. a motor-vehicle accident), an open wound with new numbness/weakness, a suspected nerve cut with a surgical wound, or an acute (recent) brachial plexus injury (adult trauma or birth injury). Map to "mass_lump" ONLY for a mass/lump that is rapidly growing or sounds suspicious for tumour. Map to "acute" for rapidly progressive weakness, acute foot drop, or acute wrist drop, or cauda-equina-type signals (sudden bowel/bladder change with leg weakness/numbness). Map to "none" when there is NO such red flag — ongoing/chronic symptoms without acute injury, fast-growing mass, or rapidly progressive weakness. When unsure between a generic old injury and an acute one, prefer "none" and let intake clarify.',
  },
  presentationCategory: {
    key: 'presentationCategory',
    clinicalPrompt:
      'Non-urgent overall category that steers the deep routing: a compression/entrapment picture, an older (non-acute) traumatic injury, a stable mass, a pain-predominant picture, functional loss after an upper-motor-neuron event, or genuinely unclear.',
    patientQuestion:
      'Which of these best fits your situation overall?',
    answerType: 'single_choice',
    options: ['compression', 'traumatic_chronic', 'mass_stable', 'pain_predominant', 'functional_umn', 'unclear'],
    extractionHints:
      'Map to "compression" for ongoing pins-and-needles/numbness/weakness suggesting a pinched or entrapped nerve (carpal tunnel, cubital tunnel, etc.). Map to "traumatic_chronic" for symptoms following an OLD/healed injury or prior surgery (not acute — acute injuries are the red-flag screen). Map to "mass_stable" for a lump/mass that is stable or slowly changing. Map to "pain_predominant" when pain is by far the main problem and the cause/target is unclear. Map to "functional_umn" for loss of function (e.g. a stiff, weak limb) AFTER a stroke, brain injury, cerebral palsy, or spinal-cord injury. Use "unclear" only when it genuinely does not fit any of these.',
  },
  primarySymptom: {
    key: 'primarySymptom',
    clinicalPrompt:
      'The single most bothersome symptom. Muscle wasting flags advanced denervation and weights toward diagnostics / surgical urgency.',
    patientQuestion:
      'What is the single most bothersome part — pain, numbness or tingling, weakness, visible muscle wasting/shrinking, or a mix?',
    answerType: 'single_choice',
    options: ['pain', 'numbness_tingling', 'weakness', 'muscle_wasting', 'mixed'],
    extractionHints:
      'Choose "pain" for aching/burning/shooting pain as the chief complaint. Choose "numbness_tingling" for numb/asleep/pins-and-needles. Choose "weakness" for dropping things, weak grip, foot drop, muscles not working. Choose "muscle_wasting" when they describe a muscle visibly shrinking, thinning, or wasting away. Choose "mixed" when two or more are equally dominant.',
  },
  symptomRegion: {
    key: 'symptomRegion',
    clinicalPrompt:
      'Detailed anatomical territory (real Duke peripheral-nerve regions). Drives the upper-vs-lower and spine-vs-peripheral routing.',
    patientQuestion:
      'Where are the symptoms centred?',
    answerType: 'single_choice',
    options: ['neck_radiating', 'shoulder_upper_arm', 'elbow', 'forearm', 'wrist', 'hand_fingers', 'hip_thigh', 'knee', 'lower_leg', 'ankle_foot', 'multifocal'],
    extractionHints:
      'Map to "neck_radiating" when symptoms start in the neck/shoulder blade and travel down the arm. "shoulder_upper_arm" for the shoulder or upper arm. "elbow" around the elbow (funny-bone/ulnar). "forearm" for the forearm. "wrist" at the wrist. "hand_fingers" for hand, thumb, or fingers. "hip_thigh" for hip or outer/front thigh. "knee" around the knee/outer knee. "lower_leg" for the shin/calf. "ankle_foot" for the ankle, foot, or toes. Use "multifocal" when symptoms are in several separate areas or all over.',
  },
  laterality: {
    key: 'laterality',
    clinicalPrompt:
      'One side vs both. Bilateral symptoms raise suspicion for a systemic/diffuse process → neuromuscular neurology.',
    patientQuestion:
      'Is this on one side of your body, or both sides?',
    answerType: 'single_choice',
    options: ['one_side', 'both_sides'],
    extractionHints:
      'Map to "one_side" for left-only or right-only. Map to "both_sides" when both arms, both legs, or both sides are affected (even if one is worse).',
  },
  durationBand: {
    key: 'durationBand',
    clinicalPrompt:
      'Time course tied to the center’s 6–12 week referral guidance (refer if not improving by then). Drives conservative-vs-surgical timing.',
    patientQuestion:
      'How long has this been going on?',
    answerType: 'single_choice',
    options: ['acute_lt2wk', 'subacute_2_6wk', 'approaching_6_12wk', 'chronic_gt12wk'],
    extractionHints:
      'Map to "acute_lt2wk" for under ~2 weeks ("a few days", "this week"). "subacute_2_6wk" for roughly 2–6 weeks. "approaching_6_12wk" for about 6–12 weeks ("a couple of months", "around two months"). "chronic_gt12wk" for more than 3 months, many months, years, or "for as long as I can remember". Convert any stated number to the closest band.',
  },
  priorTraumaSurgery: {
    key: 'priorTraumaSurgery',
    clinicalPrompt:
      'Relevant history: a prior injury, a prior surgery (post-surgical neuroma / amputation pain), or none. Steers toward reconstruction / neuroma-pain surgery.',
    patientQuestion:
      'Has the affected area had a previous injury or a previous surgery (including any amputation)?',
    answerType: 'single_choice',
    options: ['recent_injury', 'prior_surgery', 'none'],
    extractionHints:
      'Map to "prior_surgery" for any previous operation or amputation in the area (post-surgical scar pain, stump/phantom pain, neuroma after surgery). Map to "recent_injury" for a previous (non-acute) injury to the area. Map to "none" if neither is mentioned.',
  },
  nerveStudyStatus: {
    key: 'nerveStudyStatus',
    clinicalPrompt:
      'Whether EMG / nerve conduction studies exist and their result. Gates surgical-vs-diagnostic routing.',
    patientQuestion:
      'Have you had a nerve test (EMG or nerve conduction study)? If so, what did it show?',
    answerType: 'single_choice',
    options: ['not_done', 'done_normal', 'done_abnormal', 'unsure'],
    extractionHints:
      'Map to "not_done" if no nerve test has been done. "done_normal" if a nerve test was normal/clear. "done_abnormal" if it showed compression/entrapment/denervation/any abnormality. "unsure" if a test was done but they do not know the result.',
  },
  nightOrPositional: {
    key: 'nightOrPositional',
    clinicalPrompt:
      'Night-time or position-dependent symptoms — a classic compressive/entrapment pattern (e.g. carpal tunnel waking them at night).',
    patientQuestion:
      'Are the symptoms worse at night, or when you hold the limb in a certain position (for example, waking you up, or worse on the phone or driving)?',
    answerType: 'single_choice',
    options: ['yes', 'no'],
    extractionHints:
      'Map to "yes" if symptoms are worse at night, wake them from sleep, or are clearly triggered by a position/posture. Map to "no" otherwise.',
  },
  progression: {
    key: 'progression',
    clinicalPrompt:
      'Trajectory: stable, slowly worsening, or rapidly worsening. Rapid worsening on the spine path escalates severity.',
    patientQuestion:
      'Over time, are things staying about the same, slowly getting worse, or quickly getting worse?',
    answerType: 'single_choice',
    options: ['stable', 'slowly_worsening', 'rapidly_worsening'],
    extractionHints:
      'Map to "stable" for unchanged / waxing-and-waning. "slowly_worsening" for a gradual decline over weeks-months. "rapidly_worsening" for a fast decline over days-weeks.',
  },
  functionalImpact: {
    key: 'functionalImpact',
    clinicalPrompt:
      'How much function is lost: mild, interferes with daily activity, or severe loss. Weights surgical-candidacy and which spine surgeon.',
    patientQuestion:
      'How much is this affecting your daily life — mild and manageable, interfering with daily activities, or a severe loss of use?',
    answerType: 'single_choice',
    options: ['mild', 'interferes_daily', 'severe_loss'],
    extractionHints:
      'Map to "mild" for minor/manageable. "interferes_daily" when it clearly limits work, sleep, or daily tasks. "severe_loss" for major loss of use, can’t work, can’t use the limb.',
  },
  systemicContext: {
    key: 'systemicContext',
    clinicalPrompt:
      'Systemic background: diabetes or a known systemic/autoimmune condition (predispose to / mimic neuropathy) → neuromuscular neurology.',
    patientQuestion:
      'Do you have diabetes, or any known autoimmune or systemic medical condition?',
    answerType: 'single_choice',
    options: ['diabetes', 'autoimmune_systemic', 'none'],
    extractionHints:
      'Map to "diabetes" if diabetes/high blood sugar is mentioned. "autoimmune_systemic" for lupus, rheumatoid arthritis, thyroid disease, vasculitis, or another systemic/autoimmune condition. "none" if neither is mentioned.',
  },
  umnHistory: {
    key: 'umnHistory',
    clinicalPrompt:
      'Upper-motor-neuron history (stroke / TBI / cerebral palsy / spinal-cord injury) → functional-restoration surgery (nerve+tendon+muscle transfer).',
    patientQuestion:
      'Have you had a stroke, a brain injury, cerebral palsy, or a spinal-cord injury?',
    answerType: 'single_choice',
    options: ['stroke', 'tbi', 'cerebral_palsy', 'spinal_cord_injury', 'none'],
    extractionHints:
      'Map to "stroke" for a prior stroke; "tbi" for a traumatic brain injury/head injury; "cerebral_palsy" for cerebral palsy; "spinal_cord_injury" for a spinal-cord injury or paralysis from a back/neck injury. Map to "none" if none of these.',
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
