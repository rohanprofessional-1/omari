import type { Branch, Node as TreeNode, RangeCondition, VariableNode } from '../../../types/tree'
import type { DeltaDraft } from '../../deltas/api'
import { detectThresholdCandidates, type ThresholdCandidate } from '../../deltas/detectAmbiguous'
import { fnv1a, normalizeKey } from '../../deltas/resolve'
import type { BranchAnchor } from '../../deltas/schema'
import {
  countWord,
  formatNumber,
  headline,
  joinPhrases,
  stripSharedPrefix,
  subjectOf,
  tidyLabel,
  unitOf,
} from '../plainLabel'
import type { Deriver, StepQuestion } from '../types'

/**
 * Blume — "Your cutoffs": the numbers a clinic draws its lines at.
 *
 * The detector underneath returns one candidate PER EDGE, because that is
 * what a compiler needs. A surgeon does not think in edges. Three sibling
 * ranges that tile one axis — under 6 weeks / 6 weeks to 6 months / over 6
 * months — are ONE decision with two cut points, and asking about them three
 * times is three chances to answer inconsistently. So this module regroups
 * the candidates into the three shapes a person actually recognises:
 *
 *   boundaries — one decision cut at several points ("split at 6 and 26")
 *   span       — a single accepted range ("we see 18 to 75")
 *   wording    — the guideline never gave a number, so there is NOTHING to
 *                type; the only honest question is whether the wording is
 *                the right way to sort these patients at all.
 *
 * Every question carries the guideline's own answer, so every screen is
 * completable in one click and that click is always the safe one.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

export type CutoffShape = 'boundaries' | 'span' | 'wording'

/** Bounds in the stored unit. Both open = "anything". */
export interface Bounds {
  min?: number
  max?: number
}

/** One edit target: everything a delta needs, resolved at derivation time. */
export interface CutoffTarget {
  /** The detector's anchor, used unchanged. */
  anchor: BranchAnchor
  /** The guideline's current bounds for this group. */
  bounds: Bounds
  /** The verbatim guideline text behind this group's destination, if any. */
  cpgBasis?: string
  answerTypeChange: 'none' | 'string_to_number'
}

export interface CutoffQuestion extends StepQuestion {
  kind: 'cutoffs'
  shape: CutoffShape
  /** "duration of symptoms", "patient age" — for sentences, never a key. */
  subject: string
  /** "weeks", "years", or '' when the guideline's number is unitless. */
  unit: string
  /** The one-click safe answer, e.g. "✓ 6 weeks and 6 months are right". */
  keepLabel: string
  /** What the closing screen says when they keep the guideline. */
  keepSummary: string
  /** The reassurance under the controls. Never blank. */
  footer: string
  /** boundaries: the cut points, in the STORED unit. */
  cutPoints: number[]
  /** boundaries: each cut point in the guideline's OWN words ("6 months"). */
  cutLabels: string[]
  /** boundaries: the groups as a person reads them ("under 6 weeks"). */
  groupLabels: string[]
  /** span: the accepted range. */
  span: Bounds
  /** wording: the guideline's phrase, tidied ("imaging normal"). */
  phrase: string
  /** One per group, in order. boundaries: n groups; span/wording: exactly 1. */
  targets: CutoffTarget[]
}

/* -------------------------------------------------------------------------- */
/* Phrasing helpers (shared with the screen, so both say the same thing)      */
/* -------------------------------------------------------------------------- */

function withUnit(text: string, unit: string): string {
  return unit ? `${text} ${unit}` : text
}

/** "6 and 26 weeks" — the cut points as a person would say them. */
export function cutsPhrase(cutPoints: number[], unit: string): string {
  return withUnit(joinPhrases(cutPoints.map(formatNumber)), unit)
}

/** "under 6 · 6 to 26 · over 26 weeks" — the groups a set of cuts produces. */
export function groupPreview(cutPoints: number[], unit: string): string {
  if (cutPoints.length === 0) return withUnit('everyone', unit)
  const parts = cutPoints.map((cut, i) =>
    i === 0 ? `under ${formatNumber(cut)}` : `${formatNumber(cutPoints[i - 1])} to ${formatNumber(cut)}`,
  )
  parts.push(`over ${formatNumber(cutPoints[cutPoints.length - 1])}`)
  return withUnit(parts.join(' · '), unit)
}

/** "18 to 75 years", "18 years and over", "up to 75 years". */
export function rangeWords(bounds: Bounds, unit: string): string {
  const { min, max } = bounds
  if (min !== undefined && max !== undefined) return withUnit(`${formatNumber(min)} to ${formatNumber(max)}`, unit)
  if (min !== undefined) return `${withUnit(formatNumber(min), unit)} and over`
  if (max !== undefined) return `up to ${withUnit(formatNumber(max), unit)}`
  return 'no limit either way'
}

/** The bounds a set of cut points gives each group, in order. */
export function boundsFromCuts(cutPoints: number[]): Bounds[] {
  const out: Bounds[] = []
  for (let i = 0; i <= cutPoints.length; i++) {
    out.push({
      ...(i === 0 ? {} : { min: cutPoints[i - 1] }),
      ...(i === cutPoints.length ? {} : { max: cutPoints[i] }),
    })
  }
  return out
}

function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.min === b.min && a.max === b.max
}

/* -------------------------------------------------------------------------- */
/* Deltas                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One `set_threshold` per group whose bounds ACTUALLY moved. Moving a single
 * cut point on a three-group decision changes two groups, so it writes two —
 * never three, and never one.
 *
 * Deviation is derived, not asked: their number differs from the guideline's,
 * so it deviates. The old screen had a checkbox for this; a checkbox that can
 * only ever be ticked is a question with one answer.
 */
export function cutoffDrafts(question: CutoffQuestion, next: Bounds[]): DeltaDraft[] {
  const drafts: DeltaDraft[] = []
  question.targets.forEach((target, i) => {
    const bounds = next[i]
    if (!bounds || sameBounds(bounds, target.bounds)) return
    drafts.push({
      payload: {
        op: 'set_threshold',
        branch: target.anchor,
        mode: 'replace',
        replacement: {
          op: 'range',
          ...(bounds.min !== undefined ? { min: bounds.min } : {}),
          ...(bounds.max !== undefined ? { max: bounds.max } : {}),
        },
        answerTypeChange: target.answerTypeChange,
      },
      provenance: {
        deviatesFromCpg: true,
        ...(target.cpgBasis ? { cpgBasis: target.cpgBasis } : {}),
      },
    })
  })
  return drafts
}

/* -------------------------------------------------------------------------- */
/* Reading the guideline                                                      */
/* -------------------------------------------------------------------------- */

const TIME_UNITS = /(\d+(?:\.\d+)?)\s*(weeks?|months?|days?|years?|hours?)\s*$/i
const TRAILING_QUANTITY = /(\d+(?:\.\d+)?)(\s+[a-z][a-z/%]*)?\s*$/i

/**
 * The quantity a group's own label ENDS on. The three duration groups store
 * 6 / 26 weeks but the guideline calls the second cut "6 months", and the
 * button has to say what the guideline says or the surgeon is confirming a
 * number they never wrote.
 */
export function trailingQuantity(label: string): string {
  const timed = TIME_UNITS.exec(label)
  if (timed) return `${timed[1]} ${timed[2].toLowerCase()}`
  const any = TRAILING_QUANTITY.exec(label)
  if (any) return `${any[1]}${any[2] ? any[2].replace(/\s+/, ' ') : ''}`.trim()
  return ''
}

/** Lowercase a headline's opening capital when it isn't a proper name. */
function inSentence(text: string): string {
  const rest = text.split(/\s+/).slice(1)
  const looksNamed = rest.some((w) => /^[A-Z]/.test(w))
  if (looksNamed || !/^[A-Z][a-z]/.test(text)) return text
  return text.charAt(0).toLowerCase() + text.slice(1)
}

const PLACEHOLDER_TERMINAL = /^\[assign specialist\s*[—–-]\s*(.+?)\]$/i

/** Where a group of patients ends up, said in one short phrase. */
function destination(node: TreeNode | undefined): { text: string; asks: boolean } {
  if (!node) return { text: 'a person to review', asks: false }
  if (node.type === 'escalation') return { text: 'a person to review', asks: false }
  if (node.type === 'variable') return { text: 'the next question', asks: true }
  const named = PLACEHOLDER_TERMINAL.exec(node.specialistName)
  const short = headline(named ? named[1] : node.specialistName)
  return { text: short ? inSentence(short) : 'a person to review', asks: false }
}

/**
 * The cut points of a decision whose ranges tile ONE axis end to end: the
 * first group is open below, the last is open above, and every group's top
 * is the next group's bottom. Anything else is not one decision.
 */
export function tilingCuts(node: VariableNode): number[] | null {
  const n = node.branches.length
  if (n < 2) return null
  const ranges: RangeCondition[] = []
  for (const branch of node.branches) {
    if (branch.condition.op !== 'range') return null
    ranges.push(branch.condition)
  }
  if (ranges[0].min !== undefined) return null
  if (ranges[n - 1].max !== undefined) return null
  const cuts: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const top = ranges[i].max
    const bottom = ranges[i + 1].min
    if (top === undefined || bottom === undefined || top !== bottom) return null
    cuts.push(top)
  }
  return cuts.length === n - 1 ? cuts : null
}

/* -------------------------------------------------------------------------- */
/* Stable ids                                                                 */
/* -------------------------------------------------------------------------- */

const SEP = '␟'

/**
 * Stable across a guideline re-upload (node ids are regenerated every time)
 * and distinct when the SAME key appears in two sections of one document —
 * which `radiographic_findings` does in the real data.
 */
function questionId(node: VariableNode, focus: string[]): string {
  const shape = node.branches.map((b) => b.label).join(SEP)
  return `cutoffs:${normalizeKey(node.variableKey)}:${fnv1a(`${shape}»${focus.join(SEP)}`)}`
}

/* -------------------------------------------------------------------------- */
/* Question builders                                                          */
/* -------------------------------------------------------------------------- */

function targetFor(candidate: ThresholdCandidate, branch: Branch): CutoffTarget {
  const bounds: Bounds =
    branch.condition.op === 'range'
      ? {
          ...(branch.condition.min !== undefined ? { min: branch.condition.min } : {}),
          ...(branch.condition.max !== undefined ? { max: branch.condition.max } : {}),
        }
      : {}
  return {
    anchor: candidate.anchor,
    bounds,
    ...(candidate.clinicalBasis ? { cpgBasis: candidate.clinicalBasis } : {}),
    answerTypeChange: candidate.kind === 'ambiguous_equals' ? 'string_to_number' : 'none',
  }
}

const FOOTER_NUMERIC = 'Not sure? Keep the guideline number — you can change it any time.'
const FOOTER_WORDING = 'Nothing to type on this one — the guideline never gave a number here.'

const DURATION_KEY = /duration|symptom|time|wait/
const AGE_KEY = /(^|_)age($|_)/
const IMAGING_SUBJECT = /imaging|radiograph|x-?ray|scan|film/i

function boundariesQuestion(
  byId: Map<string, TreeNode>,
  node: VariableNode,
  cutPoints: number[],
  candidates: Map<number, ThresholdCandidate>,
): CutoffQuestion | null {
  const targets: CutoffTarget[] = []
  for (let i = 0; i < node.branches.length; i++) {
    const candidate = candidates.get(i)
    if (!candidate) return null
    targets.push(targetFor(candidate, node.branches[i]))
  }

  const key = normalizeKey(node.variableKey)
  const unit = unitOf(node.variableKey)
  const subject = subjectOf(node.variableKey)
  const groupLabels = stripSharedPrefix(node.branches.map((b) => b.label)).map(tidyLabel)
  const cutLabels = cutPoints.map((cut, i) => trailingQuantity(groupLabels[i] ?? '') || withUnit(formatNumber(cut), unit))

  const dests = new Set(node.branches.map((b) => b.nextNodeId))
  const shared = destination(byId.get(node.branches[0].nextNodeId))
  const stakesLine =
    dests.size > 1
      ? 'Each group is handled differently from here.'
      : shared.asks
        ? `Right now all ${countWord(groupLabels.length)} groups carry on to the same next question, so these numbers don't change where anyone goes yet.`
        : `Right now all ${countWord(groupLabels.length)} groups end up in the same place, so these numbers don't change where anyone goes yet.`

  return {
    id: questionId(node, groupLabels),
    kind: 'cutoffs',
    shape: 'boundaries',
    question:
      DURATION_KEY.test(key) && unit
        ? "How long should someone have symptoms before you'll see them?"
        : `Where do you draw the line on ${subject}?`,
    guidelineLine: `The guideline sorts patients into ${countWord(groupLabels.length)} groups: ${joinPhrases(groupLabels)}.`,
    stakesLine,
    subject,
    unit,
    keepLabel: `✓ ${joinPhrases(cutLabels)} ${cutLabels.length === 1 ? 'is' : 'are'} right`,
    keepSummary: `Kept the guideline's cutoffs for ${subject}.`,
    footer: FOOTER_NUMERIC,
    cutPoints,
    cutLabels,
    groupLabels,
    span: {},
    phrase: '',
    targets,
  }
}

function spanQuestion(
  byId: Map<string, TreeNode>,
  node: VariableNode,
  candidate: ThresholdCandidate,
): CutoffQuestion | null {
  const branch = node.branches[candidate.branchIndex]
  if (!branch || branch.condition.op !== 'range') return null

  const key = normalizeKey(node.variableKey)
  const unit = unitOf(node.variableKey)
  const subject = subjectOf(node.variableKey)
  const target = targetFor(candidate, branch)
  const words = rangeWords(target.bounds, unit)

  const others = node.branches.filter((_, i) => i !== candidate.branchIndex)
  const otherDests = new Set(others.map((b) => b.nextNodeId))
  let stakesLine: string
  if (others.length === 0) {
    stakesLine = "Nobody is turned away by this on its own — it's the only answer here."
  } else if (otherDests.size === 1 && otherDests.has(branch.nextNodeId)) {
    const same = destination(byId.get(branch.nextNodeId))
    stakesLine = same.asks
      ? "Right now everyone carries on to the same next question either way, so these numbers don't change where anyone goes yet."
      : "Right now everyone ends up in the same place either way, so these numbers don't change where anyone goes yet."
  } else if (otherDests.size === 1) {
    stakesLine = `Patients outside it go to ${destination(byId.get([...otherDests][0])).text}.`
  } else {
    stakesLine = 'Patients outside it are handled another way.'
  }

  return {
    id: questionId(node, [branch.label]),
    kind: 'cutoffs',
    shape: 'span',
    question: AGE_KEY.test(key) || unit === 'years' ? 'Which ages do you see?' : `What range of ${subject} do you see?`,
    guidelineLine: `The guideline uses ${words}.`,
    stakesLine,
    subject,
    unit,
    keepLabel: `✓ ${words} is right`,
    keepSummary: `Kept the guideline's cutoffs for ${subject}.`,
    footer: FOOTER_NUMERIC,
    cutPoints: [],
    cutLabels: [],
    groupLabels: [],
    span: target.bounds,
    phrase: '',
    targets: [target],
  }
}

function wordingQuestion(
  byId: Map<string, TreeNode>,
  node: VariableNode,
  candidate: ThresholdCandidate,
): CutoffQuestion | null {
  const branch = node.branches[candidate.branchIndex]
  if (!branch) return null

  const subject = subjectOf(node.variableKey)
  const phrase = tidyLabel(branch.label)
  const judgement = IMAGING_SUBJECT.test(subject)
    ? 'a judgement you or your radiologist would make'
    : "a judgement you'd make"

  const dests = new Set(node.branches.map((b) => b.nextNodeId))
  const mine = destination(byId.get(branch.nextNodeId))
  const otherDests = new Set(node.branches.filter((_, i) => i !== candidate.branchIndex).map((b) => b.nextNodeId))
  let stakesLine: string
  if (dests.size === 1) {
    stakesLine = mine.asks
      ? "Right now everyone carries on to the same next question either way, so this wording doesn't change where anyone goes yet."
      : "Right now everyone ends up in the same place either way, so this wording doesn't change where anyone goes yet."
  } else if (otherDests.size === 1) {
    stakesLine = `Patients it matches go to ${mine.text}; everyone else goes to ${destination(byId.get([...otherDests][0])).text}.`
  } else {
    stakesLine = `Patients it matches go to ${mine.text}; everyone else is sorted by their own answer.`
  }

  return {
    id: questionId(node, [branch.label]),
    kind: 'cutoffs',
    shape: 'wording',
    question: `Is "${phrase}" the right way to split these patients?`,
    guidelineLine: `The guideline separates patients by ${subject}. There's no number to set here — it's ${judgement}.`,
    stakesLine,
    subject,
    unit: unitOf(node.variableKey),
    keepLabel: "✓ Yes, that's right",
    keepSummary: `Confirmed "${phrase}" is the right way to split these patients.`,
    footer: FOOTER_WORDING,
    cutPoints: [],
    cutLabels: [],
    groupLabels: [],
    span: {},
    phrase,
    targets: [targetFor(candidate, branch)],
  }
}

/* -------------------------------------------------------------------------- */
/* The deriver                                                                */
/* -------------------------------------------------------------------------- */

export const deriveCutoffQuestions: Deriver<CutoffQuestion> = ({ tree }) => {
  const candidates = detectThresholdCandidates(tree)
  const byId = new Map<string, TreeNode>(tree.nodes.map((n) => [n.id, n]))

  // Candidates arrive one per edge. Group them by the decision they belong to
  // before asking anything, so one decision is never asked about twice.
  const perNode = new Map<string, Map<number, ThresholdCandidate>>()
  for (const candidate of candidates) {
    const existing = perNode.get(candidate.nodeId)
    if (existing) existing.set(candidate.branchIndex, candidate)
    else perNode.set(candidate.nodeId, new Map([[candidate.branchIndex, candidate]]))
  }

  const questions: CutoffQuestion[] = []
  const asked = new Set<string>()

  for (const candidate of candidates) {
    const node = byId.get(candidate.nodeId)
    if (!node || node.type !== 'variable') continue

    const cuts = tilingCuts(node)
    if (cuts && candidate.kind === 'range') {
      if (asked.has(node.id)) continue
      asked.add(node.id)
      const built = boundariesQuestion(byId, node, cuts, perNode.get(node.id) ?? new Map())
      if (built) questions.push(built)
      continue
    }

    const built =
      candidate.kind === 'range'
        ? spanQuestion(byId, node, candidate)
        : wordingQuestion(byId, node, candidate)
    if (built) questions.push(built)
  }

  return questions
}
