/**
 * Escalation reasons come straight off the tree's escalation nodes, and they
 * are authored as clinical paragraphs: a SHOUTED directive, a colon, then
 * several lines of inclusion criteria and instructions. Dropped raw into a
 * card they read as a wall of text — yet the part a surgeon scans for (the
 * verdict, "URGENT FAST-TRACK (<72h)") is buried at the head of it.
 *
 * This splits the verdict from the criteria so the card can lead with one and
 * clamp the other. Presentation only: nothing is dropped, and the caller still
 * renders `detail` in full once expanded.
 */

export interface EscalationReasonParts {
  /** The leading shouted directive, colon stripped — e.g. `URGENT FAST-TRACK (<72h)`. */
  directive?: string
  /** Everything after it — the clinical criteria, first letter cased up. */
  detail: string
}

/** Longest head we'll accept as a label rather than a sentence. */
const MAX_DIRECTIVE = 60

/**
 * A directive is a SHORT SHOUTED phrase. Parentheticals are qualifiers
 * ("(<72h)", "(adult)") and are exempt from the all-caps test, so a lowercase
 * unit inside them doesn't disqualify an otherwise obvious label.
 */
function isDirective(head: string): boolean {
  const letters = head.replace(/\([^)]*\)/g, '').replace(/[^A-Za-z]/g, '')
  return letters.length >= 3 && letters === letters.toUpperCase()
}

/** Split a raw escalation reason into its directive and its criteria. Total. */
export function splitEscalationReason(reason: string | undefined): EscalationReasonParts {
  const text = (reason ?? '').trim()
  const colon = text.indexOf(':')
  if (colon <= 0 || colon > MAX_DIRECTIVE) return { detail: text }

  const head = text.slice(0, colon).trim()
  const rest = text.slice(colon + 1).trim()
  // No criteria left, or the head is a sentence rather than a label — leave the
  // reason whole rather than inventing a heading out of half of it.
  if (!rest || !isDirective(head)) return { detail: text }

  return { directive: head, detail: rest.charAt(0).toUpperCase() + rest.slice(1) }
}
