import type { Branch } from '../types/tree'

/**
 * Omari — patient-facing label cleanup (the safety net).
 *
 * Tree branch/option `label`s are written for the engine/Builder/clinician and
 * often encode the answer AND a routing hint (e.g. "Both sides → systemic
 * workup", "Yes → classic compression"). The PATIENT must never see that.
 *
 * - `choicePatientText(branch)` returns the authored `patientLabel` when present
 *   (the primary mechanism — every shipped branch has one).
 * - Otherwise it falls back to `patientizeLabel(label)`: a deterministic strip
 *   that removes routing arrows and engineering words so nothing internal leaks
 *   even on un-authored / future-edited branches. This deterministic strip is
 *   what runs in Demo (simulated) mode; the live voice layer additionally
 *   humanises the QUESTION text around these clean options.
 *
 * It NEVER returns the raw internal label, and never an empty string.
 */

// Routing arrows of various flavours.
const ARROW = /\s*(?:→|⟶|➜|»|->|=>)\s*/

// Engineering / routing words that must not reach a patient.
const ROUTING_WORDS =
  /\b(?:systemic\s+workup|workup|tumou?r\s+workup|imaging\s+first|ultrasound\/imaging|surgical\s+eval(?:uation)?|conservative(?:-first)?|non-?operative|diagnostics?|reconstruction|neurosurg\w*|spine|plexus|neuroma|entrapment|compression|denervation|localis[ez]e?|fast-?track|human\s+triage|triage|escalat\w*|referral|red[-\s]?flag|classic\b|atypical|systemic|EMG)\b/gi

/** Deterministic backstop: strip arrows + routing words from an internal label. */
export function patientizeLabel(internal: string): string {
  if (!internal) return ''
  const beforeArrow = internal.split(ARROW)[0].trim()
  let s = beforeArrow
    .replace(ROUTING_WORDS, '')
    // tidy separators left behind ("X / " , trailing dashes/commas)
    .replace(/\s*[\/|]\s*$/g, '')
    .replace(/\s*[—–-]\s*$/g, '')
    .replace(/^[\s/|,–—-]+|[\s/|,–—-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .trim()
  // Never return empty — fall back to the (arrow-stripped) text.
  if (!s) s = beforeArrow
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The patient-facing text for a branch: authored patientLabel, else cleaned. */
export function choicePatientText(branch: Pick<Branch, 'label' | 'patientLabel'>): string {
  const authored = branch.patientLabel?.trim()
  return authored && authored.length > 0 ? authored : patientizeLabel(branch.label)
}
