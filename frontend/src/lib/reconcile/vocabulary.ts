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
 * Fields the sweep must not judge, for two different reasons.
 *
 * PLUMBING never reaches a screen — ids, kinds, anchors, the nodes a question
 * was derived from. A discriminator that happens to be the string 'scope' is
 * not a copy problem.
 *
 * QUOTATION is the guideline's own words, shown verbatim behind a "guideline"
 * expander with its citation. When a guideline says "thresholds", quoting it
 * accurately is the whole point; paraphrasing it to satisfy our style rules
 * would be worse than the offence. The rule governs what we WRITE.
 */
const PLUMBING_KEYS = new Set([
  'id',
  'kind',
  'shape',
  'mode',
  'source',
  'key',
  'keys',
  'anchor',
  'anchors',
  'node',
  'nodes',
  'targets',
  'destinations',
  'roster',
  'candidate',
  'decisions',
  'choices',
  'condition',
  'conditionFingerprint',
  'answerTypeChange',
  'bounds',
  'span',
  'cutPoints',
  'position',
  'total',
  'unavailable',
  'suggested',
  'stranded',
])

const QUOTATION_KEYS = new Set([
  'clinicalBasis',
  'cpgBasis',
  'fullText',
  'guidelineQuote',
  'label',
  'narrative',
  'prompt',
  'protocol',
])

function isExempt(key: string): boolean {
  return PLUMBING_KEYS.has(key) || QUOTATION_KEYS.has(key)
}

/**
 * Sweep the strings a screen actually WRITES for our vocabulary. Returns one
 * `field: word — text` line per offence.
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
      isExempt(key) ? [] : sweepForbidden(v, path ? `${path}.${key}` : key),
    )
  }
  return []
}
