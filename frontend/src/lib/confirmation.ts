import type { VariableNode, VariableSpec } from '../types/tree'
import { VARIABLE_SPECS } from '../data/variableSpecs'
import { deriveQuestion } from './runner'

/**
 * Omari — confirmation sentence composer.
 *
 * A confirmation must restate the MEANING of what the patient just said, by
 * combining the QUESTION's intent with the patient's answer — it must NEVER echo
 * a bare answer token ("it sounds like 'Neither'"). "Neither" is meaningless out
 * of context; "So, no diabetes or autoimmune conditions — is that right?" is not.
 *
 * `CONFIRM_CLAUSES` is the curated, deterministic restatement for every (variable,
 * value) the two shipped trees can produce — each clause is a self-contained
 * meaning that reads naturally when wrapped as "So, {clause} — is that right?".
 * For anything not curated (e.g. an out-of-options value from a live model), the
 * fallback still COMBINES the question's topic with the patient-facing label, so
 * the result is never a bare token and never an internal/raw value.
 */

/** keyed by `${variableKey}:${String(value)}` → a meaning clause (no leading "So"). */
const CONFIRM_CLAUSES: Record<string, string> = {
  /* ── simple sample tree ─────────────────────────────────────────────── */
  'presentationType:mass_lump': 'the main thing is a lump or swelling you can feel',
  'presentationType:acute_trauma': 'this started with a recent injury or accident',
  'presentationType:typical_nerve_symptoms':
    'this is mainly ongoing nerve-type symptoms — numbness, tingling, or shooting pain',
  'presentationType:unsure': "you're not quite sure yet how to describe what's going on",

  'dominantSymptom:pain': 'pain is the thing that bothers you most',
  'dominantSymptom:numbness_tingling': 'numbness or tingling is the main problem',
  'dominantSymptom:weakness': 'weakness is what bothers you most',
  'dominantSymptom:mixed': "it's really a mix of things rather than one main symptom",

  'symptomLocation:arm_hand': 'you feel it mostly in your arm or hand',
  'symptomLocation:leg_foot': 'you feel it mostly in your leg or foot',
  'symptomLocation:neck_radiating': 'it starts in your neck and travels down your arm',

  'symptomDuration:acute': 'this only started in the last few days',
  'symptomDuration:subacute': 'this has been going on for a few weeks',
  'symptomDuration:chronic': 'this has been going on for months or longer',

  'emgStatus:not_done': "you haven't had a nerve test yet",
  'emgStatus:done_normal': 'you had a nerve test and it came back normal',
  'emgStatus:done_abnormal': 'you had a nerve test and it showed something abnormal',

  /* ── Duke Nerve Center tree ─────────────────────────────────────────── */
  'urgentRedFlag:acute_trauma': 'this involves a recent, serious injury to the area',
  'urgentRedFlag:mass_lump': "there's a lump that's been growing quickly",
  'urgentRedFlag:acute': 'the weakness has been getting worse quickly',
  'urgentRedFlag:none': 'none of those urgent warning signs are happening',

  'presentationCategory:compression': 'this feels like a pinched or compressed nerve',
  'presentationCategory:traumatic_chronic': 'this follows an older injury or a previous surgery',
  'presentationCategory:mass_stable': "there's a lump that's stable or only slowly changing",
  'presentationCategory:pain_predominant': 'pain is by far the main problem',
  'presentationCategory:functional_umn':
    'this is about loss of function after a stroke, brain injury, or spinal-cord injury',
  'presentationCategory:unclear': "it doesn't clearly fit any one category yet",

  'primarySymptom:pain': 'pain is the single most bothersome thing',
  'primarySymptom:numbness_tingling': 'numbness or tingling is the most bothersome thing',
  'primarySymptom:weakness': 'weakness is the most bothersome thing',
  'primarySymptom:muscle_wasting': 'the main thing is a muscle visibly shrinking or wasting',
  'primarySymptom:mixed': "it's really a mix rather than one main symptom",

  'symptomRegion:neck_radiating': 'the symptoms start in your neck and shoot down your arm',
  'symptomRegion:shoulder_upper_arm': 'the symptoms are centred in your shoulder or upper arm',
  'symptomRegion:elbow': 'the symptoms are centred around your elbow',
  'symptomRegion:forearm': 'the symptoms are centred in your forearm',
  'symptomRegion:wrist': 'the symptoms are centred at your wrist',
  'symptomRegion:hand_fingers': 'the symptoms are centred in your hand or fingers',
  'symptomRegion:hip_thigh': 'the symptoms are centred in your hip or thigh',
  'symptomRegion:knee': 'the symptoms are centred around your knee',
  'symptomRegion:lower_leg': 'the symptoms are centred in your lower leg',
  'symptomRegion:ankle_foot': 'the symptoms are centred in your ankle or foot',
  'symptomRegion:multifocal': 'the symptoms are spread across several different areas',

  'laterality:one_side': "this is happening on just one side of your body",
  'laterality:both_sides': 'this is happening on both sides of your body',

  'durationBand:acute_lt2wk': 'this started within the last couple of weeks',
  'durationBand:subacute_2_6wk': 'this has been going on for a few weeks',
  'durationBand:approaching_6_12wk': 'this has been going on for around two to three months',
  'durationBand:chronic_gt12wk': 'this has been going on for more than three months',

  'priorTraumaSurgery:recent_injury': 'the affected area had a previous injury',
  'priorTraumaSurgery:prior_surgery': 'the affected area had a previous surgery or amputation',
  'priorTraumaSurgery:none': "the affected area hasn't had a previous injury or surgery",

  'nerveStudyStatus:not_done': "you haven't had a nerve test yet",
  'nerveStudyStatus:done_normal': 'you had a nerve test and it was normal',
  'nerveStudyStatus:done_abnormal': 'you had a nerve test and it showed something',
  'nerveStudyStatus:unsure': "you had a nerve test but you're not sure what it showed",

  'nightOrPositional:yes': 'it does get worse at night or in certain positions',
  'nightOrPositional:no': "it doesn't really get worse at night or in any particular position",

  'progression:stable': 'the symptoms have been holding steady, not really getting better or worse',
  'progression:slowly_worsening': 'the symptoms have been slowly getting worse',
  'progression:rapidly_worsening': 'the symptoms have been getting worse quickly',

  'functionalImpact:mild': "this is mild and still manageable",
  'functionalImpact:interferes_daily': 'this is interfering with your daily activities',
  'functionalImpact:severe_loss': 'this is causing a severe loss of use',

  'systemicContext:diabetes': 'you have diabetes',
  'systemicContext:autoimmune_systemic': 'you have an autoimmune or other systemic condition',
  'systemicContext:none': 'no diabetes or autoimmune conditions',

  'umnHistory:stroke': "you've had a stroke",
  'umnHistory:tbi': "you've had a brain injury",
  'umnHistory:cerebral_palsy': 'you have cerebral palsy',
  'umnHistory:spinal_cord_injury': "you've had a spinal-cord injury",
  'umnHistory:none': "you haven't had a stroke, brain injury, or spinal-cord injury",
}

/** Plain, patient-facing phrasing of a value (its branch's patientLabel) — never
 *  the internal label / routing hint, never quoted. */
export function patientValueLabel(
  node: VariableNode | undefined,
  value: unknown,
  spec?: VariableSpec,
): string {
  if (!node) return String(value)
  const q = deriveQuestion(node, spec ?? VARIABLE_SPECS[node.variableKey])
  const match = q.choices.find((c) => c.value === value)
  return match?.patientLabel ?? String(value)
}

const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

/**
 * Compose the single confirmation sentence shown to the patient. It ALWAYS
 * combines the question's meaning with the patient's answer — never a bare token.
 */
export function composeConfirmation(
  node: VariableNode | undefined,
  value: unknown,
  spec?: VariableSpec,
): string {
  const resolvedSpec = spec ?? (node ? VARIABLE_SPECS[node.variableKey] : undefined)
  const key = node?.variableKey ?? resolvedSpec?.key
  const clause = key != null ? CONFIRM_CLAUSES[`${key}:${String(value)}`] : undefined
  if (clause) return `So, ${clause} — is that right?`

  // Fallback (uncurated value): still combine the QUESTION's topic with the
  // patient-facing label so it reads as meaning, not a raw token.
  const label = patientValueLabel(node, value, resolvedSpec)
  const topic = resolvedSpec?.patientQuestion?.replace(/\s*[?.]+\s*$/, '')
  if (topic) {
    return `So, on “${lowerFirst(topic)}” — you’re telling me ${lowerFirst(label)}. Did I get that right?`
  }
  return `So, it sounds like ${lowerFirst(label)} — is that right?`
}
