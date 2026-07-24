/**
 * Blume — the words that never reach a surgeon.
 *
 * Every one of these is OUR vocabulary for a thing, not theirs. A screen that
 * says "5 of 5 conditions need your number" is describing what the software
 * has; a screen that says "How long should someone have symptoms before you'll
 * see them?" is describing what the surgeon decides. This list is the
 * mechanical half of that rule — the half a test can enforce.
 *
 * The other half can't be automated: read the string aloud as if you were
 * sitting next to the surgeon. If you'd translate it before saying it, the
 * screen should say the translation instead.
 */

export const FORBIDDEN_WORDS = [
  'node',
  'endpoint',
  'tree',
  'delta',
  'reconcile',
  'gap sweep',
  'threshold',
  'variable',
  'condition',
  'mapping',
  'band',
  'publish',
  'scope',
  'branch',
  'anchor',
  'workup',
  'incomplete',
  'unreachable',
  'dangling',
  'terminal',
  'compile',
  'payload',
] as const

const PATTERN = new RegExp(`\\b(${FORBIDDEN_WORDS.join('|')})(s|es|ed|ing)?\\b`, 'i')

/** The first forbidden word in `text`, or null. */
export function findForbidden(text: string): string | null {
  const hit = text.match(PATTERN)
  return hit ? hit[0] : null
}

/**
 * Sweep an object's string fields (and nested arrays/objects) for our
 * vocabulary. Returns one `field: word — text` line per offence.
 */
export function sweepForbidden(value: unknown, path = ''): string[] {
  if (typeof value === 'string') {
    const hit = findForbidden(value)
    return hit ? [`${path || 'value'}: “${hit}” in ${JSON.stringify(value)}`] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => sweepForbidden(v, `${path}[${i}]`))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, v]) =>
      // `id` is internal plumbing and never rendered; skip it.
      key === 'id' ? [] : sweepForbidden(v, path ? `${path}.${key}` : key),
    )
  }
  return []
}
