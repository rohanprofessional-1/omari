import { normalizeKey } from '../deltas/resolve'

/**
 * Blume — the rendering bridge for the guided clinic setup.
 *
 * CPG extraction stores whole guideline sentences as item labels ("Referral
 * for evaluation of suspected internal derangement (mechanical symptoms
 * present despite possible absence of significant radiographic change)").
 * A surgeon can't scan those. This module derives a short headline for
 * DISPLAY ONLY — deterministically, never by a model, so it can't drift or
 * invent clinical meaning. Stored data is never touched: the full sentence
 * stays available on expand, with its citation.
 */

/** Above this many words, a label gets a headline instead of being shown raw. */
const VERBOSE_WORDS = 12
/** Headlines are hard-capped here. */
const HEADLINE_WORDS = 10

/** Phrases that carry no clinical information at the head of a label. */
const LEADING_FILLER: RegExp[] = [
  /^referral for (the )?(evaluation|assessment|management) of\s+/i,
  /^evaluate (the )?appropriateness of\s+/i,
  /^(evaluation|assessment|referral) for\s+/i,
  /^consider(ation of)?\s+/i,
]

/** Mid-sentence padding safe to drop without changing meaning. */
const INLINE_FILLER: Array<[RegExp, string]> = [[/\band document\b/gi, '']]

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

export function wordCount(text: string): number {
  return words(text).length
}

/** True when a stored label is too long to use as primary text. */
export function isVerbose(text: string | undefined | null): boolean {
  return wordCount(text ?? '') > VERBOSE_WORDS
}

/**
 * A short, plain headline for a stored label. Idempotent, and a no-op for
 * labels that are already short.
 */
export function headline(text: string | undefined | null): string {
  let out = String(text ?? '').replace(/\*\*/g, '').trim()
  if (!out) return ''

  // 1. Keep only the leading clause — guideline sentences qualify AFTER a
  //    dash, a semicolon, or an opening parenthesis, never before one.
  out = out.split(/\s+—\s+|\s+--\s+|;|\s\(/)[0].trim()

  // 2. Drop framing that says nothing clinical.
  for (const re of LEADING_FILLER) out = out.replace(re, '')
  for (const [re, to] of INLINE_FILLER) out = out.replace(re, to)
  out = out.replace(/\s{2,}/g, ' ').replace(/[.,;:]+$/, '').trim()

  // 3. Hard cap.
  const w = words(out)
  if (w.length > HEADLINE_WORDS) out = `${w.slice(0, HEADLINE_WORDS).join(' ')}…`

  return out.charAt(0).toUpperCase() + out.slice(1)
}

const UNIT_SUFFIX = /_(weeks?|months?|days?|years?)$/i
const NOISE_SUFFIX = /_(present|status)$/i

/** The unit a numeric value is measured in, inferred from its key. */
export function unitOf(variableKey: string): string {
  const key = normalizeKey(variableKey)
  const m = key.match(UNIT_SUFFIX)
  if (m) return `${m[1].toLowerCase().replace(/s$/, '')}s`
  if (/(^|_)age($|_)/.test(key)) return 'years'
  return ''
}

/** A stored key as a surgeon would say it. */
export function humanizeKey(variableKey: string): string {
  const key = normalizeKey(variableKey).replace(UNIT_SUFFIX, '')
  return key.replace(/_/g, ' ').trim() || normalizeKey(variableKey).replace(/_/g, ' ')
}

/** Like `humanizeKey`, but also drops trailing noise words ("_present"). */
export function subjectOf(variableKey: string): string {
  return humanizeKey(normalizeKey(variableKey).replace(NOISE_SUFFIX, ''))
}

/** Numbers as a person writes them: 6, not 6.00; 6.5 stays 6.5. */
export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

/**
 * Tidy a stored label for use inside a sentence: strip markdown, turn
 * comparison glyphs into words, and lowercase a leading capital that only
 * exists because it started a label.
 */
export function tidyLabel(label: string): string {
  let out = label
    .replace(/\*\*/g, '')
    .replace(/^\s*<\s*/, 'under ')
    .replace(/^\s*>\s*/, 'over ')
    .replace(/^\s*≤\s*/, 'up to ')
    .replace(/^\s*≥\s*/, 'from ')
    .replace(/\s*[–—-]\s*(?=\d)/g, ' to ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (/^[A-Z][a-z]/.test(out)) out = out.charAt(0).toLowerCase() + out.slice(1)
  return out
}

/**
 * Drop a word every label shares at the start ("Duration < 6 weeks",
 * "Duration 6 weeks – 6 months" → "< 6 weeks", "6 weeks – 6 months"), so a
 * list of groups reads as a sentence instead of a column of repetition.
 */
export function stripSharedPrefix(labels: string[]): string[] {
  if (labels.length < 2) return labels
  let out = labels.map((l) => l.replace(/\*\*/g, '').trim())
  for (let guard = 0; guard < 3; guard++) {
    const heads = out.map((l) => l.split(/\s+/)[0]?.toLowerCase() ?? '')
    const shared = heads[0] && heads.every((h) => h === heads[0])
    const allHaveMore = out.every((l) => l.split(/\s+/).length > 1)
    if (!shared || !allHaveMore) break
    out = out.map((l) => l.split(/\s+/).slice(1).join(' '))
  }
  return out
}

/** Join a list the way a person speaks it: "a, b and c". */
export function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** Small counts read better as words in a sentence. */
export function countWord(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n)
}

/** "1 test" / "3 tests" — the count with its noun agreeing. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`
}
