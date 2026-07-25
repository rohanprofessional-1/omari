import type { SpecialistNode, Tree, Urgency, VariableNode } from '../../../types/tree'
import { runCase } from '../../deltas/caseRunner'
import { anchorForBranch, anchorForNode } from '../../deltas/resolve'
import type { BranchAnchor, NodeAnchor } from '../../deltas/schema'
import type { GenCase } from '../../generator/types'
import { headline, isVerbose, joinPhrases, plural, subjectOf, tidyLabel } from '../plainLabel'
import type { Deriver, FlowInput, StepQuestion } from '../types'

/**
 * Blume — "Check it against real patients".
 *
 * The one screen where a surgeon finds out whether any of this works. Each
 * example referral is run through the REAL engine, and the screen leads with
 * the whole conclusion AND its reasoning — where the patient goes, how soon,
 * what gets ordered first, and why — before it asks anything. The old
 * workbench computed the same path and only revealed it after you clicked
 * "wrong", which asked a surgeon to agree with a conclusion whose derivation
 * was hidden; that is the bug this module exists to fix.
 *
 * The "why" is built from the BRANCH LABELS along the path taken. Those are
 * short and already written in clinician voice ("Symptoms over 6 months"),
 * unlike terminal names, which are whole guideline sentences. Nothing here
 * is phrased as a stored key: a case the engine can't finish is described as
 * something the referral doesn't say, never as a missing field.
 *
 * A correction is localized to ONE decision on the case's own path (the last
 * one by default — the usual culprit) and becomes a `retarget_branch`, exactly
 * as the workbench built it. The delta model is untouched.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

/** What the screen would do with this referral. */
export type CaseShape =
  /** Routed: a named destination, an urgency, a list to order first. */
  | 'sent'
  /** The guideline hands this one to a person. */
  | 'person'
  /** The referral is silent on something the guideline needs. */
  | 'unsaid'

/** One decision the case actually passed through, and the group it landed in. */
export interface CaseDecision {
  /** The question that decision asks, in the guideline's own words. */
  asked: string
  /** What this referral answered — the value that was read. */
  answer: string
  /** The group it put the patient in ("symptoms over 6 months"). */
  group: string
  /** Where a correction to this decision would be written. */
  branch: BranchAnchor
}

/** Somewhere else this referral could be sent. */
export interface CaseChoice {
  id: string
  /** Short enough for a dropdown. */
  label: string
  /** The full stored wording when `label` had to be shortened; else ''. */
  fullLabel: string
  target: { kind: 'node'; anchor: NodeAnchor } | { kind: 'escalation'; reason: string }
}

export interface CaseQuestion extends StepQuestion {
  kind: 'cases'
  /** True for the single honest screen shown when no referrals loaded. */
  unavailable: boolean
  /** The referral in the referrer's words. */
  narrative: string
  shape: CaseShape
  /** The line that introduces the conclusion. Never blank. */
  lead: string
  /** Who it goes to. Never blank, whatever the outcome. */
  destination: string
  /** The full stored wording when `destination` was shortened; else ''. */
  destinationFull: string
  /** How soon. Never blank, whatever the outcome. */
  urgency: string
  /** What gets ordered before the visit. Never blank, whatever the outcome. */
  testsLine: string
  /** The dominant sentence when the referral is silent on something. */
  unsaidSentence: string
  /** One lowercase sentence, built from the labels along the path. */
  reason: string
  /** What introduces `reason` — "Why:" reads wrong on a stalled referral. */
  reasonLead: string
  decisions: CaseDecision[]
  choices: CaseChoice[]
  acceptLabel: string
  /** "No — I'd send them to" — the dropdown follows it. */
  rejectLead: string
  /** Trailing word after the dropdown ("anyway"), or ''. */
  rejectSuffix: string
  /** Guideline text this referral's destination rests on, for the record. */
  cpgBasis: string
  /** 1-based position among the referrals being checked. */
  position: number
  total: number
}

/* -------------------------------------------------------------------------- */
/* Wording                                                                    */
/* -------------------------------------------------------------------------- */

const URGENCY_WORD: Record<Urgency, string> = {
  routine: 'routine',
  expedited: 'sooner than routine',
  urgent: 'urgent',
}

const PERSON = 'A person, to review'
const PERSON_SOON = 'as soon as someone can look at it'
const PERSON_TESTS = "Nothing gets ordered until someone has looked at it"

const QUESTION = "Is this where you'd send them?"
const GUIDELINE_LINE = "This is what the guideline, plus everything you've told us so far, works out to."
const STAKES_LINE =
  "If it's wrong, say so — we'll fix the step that got it wrong, and every other referral gets re-checked against the fix."

/** Synthetic routing roots the case runner fills in on the surgeon's behalf.
 *  They pick which part of the guideline applies, which is not a fact about
 *  the patient — they never appear in the reasoning or the correction list.
 *  (Mirrors `caseRunner`'s private predicate; that module is not ours to edit.) */
function isSyntheticKey(key: string): boolean {
  return key === 'master_cpg_root' || key.endsWith('cpg_section')
}

/** A branch label as it reads inside a sentence: no routing arrows, no
 *  stored-key debris, no trailing punctuation. */
export function phraseFor(label: string): string {
  const head = label.split(/→|->/)[0]
  return tidyLabel(head.replace(/_/g, ' ')).replace(/[.;:,]+$/, '').trim()
}

/** A value as a person would say it back. */
function answerText(value: unknown): string {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  if (value === null || value === undefined) return 'not given'
  return String(value).replace(/_/g, ' ')
}

/** Subjects that read as things a referral either has or hasn't got, so the
 *  sentence can say "whether there are any …" instead of "anything about …". */
const COUNTABLE_SUBJECT = /\b(flags?|features?|symptoms?|findings?|signs?|deficits?)$/

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

/** Terminals a correction can point at. Placeholders are offered only when
 *  there is nothing else — an empty dropdown is worse than a raw label. */
function destinationsIn(tree: Tree): SpecialistNode[] {
  const all = tree.nodes.filter((n): n is SpecialistNode => n.type === 'specialist')
  const named = all.filter((n) => !n.specialistName.startsWith('[Assign'))
  return named.length > 0 ? named : all
}

function choicesFor(tree: Tree, opts: { exclude?: string; includePerson: boolean }): CaseChoice[] {
  const choices: CaseChoice[] = destinationsIn(tree)
    .filter((n) => n.id !== opts.exclude)
    .map((n) => ({
      id: n.id,
      label: isVerbose(n.specialistName) ? headline(n.specialistName) : n.specialistName,
      fullLabel: isVerbose(n.specialistName) ? n.specialistName : '',
      target: { kind: 'node' as const, anchor: anchorForNode(n) },
    }))
  // Offering "a person" to a referral already going to a person is a no-op.
  if (opts.includePerson) {
    choices.push({
      id: '__person__',
      label: 'a person, to review',
      fullLabel: '',
      target: { kind: 'escalation', reason: 'A person should look at referrals like this one.' },
    })
  }
  return choices
}

/** The decisions this referral actually passed through, in order. */
function decisionsFor(tree: Tree, pathTaken: string[], values: Record<string, unknown>): CaseDecision[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const out: CaseDecision[] = []
  for (let i = 0; i < pathTaken.length - 1; i++) {
    const node = byId.get(pathTaken[i])
    if (!node || node.type !== 'variable') continue
    if (isSyntheticKey(node.variableKey)) continue
    const branchIndex = node.branches.findIndex((b) => b.nextNodeId === pathTaken[i + 1])
    if (branchIndex < 0) continue
    out.push({
      asked: node.prompt,
      answer: answerText(values[node.variableKey]),
      group: phraseFor(node.branches[branchIndex].label),
      branch: anchorForBranch(node, branchIndex),
    })
  }
  return out
}

/** One lowercase sentence, scannable in ten seconds, made of path labels. */
function reasonFrom(decisions: CaseDecision[]): string {
  const parts = decisions.map((d) => d.group).filter(Boolean)
  if (parts.length === 0) return 'nothing in this referral sent it anywhere else'
  return joinPhrases(parts)
}

function testsLineFor(names: string[]): string {
  if (names.length === 0) return 'No tests to order before the visit'
  return `Order first: ${names.join(', ')}`
}

/** "This referral doesn't say whether there are any red flag features, so it
 *  would go to a person to review." — the blocking question in patient terms,
 *  never as a stored key. */
function unsaidSentenceFor(node: VariableNode | undefined, key: string): string {
  const subject = subjectOf(node ? node.variableKey : key)
  const clause = COUNTABLE_SUBJECT.test(subject) ? `whether there are any ${subject}` : `anything about ${subject}`
  return `This referral doesn't say ${clause}, so it would go to a person to review.`
}

function questionFor(tree: Tree, genCase: GenCase, position: number, total: number): CaseQuestion {
  const base = {
    id: `cases:${genCase.id}`,
    question: QUESTION,
    guidelineLine: GUIDELINE_LINE,
    stakesLine: STAKES_LINE,
    kind: 'cases' as const,
    unavailable: false,
    narrative: genCase.narrative,
    lead: "Here's where this referral would go:",
    destinationFull: '',
    unsaidSentence: '',
    reasonLead: 'Why:',
    cpgBasis: '',
    position,
    total,
  }

  let outcome
  try {
    outcome = runCase(tree, genCase.groundTruth as Record<string, unknown>)
  } catch {
    return {
      ...base,
      shape: 'person',
      lead: "Here's what would happen to this referral:",
      destination: PERSON,
      urgency: PERSON_SOON,
      testsLine: PERSON_TESTS,
      reason: "we couldn't work this referral through from end to end",
      decisions: [],
      choices: [],
      acceptLabel: "✓ That's right",
      rejectLead: 'No — it should go to',
      rejectSuffix: 'anyway',
    }
  }

  const { result } = outcome
  const values = { ...(genCase.groundTruth as Record<string, unknown>), ...outcome.autoFilled }
  const decisions = decisionsFor(tree, result.pathTaken, values)
  const reason = reasonFrom(decisions)

  if (result.outcome === 'routed' && result.specialist) {
    const spec = result.specialist
    const long = isVerbose(spec.specialistName)
    return {
      ...base,
      shape: 'sent',
      destination: long ? headline(spec.specialistName) : spec.specialistName,
      destinationFull: long ? spec.specialistName : '',
      urgency: URGENCY_WORD[spec.urgency],
      testsLine: testsLineFor((result.resolvedWorkup?.ordered ?? []).map((w) => w.name)),
      reason,
      decisions,
      choices: choicesFor(tree, { exclude: spec.id, includePerson: true }),
      acceptLabel: "✓ That's where I'd send them",
      rejectLead: "No — I'd send them to",
      rejectSuffix: '',
      cpgBasis: spec.clinicalBasis ?? '',
    }
  }

  if (result.outcome === 'escalated') {
    return {
      ...base,
      shape: 'person',
      lead: "Here's what would happen to this referral:",
      destination: PERSON,
      urgency: PERSON_SOON,
      testsLine: PERSON_TESTS,
      reason,
      decisions,
      choices: choicesFor(tree, { includePerson: false }),
      acceptLabel: "✓ That's right",
      rejectLead: 'No — it should go to',
      rejectSuffix: 'anyway',
    }
  }

  // The engine stopped on a question this referral doesn't answer.
  const stalledId = result.pathTaken[result.pathTaken.length - 1]
  const stalled = tree.nodes.find((n) => n.id === stalledId)
  const stalledVar = stalled && stalled.type === 'variable' ? stalled : undefined
  return {
    ...base,
    shape: 'unsaid',
    lead: "Here's what would happen to this referral:",
    destination: PERSON,
    urgency: PERSON_SOON,
    testsLine: PERSON_TESTS,
    unsaidSentence: unsaidSentenceFor(stalledVar, result.missingVariables[0] ?? ''),
    reason,
    reasonLead: 'Up to that point:',
    decisions,
    choices: choicesFor(tree, { includePerson: false }),
    acceptLabel: "✓ That's right — send it to a person",
    rejectLead: 'No — it should go to',
    rejectSuffix: 'anyway',
  }
}

/** The screen shown when the case bank didn't load. One honest question —
 *  never a blank screen, and never a "generate" button as the only thing on it. */
function noCasesQuestion(): CaseQuestion {
  return {
    id: 'cases:none',
    question: 'Can we check this against real referrals?',
    guidelineLine: "We couldn't load example referrals for this specialty.",
    stakesLine:
      "Everything you've told us still stands — this was the chance to watch it play out on real referrals before you sign off.",
    kind: 'cases',
    unavailable: true,
    narrative: '',
    shape: 'person',
    lead: '',
    destination: '',
    destinationFull: '',
    urgency: '',
    testsLine: '',
    unsaidSentence: '',
    reason: '',
    reasonLead: '',
    decisions: [],
    choices: [],
    acceptLabel: '✓ Skip this check',
    rejectLead: '',
    rejectSuffix: '',
    cpgBasis: '',
    position: 1,
    total: 1,
  }
}

export const deriveCaseQuestions: Deriver<CaseQuestion> = (input: FlowInput) => {
  if (input.cases.length === 0) return [noCasesQuestion()]
  return input.cases.map((c, i) => questionFor(input.tree, c, i + 1, input.cases.length))
}

/* -------------------------------------------------------------------------- */
/* Sentences the flow records                                                 */
/* -------------------------------------------------------------------------- */

export function acceptSummary(q: CaseQuestion): string {
  if (q.unavailable) return "Skipped the check against real referrals — none had loaded."
  if (q.shape === 'sent') return `Agreed — this referral goes to ${q.destination}.`
  return 'Agreed — this referral goes to a person to review.'
}

export function changeSummary(decision: CaseDecision, choice: CaseChoice): string {
  const where = choice.target.kind === 'escalation' ? 'a person to review' : choice.label
  return `Anyone whose answer was “${decision.group}” now goes to ${where}.`
}

export function flagSummary(): string {
  return "Made a note about a referral that didn't come out right."
}

/** "You've agreed with 8 of 10 so far." — and something true on the first one. */
export function tallyLine(agreed: number, checked: number, total: number): string {
  if (checked === 0) return `${plural(total, 'referral')} to check.`
  return `You've agreed with ${agreed} of ${checked} so far.`
}
