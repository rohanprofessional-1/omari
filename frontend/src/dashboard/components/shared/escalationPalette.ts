import type { BadgeTone } from './Badge'

/**
 * How an escalation category reads, in words and in colour.
 *
 * Both the surgeon brief and the detail screen's conclusion panel used to carry
 * their own copy of this; they drifted apart once already. Status colour appears
 * only as small badges and 2px rails, per the dash- palette rules.
 */

export type EscalationCategory = 'emergency' | 'ambiguous' | 'complex'

export const ESCALATION_CATEGORY_LABELS: Record<string, string> = {
  emergency: 'Emergency',
  ambiguous: 'Ambiguous',
  complex: 'Complex',
}

export const ESCALATION_TONES: Record<string, BadgeTone> = {
  emergency: 'red',
  ambiguous: 'amber',
  complex: 'slate',
}

/** Label for a category, falling back to the raw value rather than hiding it. */
export function escalationLabel(category: string | undefined): string | undefined {
  if (!category) return undefined
  return ESCALATION_CATEGORY_LABELS[category] ?? category
}

/** Tone for a category — red is the safe default for anything unrecognised. */
export function escalationTone(category: string | undefined): BadgeTone {
  return (category && ESCALATION_TONES[category]) || 'red'
}
