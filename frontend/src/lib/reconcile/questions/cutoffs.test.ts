import { TreeSchema, type TreeInput } from '../../../types/tree'
import { detectThresholdCandidates } from '../../deltas/detectAmbiguous'
import type { FlowInput } from '../types'
import {
  boundsFromCuts,
  cutoffDrafts,
  cutsPhrase,
  deriveCutoffQuestions,
  groupPreview,
  rangeWords,
  tilingCuts,
  trailingQuantity,
  type CutoffQuestion,
} from './cutoffs'

/**
 * Blume — "Your cutoffs" question derivation.
 *
 * The invariants this section rests on:
 *   1. Three sibling ranges that tile one axis are ONE question with two cut
 *      points. Asking three times is three chances to answer inconsistently.
 *   2. Question ids survive a guideline re-upload (fresh doc-id prefixes) and
 *      stay distinct when the SAME key appears in two document sections —
 *      which `radiographic_findings` does in the real data.
 *   3. The synthetic section router is never a clinical question.
 *   4. A vague word the guideline never quantified NEVER gets a number field.
 *      There is nothing to type; the old screen offered a box anyway.
 *   5. Nothing a surgeon reads contains software vocabulary.
 *
 * Same self-asserting style as deltas/deltas.test.ts: no framework.
 */

declare const process: { exitCode?: number } | undefined

/* -------------------------------------------------------------------------- */
/* Fixture — the real knee-AUC shapes, under a swappable doc namespace         */
/* -------------------------------------------------------------------------- */

const SEVERE_BASIS =
  'Referral is appropriate where radiographic severity, symptom chronicity and failed conservative management coincide.'

const emptyWorkup = { always: [], conditional: [], doNotOrderUnless: [] }

/** The same guideline, regenerated: every node id and the synthetic section
 *  key carry a fresh `doc_<hex>_` prefix; nothing clinical moves. */
function makeTree(docId: string): TreeInput {
  const p = (s: string) => `doc_${docId}_${s}`
  return {
    treeId: `tree_${docId}`,
    rootNodeId: p('cpg_root'),
    nodes: [
      {
        id: p('cpg_root'),
        type: 'variable',
        variableKey: p('cpg_section'),
        prompt: 'Which section of the sample_cpg_1_knee_auc_table applies?',
        dataSource: 'patient',
        branches: [
          { label: '**Scope**', condition: { op: 'equals', value: '**scope**' }, nextNodeId: p('s1_patient_age_check') },
          {
            label: '**Indication Variables**',
            condition: { op: 'equals', value: '**indication_variables**' },
            nextNodeId: p('s2_duration_of_symptoms'),
          },
          {
            label: '**Narrative Notes**',
            condition: { op: 'equals', value: '**narrative_notes**' },
            nextNodeId: p('s4_radiographic_findings'),
          },
        ],
      },

      // Scope section: one accepted range, with an out-of-range sibling that
      // escalates. `out_of_range` is not a vague word — only the range is a
      // question.
      {
        id: p('s1_patient_age_check'),
        type: 'variable',
        variableKey: 'patient_age',
        prompt: 'How old are you?',
        dataSource: 'patient',
        branches: [
          { label: 'Age 18–75', condition: { op: 'range', min: 18, max: 75 }, nextNodeId: p('s1_knee_pain_etiology') },
          { label: 'Age < 18 or > 75', condition: { op: 'equals', value: 'out_of_range' }, nextNodeId: p('s1_escalate') },
        ],
      },
      {
        id: p('s1_knee_pain_etiology'),
        type: 'variable',
        variableKey: 'knee_pain_etiology',
        prompt: 'Was your knee pain caused by an injury?',
        dataSource: 'patient',
        branches: [
          {
            label: 'Non-traumatic knee pain',
            condition: { op: 'equals', value: 'non_traumatic' },
            nextNodeId: p('s1_conservative'),
          },
          { label: 'Traumatic knee pain', condition: { op: 'equals', value: 'traumatic' }, nextNodeId: p('s1_escalate') },
        ],
      },
      { id: p('s1_escalate'), type: 'escalation', reason: 'Outside the guideline population.' },
      {
        id: p('s1_conservative'),
        type: 'specialist',
        specialistName: 'Continue or initiate conservative management (NSAIDs + physical therapy)',
        specialty: 'Orthopaedics',
        urgency: 'routine',
        reasoningTemplate: '',
        workup: emptyWorkup,
      },

      // Indication section: three sibling ranges tiling one axis, all carrying
      // on to the same next question.
      {
        id: p('s2_duration_of_symptoms'),
        type: 'variable',
        variableKey: 'duration_of_symptoms_weeks',
        prompt: 'How long have you been experiencing your symptoms?',
        dataSource: 'patient',
        branches: [
          { label: 'Duration < 6 weeks', condition: { op: 'range', max: 6 }, nextNodeId: p('s2_radiographic_findings') },
          {
            label: 'Duration 6 weeks – 6 months',
            condition: { op: 'range', min: 6, max: 26 },
            nextNodeId: p('s2_radiographic_findings'),
          },
          { label: 'Duration > 6 months', condition: { op: 'range', min: 26 }, nextNodeId: p('s2_radiographic_findings') },
        ],
      },
      // First vague value: 'normal'. Every answer carries on to the same place.
      {
        id: p('s2_radiographic_findings'),
        type: 'variable',
        variableKey: 'radiographic_findings',
        prompt: 'What did your imaging (X-ray or scan) show, if it was done?',
        dataSource: 'record',
        branches: [
          {
            label: 'No imaging obtained',
            condition: { op: 'equals', value: 'none_obtained' },
            nextNodeId: p('s2_mechanical'),
          },
          { label: 'Imaging normal', condition: { op: 'equals', value: 'normal' }, nextNodeId: p('s2_mechanical') },
          {
            label: 'Kellgren-Lawrence grade 3-4',
            condition: { op: 'equals', value: 'kl_grade_3_4' },
            nextNodeId: p('s2_mechanical'),
          },
        ],
      },
      {
        id: p('s2_mechanical'),
        type: 'variable',
        variableKey: 'mechanical_symptoms_present',
        prompt: 'Does your knee lock, catch, or give way?',
        dataSource: 'patient',
        branches: [
          { label: 'Mechanical symptoms present', condition: { op: 'equals', value: 'true' }, nextNodeId: p('s1_conservative') },
          { label: 'No mechanical symptoms', condition: { op: 'equals', value: 'false' }, nextNodeId: p('s1_conservative') },
        ],
      },

      // Narrative section: the SAME key again, a different vague value, and
      // two answers that really do go to different places.
      {
        id: p('s4_radiographic_findings'),
        type: 'variable',
        variableKey: 'radiographic_findings',
        prompt: 'What do imaging findings show?',
        dataSource: 'record',
        branches: [
          {
            label: 'Significant radiographic severity present',
            condition: { op: 'equals', value: 'severe' },
            nextNodeId: p('s4_referral'),
          },
          {
            label: 'Minimal or no significant radiographic change',
            condition: { op: 'equals', value: 'not_significant' },
            nextNodeId: p('s4_failed_conservative'),
          },
        ],
      },
      {
        id: p('s4_failed_conservative'),
        type: 'variable',
        variableKey: 'failed_conservative_treatment',
        prompt: 'Has conservative treatment been tried and failed?',
        dataSource: 'referral',
        branches: [
          { label: 'Documented failure', condition: { op: 'equals', value: 'true' }, nextNodeId: p('s4_referral') },
          { label: 'Not yet failed', condition: { op: 'equals', value: 'false' }, nextNodeId: p('s1_conservative') },
        ],
      },
      {
        id: p('s4_referral'),
        type: 'specialist',
        specialistName: 'Referral via standard pathway — appropriateness supported by symptom chronicity',
        specialty: 'Orthopaedics',
        urgency: 'routine',
        reasoningTemplate: '',
        workup: emptyWorkup,
        clinicalBasis: SEVERE_BASIS,
      },
    ],
  }
}

function derive(docId: string): CutoffQuestion[] {
  const tree = TreeSchema.parse(makeTree(docId))
  const input: FlowInput = { tree, roster: [], subspecialty: null, cases: [] }
  return deriveCutoffQuestions(input)
}

const questions = derive('365e38')
const byShape = (shape: CutoffQuestion['shape']) => questions.filter((q) => q.shape === shape)
const duration = byShape('boundaries')[0]
const age = byShape('span')[0]
const wordings = byShape('wording')

/* -------------------------------------------------------------------------- */
/* Forbidden vocabulary                                                       */
/* -------------------------------------------------------------------------- */

const FORBIDDEN =
  /\b(nodes?|endpoints?|trees?|deltas?|reconcile|gap sweep|thresholds?|variables?|conditions?|mappings?|bands?|publish|scopes?|branch(es)?|anchors?)\b/i

/** Every string this section can put in front of a surgeon, including the
 *  sentences the screen composes from these fields. */
function userFacingStrings(q: CutoffQuestion): string[] {
  const out = [q.question, q.guidelineLine, q.stakesLine, q.keepLabel, q.keepSummary, q.footer, q.subject, q.unit]
  out.push(...q.cutLabels, ...q.groupLabels)
  if (q.phrase) {
    out.push(`Is "${q.phrase}" the right way to split these patients?`)
    out.push(`Flagged "${q.phrase}" — it doesn't fit how this clinic splits these patients.`)
    out.push('What would you split them on instead?')
    out.push(
      "Nothing changes right now. This needs a conversation rather than a setting, so we'll list it at the end and keep the guideline's answer in the meantime.",
    )
  }
  if (q.shape === 'boundaries') {
    const moved = q.cutPoints.map((c, i) => (i === 0 ? c + 2 : c))
    out.push(`Split at ${cutsPhrase(q.cutPoints, q.unit)}`)
    out.push(`That gives you: ${groupPreview(moved, q.unit)}`)
    out.push(`Your clinic splits at ${cutsPhrase(moved, q.unit)} instead of ${cutsPhrase(q.cutPoints, q.unit)}. Why?`)
    out.push(`Patients are now split at ${cutsPhrase(moved, q.unit)} instead of ${cutsPhrase(q.cutPoints, q.unit)}.`)
    out.push('Use my numbers', 'Save my numbers', "Change a number to save, or keep the guideline's.")
  }
  if (q.shape === 'span') {
    const moved = { ...q.span, min: (q.span.min ?? 0) + 3 }
    out.push(`Your clinic sees ${rangeWords(moved, q.unit)} instead of ${rangeWords(q.span, q.unit)}. Why?`)
    out.push(`You now see ${rangeWords(moved, q.unit)} instead of ${rangeWords(q.span, q.unit)}.`)
    out.push('Use mine', 'Save mine', 'leave one blank for no limit', 'From', 'to')
  }
  out.push('One line — it goes in your sign-off record')
  return out.filter(Boolean)
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

const checks: Array<{ name: string; run: () => string | null }> = [
  {
    name: 'three sibling ranges become ONE question with two cut points',
    run: () => {
      const boundaries = byShape('boundaries')
      if (boundaries.length !== 1) return `expected 1 boundaries question, got ${boundaries.length}`
      const candidateCount = detectThresholdCandidates(TreeSchema.parse(makeTree('365e38'))).filter(
        (c) => c.variableKey === 'duration_of_symptoms_weeks',
      ).length
      if (candidateCount !== 3) return `fixture should yield 3 per-edge candidates, got ${candidateCount}`
      if (duration.cutPoints.length !== 2) return `expected 2 cut points, got ${JSON.stringify(duration.cutPoints)}`
      if (duration.targets.length !== duration.cutPoints.length + 1)
        return 'group count must be cut points + 1'
      if (JSON.stringify(duration.cutPoints) !== '[6,26]') return `cut points: ${JSON.stringify(duration.cutPoints)}`
      return null
    },
  },
  {
    name: "cut points are named in the guideline's own words (26 weeks reads '6 months')",
    run: () => {
      if (JSON.stringify(duration.cutLabels) !== JSON.stringify(['6 weeks', '6 months']))
        return `cutLabels: ${JSON.stringify(duration.cutLabels)}`
      if (duration.keepLabel !== '✓ 6 weeks and 6 months are right') return `keepLabel: ${duration.keepLabel}`
      if (trailingQuantity('6 weeks to 6 months') !== '6 months') return 'trailingQuantity took the wrong end'
      return null
    },
  },
  {
    name: 'the boundaries screen reads as approved',
    run: () => {
      if (duration.question !== "How long should someone have symptoms before you'll see them?")
        return `question: ${duration.question}`
      if (
        duration.guidelineLine !==
        'The guideline sorts patients into three groups: under 6 weeks, 6 weeks to 6 months and over 6 months.'
      )
        return `guidelineLine: ${duration.guidelineLine}`
      if (
        duration.stakesLine !==
        "Right now all three groups carry on to the same next question, so these numbers don't change where anyone goes yet."
      )
        return `stakesLine: ${duration.stakesLine}`
      if (duration.footer !== 'Not sure? Keep the guideline number — you can change it any time.')
        return `footer: ${duration.footer}`
      if (duration.keepSummary !== "Kept the guideline's cutoffs for duration of symptoms.")
        return `keepSummary: ${duration.keepSummary}`
      if (groupPreview([6, 26], 'weeks') !== 'under 6 · 6 to 26 · over 26 weeks')
        return `preview: ${groupPreview([6, 26], 'weeks')}`
      return null
    },
  },
  {
    name: 'the span screen reads as approved and derives where the rest go',
    run: () => {
      if (!age) return 'no span question derived for patient_age'
      if (age.question !== 'Which ages do you see?') return `question: ${age.question}`
      if (age.guidelineLine !== 'The guideline uses 18 to 75 years.') return `guidelineLine: ${age.guidelineLine}`
      if (age.stakesLine !== 'Patients outside it go to a person to review.') return `stakesLine: ${age.stakesLine}`
      if (age.keepLabel !== '✓ 18 to 75 years is right') return `keepLabel: ${age.keepLabel}`
      if (age.unit !== 'years') return `unit: ${age.unit}`
      return null
    },
  },
  {
    name: 'a vague value never produces a numeric control',
    run: () => {
      if (wordings.length !== 2) return `expected 2 wording questions, got ${wordings.length}`
      for (const q of wordings) {
        if (q.cutPoints.length || q.cutLabels.length || q.groupLabels.length) return `${q.id} offers cut points`
        if (q.span.min !== undefined || q.span.max !== undefined) return `${q.id} offers a range`
        if (q.footer !== 'Nothing to type on this one — the guideline never gave a number here.')
          return `${q.id} footer: ${q.footer}`
        if (q.keepLabel !== "✓ Yes, that's right") return `${q.id} keepLabel: ${q.keepLabel}`
        if (/\d/.test(q.question)) return `${q.id} asks for a number: ${q.question}`
        if (cutoffDrafts(q, [{}]).length !== 0) return `${q.id} wrote something with nothing to write`
      }
      const normal = wordings.find((q) => q.phrase === 'imaging normal')
      if (!normal) return `phrases: ${wordings.map((q) => q.phrase).join(' | ')}`
      if (normal.question !== 'Is "imaging normal" the right way to split these patients?')
        return `question: ${normal.question}`
      if (
        normal.guidelineLine !==
        "The guideline separates patients by radiographic findings. There's no number to set here — it's a judgement you or your radiologist would make."
      )
        return `guidelineLine: ${normal.guidelineLine}`
      if (
        normal.stakesLine !==
        "Right now everyone carries on to the same next question either way, so this wording doesn't change where anyone goes yet."
      )
        return `stakesLine: ${normal.stakesLine}`
      if (normal.keepSummary !== 'Confirmed "imaging normal" is the right way to split these patients.')
        return `keepSummary: ${normal.keepSummary}`
      return null
    },
  },
  {
    name: 'two-sided stakes keep "everyone else" singular',
    run: () => {
      const severe = wordings.find((q) => q.phrase === 'significant radiographic severity present')
      if (!severe) return `phrases: ${wordings.map((q) => q.phrase).join(' | ')}`
      if (
        severe.stakesLine !==
        'Patients it matches go to referral via standard pathway; everyone else goes to the next question.'
      )
        return `stakesLine: ${severe.stakesLine}`
      if (severe.targets[0].cpgBasis !== SEVERE_BASIS) return 'clinical basis not carried onto the target'
      if (severe.targets[0].answerTypeChange !== 'string_to_number')
        return `answerTypeChange: ${severe.targets[0].answerTypeChange}`
      return null
    },
  },
  {
    name: 'ids are unique and survive a guideline re-upload',
    run: () => {
      const ids = questions.map((q) => q.id)
      if (new Set(ids).size !== ids.length) return `duplicate ids: ${ids.join(' | ')}`
      const again = derive('ff0011').map((q) => q.id)
      if (JSON.stringify(ids) !== JSON.stringify(again)) return `ids moved: ${ids.join(' | ')} vs ${again.join(' | ')}`
      const sameKey = questions.filter((q) => q.subject === 'radiographic findings')
      if (sameKey.length !== 2) return 'fixture should carry the same key in two sections'
      if (sameKey[0].id === sameKey[1].id) return 'the same key in two sections collided'
      return null
    },
  },
  {
    name: 'the synthetic section router is never asked about',
    run: () => {
      for (const q of questions) {
        if (q.id.includes('cpg_section') || q.id.includes('cpg_root')) return `router surfaced: ${q.id}`
        if (/section/i.test(q.question) || /section/i.test(q.guidelineLine)) return `router surfaced: ${q.question}`
        if (q.subject.includes('cpg')) return `router surfaced: ${q.subject}`
      }
      if (questions.length !== 4) return `expected 4 questions, got ${questions.length}`
      return null
    },
  },
  {
    name: 'moving one cut point writes exactly the two groups that moved',
    run: () => {
      const drafts = cutoffDrafts(duration, boundsFromCuts([8, 26]))
      if (drafts.length !== 2) return `expected 2, got ${drafts.length}`
      const payloads = drafts.map((d) => d.payload)
      for (const p of payloads) {
        if (p.op !== 'set_threshold') return `wrong op: ${p.op}`
        if (p.mode !== 'replace') return `wrong mode: ${p.mode}`
        if (p.answerTypeChange !== 'none') return `answerTypeChange: ${p.answerTypeChange}`
      }
      const first = payloads[0]
      const second = payloads[1]
      if (first.op !== 'set_threshold' || second.op !== 'set_threshold') return 'not set_threshold'
      if (JSON.stringify(first.replacement) !== '{"op":"range","max":8}')
        return `group 1: ${JSON.stringify(first.replacement)}`
      if (JSON.stringify(second.replacement) !== '{"op":"range","min":8,"max":26}')
        return `group 2: ${JSON.stringify(second.replacement)}`
      const candidates = detectThresholdCandidates(TreeSchema.parse(makeTree('365e38'))).filter(
        (c) => c.variableKey === 'duration_of_symptoms_weeks',
      )
      if (JSON.stringify(first.branch) !== JSON.stringify(candidates[0].anchor)) return 'anchor was not used unchanged'
      if (drafts.some((d) => d.provenance?.deviatesFromCpg !== true)) return 'deviation is derived, not optional'
      if (cutoffDrafts(duration, boundsFromCuts([6, 26])).length !== 0) return 'unchanged numbers wrote something'
      return null
    },
  },
  {
    name: 'a span edit writes exactly one replacement',
    run: () => {
      const drafts = cutoffDrafts(age, [{ min: 21, max: 75 }])
      if (drafts.length !== 1) return `expected 1, got ${drafts.length}`
      const p = drafts[0].payload
      if (p.op !== 'set_threshold') return `wrong op: ${p.op}`
      if (JSON.stringify(p.replacement) !== '{"op":"range","min":21,"max":75}')
        return `replacement: ${JSON.stringify(p.replacement)}`
      if (cutoffDrafts(age, [{ min: 18, max: 75 }]).length !== 0) return 'unchanged numbers wrote something'
      return null
    },
  },
  {
    name: 'only ranges that tile one axis end to end become one question',
    run: () => {
      const tree = TreeSchema.parse(makeTree('365e38'))
      const node = tree.nodes.find((n) => n.id === 'doc_365e38_s2_duration_of_symptoms')
      if (!node || node.type !== 'variable') return 'fixture missing'
      if (JSON.stringify(tilingCuts(node)) !== '[6,26]') return `tilingCuts: ${JSON.stringify(tilingCuts(node))}`
      const gapped = {
        ...node,
        branches: [
          { ...node.branches[0], condition: { op: 'range' as const, max: 6 } },
          { ...node.branches[1], condition: { op: 'range' as const, min: 8, max: 26 } },
          { ...node.branches[2], condition: { op: 'range' as const, min: 26 } },
        ],
      }
      if (tilingCuts(gapped) !== null) return 'a gap between groups is not one decision'
      const ageNode = tree.nodes.find((n) => n.id === 'doc_365e38_s1_patient_age_check')
      if (!ageNode || ageNode.type !== 'variable') return 'fixture missing'
      if (tilingCuts(ageNode) !== null) return 'a range beside a word is not one decision'
      return null
    },
  },
  {
    name: 'nothing a surgeon reads contains software vocabulary',
    run: () => {
      for (const q of questions) {
        for (const s of userFacingStrings(q)) {
          const hit = FORBIDDEN.exec(s)
          if (hit) return `"${hit[0]}" in: ${s}`
        }
      }
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
  throw new Error(`${failures} cutoffs question test(s) failed`)
}
console.log(`reconcile/questions/cutoffs.test.ts — all ${checks.length} passed`)
