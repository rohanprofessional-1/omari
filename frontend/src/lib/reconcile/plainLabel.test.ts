/**
 * Blume — rendering-bridge tests.
 *
 * CPG extraction stores whole guideline sentences as item labels. Fixing that
 * is a separate problem; this module's job is to make the UI degrade
 * gracefully around it, deterministically, without ever altering what's
 * stored. Every long string asserted here is VERBATIM from the real generated
 * tree (tree.json, a knee appropriateness CPG), because a headline rule that
 * only works on invented fixtures is worthless.
 *
 * Same self-asserting style as deltas.test.ts: no framework, run via `npm test`.
 */
import {
  countWord,
  formatNumber,
  headline,
  humanizeKey,
  isVerbose,
  joinPhrases,
  plural,
  stripSharedPrefix,
  subjectOf,
  tidyLabel,
  unitOf,
  wordCount,
} from './plainLabel'
import { findForbidden, sweepForbidden } from './vocabulary'

declare const process: { exitCode?: number } | undefined

/* Verbatim from tree.json. */
const DERANGEMENT =
  'Referral for evaluation of suspected internal derangement (mechanical symptoms present despite possible absence of significant radiographic change)'
const STANDARD_PATHWAY =
  'Referral via standard pathway — appropriateness supported by symptom chronicity, radiographic severity, and documented failure of conservative treatment'
const CONSERVATIVE =
  'Continue and document conservative management; reassess referral appropriateness as chronicity, radiographic severity, or treatment failure criteria are met'
const APPROPRIATENESS = 'Evaluate appropriateness of referral to orthopedic surgery versus continued conservative management'
const SHORT = 'Surgical evaluation for operative intervention'

const checks: Array<{ name: string; run: () => string | null }> = [
  {
    name: 'a 17-word guideline sentence becomes something scannable',
    run: () => (headline(DERANGEMENT) === 'Suspected internal derangement' ? null : `got “${headline(DERANGEMENT)}”`),
  },
  {
    name: 'a sentence that qualifies after a dash keeps only the claim',
    run: () =>
      headline(STANDARD_PATHWAY) === 'Referral via standard pathway' ? null : `got “${headline(STANDARD_PATHWAY)}”`,
  },
  {
    name: 'a sentence that qualifies after a semicolon keeps only the action',
    run: () => (headline(CONSERVATIVE) === 'Continue conservative management' ? null : `got “${headline(CONSERVATIVE)}”`),
  },
  {
    name: 'framing that says nothing clinical is dropped',
    run: () =>
      headline(APPROPRIATENESS) === 'Referral to orthopedic surgery versus continued conservative management'
        ? null
        : `got “${headline(APPROPRIATENESS)}”`,
  },
  {
    name: 'a label that is already short is left exactly alone',
    run: () => (headline(SHORT) === SHORT ? null : `short label was rewritten to “${headline(SHORT)}”`),
  },
  {
    name: 'headlines are idempotent — re-rendering never erodes a label',
    run: () => {
      for (const text of [DERANGEMENT, STANDARD_PATHWAY, CONSERVATIVE, APPROPRIATENESS, SHORT]) {
        if (headline(headline(text)) !== headline(text)) return `not idempotent for “${text.slice(0, 40)}…”`
      }
      return null
    },
  },
  {
    name: 'no headline exceeds ten words',
    run: () => {
      for (const text of [DERANGEMENT, STANDARD_PATHWAY, CONSERVATIVE, APPROPRIATENESS, 'a b c d e f g h i j k l m n']) {
        const w = wordCount(headline(text).replace('…', ''))
        if (w > 10) return `“${text.slice(0, 30)}…” kept ${w} words`
      }
      return null
    },
  },
  {
    name: 'the verbose test matches the threshold the bridge documents',
    run: () => {
      if (!isVerbose(DERANGEMENT)) return 'a 17-word label was not treated as verbose'
      if (isVerbose(SHORT)) return 'a 5-word label was treated as verbose'
      return null
    },
  },
  {
    name: 'markdown from section extraction never reaches a sentence',
    run: () => {
      if (headline('**Narrative Notes**') !== 'Narrative Notes') return `got “${headline('**Narrative Notes**')}”`
      if (tidyLabel('**Scope**') !== 'scope') return `got “${tidyLabel('**Scope**')}”`
      return null
    },
  },
  {
    name: 'comparison glyphs become words a person would say',
    run: () => {
      const groups = stripSharedPrefix(['Duration < 6 weeks', 'Duration 6 weeks – 6 months', 'Duration > 6 months'])
      if (groups[0] !== '< 6 weeks') return `shared word survived: ${JSON.stringify(groups)}`
      const spoken = groups.map(tidyLabel)
      const expected = ['under 6 weeks', '6 weeks to 6 months', 'over 6 months']
      if (JSON.stringify(spoken) !== JSON.stringify(expected)) return `got ${JSON.stringify(spoken)}`
      return null
    },
  },
  {
    name: 'a shared prefix is only dropped when every label has one to spare',
    run: () => {
      const same = stripSharedPrefix(['Duration', 'Duration 6 weeks'])
      if (same[0] !== 'Duration') return `stripped a label down to nothing: ${JSON.stringify(same)}`
      const unrelated = stripSharedPrefix(['Red flags present', 'No red flags'])
      if (unrelated[0] !== 'Red flags present') return `stripped an unshared word: ${JSON.stringify(unrelated)}`
      return null
    },
  },
  {
    name: 'stored keys are said the way a surgeon says them',
    run: () => {
      const cases: Array<[string, string]> = [
        ['duration_of_symptoms_weeks', 'duration of symptoms'],
        ['radiographic_findings', 'radiographic findings'],
        ['failed_conservative_treatment', 'failed conservative treatment'],
      ]
      for (const [key, want] of cases) {
        if (humanizeKey(key) !== want) return `${key} → “${humanizeKey(key)}”, wanted “${want}”`
      }
      if (subjectOf('red_flags_present') !== 'red flags') return `red_flags_present → “${subjectOf('red_flags_present')}”`
      if (subjectOf('mechanical_symptoms_present') !== 'mechanical symptoms') return 'mechanical symptoms lost its noun'
      return null
    },
  },
  {
    name: 'doc-id prefixes never leak into a sentence',
    run: () => {
      const prefixed = 'doc_365e38_s2_duration_of_symptoms_weeks'
      const said = humanizeKey(prefixed)
      return /doc[_ ]|365e38|s2/.test(said) ? `got “${said}”` : null
    },
  },
  {
    name: 'units are inferred from the key, not guessed',
    run: () => {
      if (unitOf('duration_of_symptoms_weeks') !== 'weeks') return `got “${unitOf('duration_of_symptoms_weeks')}”`
      if (unitOf('patient_age') !== 'years') return `got “${unitOf('patient_age')}”`
      if (unitOf('radiographic_findings') !== '') return `invented a unit: “${unitOf('radiographic_findings')}”`
      return null
    },
  },
  {
    name: 'numbers read the way they are written, not the way they are stored',
    run: () => {
      if (formatNumber(6) !== '6') return `got “${formatNumber(6)}”`
      if (formatNumber(6.0) !== '6') return `got “${formatNumber(6.0)}”`
      if (formatNumber(4.5) !== '4.5') return `got “${formatNumber(4.5)}”`
      return null
    },
  },
  {
    name: 'lists and counts read as speech',
    run: () => {
      if (joinPhrases(['a', 'b']) !== 'a and b') return `got “${joinPhrases(['a', 'b'])}”`
      if (joinPhrases(['a', 'b', 'c']) !== 'a, b and c') return `got “${joinPhrases(['a', 'b', 'c'])}”`
      if (countWord(3) !== 'three') return `got “${countWord(3)}”`
      if (countWord(24) !== '24') return `got “${countWord(24)}”`
      if (plural(1, 'question') !== '1 question') return `got “${plural(1, 'question')}”`
      if (plural(3, 'question') !== '3 questions') return `got “${plural(3, 'question')}”`
      return null
    },
  },
  {
    name: 'the vocabulary guard catches our words and spares a surgeon’s',
    run: () => {
      if (findForbidden('5 of 5 conditions need your number') !== 'conditions') return 'missed “conditions”'
      if (findForbidden('Split into bands') !== 'bands') return 'missed “bands”'
      if (findForbidden('Sign off & publish') !== 'publish') return 'missed “publish”'
      const good = "How long should someone have symptoms before you'll see them?"
      if (findForbidden(good)) return `flagged a good sentence: ${findForbidden(good)}`
      const alsoGood = 'Patients under your cutoff go to conservative management instead of a surgical visit.'
      if (findForbidden(alsoGood)) return `flagged a good sentence: ${findForbidden(alsoGood)}`
      return null
    },
  },
  {
    name: 'the sweep walks nested screen text and ignores internal ids',
    run: () => {
      const offences = sweepForbidden({
        id: 'cutoffs:duration:abc',
        question: 'How long should someone have symptoms?',
        rows: [{ label: 'fine' }, { label: 'the threshold applies' }],
      })
      if (offences.length !== 1) return `expected 1 offence, got ${offences.length}: ${offences.join(' | ')}`
      if (!offences[0].includes('rows[1].label')) return `wrong path: ${offences[0]}`
      return null
    },
  },
]

let failures = 0
for (const c of checks) {
  let msg: string | null
  try {
    msg = c.run()
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err)
  }
  if (msg) {
    failures += 1
    console.error(`✗ ${c.name}: ${msg}`)
  } else {
    console.log(`✓ ${c.name}`)
  }
}

if (failures > 0) {
  if (typeof process !== 'undefined') process.exitCode = 1
  throw new Error(`${failures} rendering-bridge test(s) failed`)
}
console.log(`reconcile/plainLabel.test.ts — all ${checks.length} passed`)
