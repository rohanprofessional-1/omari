import type { Node as TreeNode, Tree, VariableNode } from '../../../types/tree'
import { detectBuilderGaps } from '../../assistant/gaps'
import type { DeltaDraft } from '../../deltas/api'
import { anchorForBranch, anchorForNode, fnv1a } from '../../deltas/resolve'
import { countWord, headline, isVerbose, joinPhrases, plural } from '../plainLabel'
import type { Deriver, FlowInput, StepQuestion } from '../types'

/**
 * Blume — the safety check: the last screen before sign-off.
 *
 * Its whole job is to let a surgeon turn this on without fear, so it reports
 * ONLY what could actually strand a patient:
 *
 *   1. a destination with nobody assigned to it yet,
 *   2. a group of patients whose answer leads nowhere — either because it has
 *      no destination at all, or because its destination is a dead zone no
 *      route out of which ever reaches a person.
 *
 * Everything else the shared detector finds is collapsed into one calm,
 * non-blocking sentence or dropped. That is not cosmetic: `detectBuilderGaps`
 * emits one finding per occurrence, and "no tests before the visit" fires on
 * every destination — six near-identical paragraphs in the real tree. Noise on
 * a safety screen is worse than nothing, because it teaches the reader that
 * this screen can be ignored.
 *
 * The findings themselves come from `detectBuilderGaps`, the same detector the
 * Builder uses. This module never decides what a hole IS; it decides which
 * holes are worth a surgeon's attention and how they are said out loud.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** Stored on every fix this screen writes. Plain, and true a year later. */
const UNASSIGNED_REASON = 'No one assigned yet — needs a person to triage'
const UNFINISHED_REASON = 'Unfinished — needs a person to triage'

const ACCEPT_LABEL = '✓ Looks good'
const ACCEPT_SUMMARY = 'Checked — every patient reaches someone.'

// Says only what is true of a draft nobody has signed yet: a destination the
// guideline named is a place to send someone, not a colleague who has agreed
// to see them. Overclaiming here would be the one thing a safety screen
// cannot do.
const SAFE_MEANS = 'every patient ends up somewhere — either a specific place to send them, or a person to review'

/** `[Assign specialist — Action Urology Referral]` → the area of care inside.
 *  Same shape the routing section reads, so a destination is called the same
 *  thing here as it was when they were assigning it. */
const PLACEHOLDER = /^\[Assign specialist\s*[—–-]\s*(.*)]$/

/**
 * An escalation that exists BECAUSE of a decision the surgeon made in this
 * interview ("we don't treat that here"). A destination left with nothing
 * pointing at it next to one of these is the system doing as it was told.
 */
const DECISION_REASON =
  /out of scope for this clinic|we (?:don'?t|do not)|don'?t treat|do not treat|not treated (?:here|at this clinic)|no longer (?:see|treat)/i

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

/** One thing that could leave a patient with nowhere to go, and its fix. */
export interface SafetyGap {
  /** Stable per occurrence; used as a row key and for the question id. */
  id: string
  /** "Suspected internal derangement has no one assigned." */
  sentence: string
  /** "Send these to a person to review until you assign someone." */
  fix: string
  /** What gets written if this row stays checked. Payload only — the shell
   *  stamps provenance. */
  drafts: DeltaDraft[]
}

export interface SafetyQuestion extends StepQuestion {
  kind: 'safety'
  /** Empty on a clean tree — the common case, and the one that must feel like
   *  an ending rather than an empty list. */
  gaps: SafetyGap[]
  /** True, non-blocking, nothing to decide. Rendered quietly. */
  notes: string[]
  /** The clean-case statement of what was checked. Never blank. */
  reassurance: string
  acceptLabel: string
  acceptSummary: string
}

/* -------------------------------------------------------------------------- */
/* Copy helpers (exported so the wording is testable without React)           */
/* -------------------------------------------------------------------------- */

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The primary button. Fixing everything is the default and the safe click. */
export function fixLabel(selected: number, total: number): string {
  if (selected <= 0) return '✓ Leave them as they are'
  if (selected === total) {
    if (total === 1) return '✓ Fix it'
    if (total === 2) return '✓ Fix both'
    return `✓ Fix all ${countWord(total)}`
  }
  return `✓ Fix ${countWord(selected)}`
}

/** What the sign-off page will say about this screen. */
export function fixSummary(selected: number): string {
  return selected === 1
    ? 'Fixed one thing that could have left a patient with nowhere to go.'
    : `Fixed ${countWord(selected)} things that could have left a patient with nowhere to go.`
}

/** They read every row and chose to leave them. Also a complete answer. */
export function leaveSummary(total: number): string {
  return total === 1
    ? 'Reviewed — left one thing as it is.'
    : `Reviewed — left ${countWord(total)} things as they are.`
}

/* -------------------------------------------------------------------------- */
/* Naming                                                                     */
/* -------------------------------------------------------------------------- */

/** A destination as a surgeon would name it. The stored names in a generated
 *  tree are whole guideline sentences (17–18 words); a gap written around one
 *  of those is unreadable, so anything verbose gets its headline. */
function destinationName(node: TreeNode): string {
  if (node.type !== 'specialist') return 'This destination'
  const raw = node.specialistName.startsWith('[Assign')
    ? (PLACEHOLDER.exec(node.specialistName)?.[1] ?? node.specialty)
    : node.specialistName
  const cleaned = raw.replace(/\*\*/g, '').trim()
  return (isVerbose(cleaned) ? headline(cleaned) : cleaned) || 'This destination'
}

/** A group of patients as the guideline labelled it. */
function groupName(label: string, index: number): string {
  const cleaned = label.replace(/\*\*/g, '').trim()
  if (!cleaned) return `Group ${index + 1}`
  return isVerbose(cleaned) ? headline(cleaned) : cleaned
}

/** 'doc_<hex>_s4_...' → 's4'. '' for hand-built ids (an unsectioned tree). */
function sectionOf(nodeId: string): string {
  return /^doc_[0-9a-f]+_(s\d+)_/.exec(nodeId)?.[1] ?? ''
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

export const deriveSafetyQuestions: Deriver<SafetyQuestion> = ({ tree }: FlowInput) => {
  const found = detectBuilderGaps(tree)
  const ids = new Set(found.map((g) => g.id))
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))

  /* The detector already computed reachability; read it back off the findings
   * rather than recomputing a second, divergeable copy of it here. */
  const stranded = new Set(suffixes(found, 'unreachable-'))
  const noWorkup = new Set(suffixes(found, 'no-workup-'))
  /* Reachable places from which no route out ever arrives at a person: either
   * a question whose answers all lead into one, or a question with no answers
   * at all. */
  const deadZone = new Set([...suffixes(found, 'no-terminal-'), ...suffixes(found, 'no-buckets-')])

  const gaps: SafetyGap[] = []

  /* 1. Destinations with nobody assigned. An unreached one cannot strand
   *    anyone, so it is not raised here. */
  for (const node of tree.nodes) {
    if (node.type !== 'specialist') continue
    if (stranded.has(node.id) || !node.specialistName.startsWith('[Assign')) continue
    gaps.push({
      id: `unassigned-${node.id}`,
      sentence: `${destinationName(node)} has no one assigned.`,
      fix: 'Send these to a person to review until you assign someone.',
      drafts: [
        {
          payload: {
            op: 'bind_terminal',
            anchors: [anchorForNode(node)],
            target: { kind: 'escalation', reason: UNASSIGNED_REASON },
          },
        },
      ],
    })
  }

  /* 2. Groups of patients that lead nowhere. One row per group, taken at the
   *    edge of the dead zone — fixing the way in fixes everything behind it,
   *    and every group that still leads somewhere is left alone. */
  for (const node of tree.nodes) {
    if (node.type !== 'variable' || stranded.has(node.id)) continue
    if (deadZone.has(node.id) && node.id !== tree.rootNodeId) continue
    node.branches.forEach((branch, index) => {
      const dangling = !branch.nextNodeId || !byId.has(branch.nextNodeId)
      const intoDeadZone = !dangling && deadZone.has(branch.nextNodeId)
      if (!dangling && !intoDeadZone) return
      /* Keep the shared detector the authority on what counts as a hole. */
      if (dangling && !ids.has(`dangling-${node.id}-${index}`)) return
      gaps.push({
        id: `dead-end-${node.id}-${index}`,
        sentence: `"${groupName(branch.label, index)}" doesn't lead anywhere.`,
        fix: 'Send these to a person to review.',
        drafts: [
          {
            payload: {
              op: 'retarget_branch',
              branch: anchorForBranch(node as VariableNode, index),
              target: { kind: 'escalation', reason: UNFINISHED_REASON },
            },
          },
        ],
      })
    })
  }

  const notes = buildNotes(tree, { stranded, noWorkup, byId })

  if (gaps.length === 0) {
    return [
      {
        kind: 'safety',
        id: 'safety:clean',
        question: 'Is this safe to turn on?',
        guidelineLine: `${capitalize(SAFE_MEANS)}.`,
        stakesLine: "Nothing can fall through — there is no patient this doesn't have an answer for.",
        gaps,
        notes,
        reassurance: buildReassurance(tree, stranded),
        acceptLabel: ACCEPT_LABEL,
        acceptSummary: ACCEPT_SUMMARY,
      },
    ]
  }

  const n = gaps.length
  return [
    {
      kind: 'safety',
      /* Stable given the same set of holes, so an answer already given isn't
       * forgotten when the tree recompiles underneath the session. */
      id: `safety:${fnv1a(gaps.map((g) => g.sentence).sort().join('\n'))}`,
      question:
        n === 1
          ? 'One thing could leave a patient with nowhere to go. Fix it?'
          : `${capitalize(countWord(n))} things could leave a patient with nowhere to go. Fix them?`,
      guidelineLine: `Safe means ${SAFE_MEANS}.`,
      stakesLine:
        n === 1
          ? 'Until this is fixed, a referral that lands here would stop with no one responsible for it.'
          : 'Until these are fixed, a referral that lands here would stop with no one responsible for it.',
      gaps,
      notes,
      reassurance: buildReassurance(tree, stranded),
      acceptLabel: ACCEPT_LABEL,
      acceptSummary: ACCEPT_SUMMARY,
    },
  ]
}

/** Every finding of one category, as the node ids behind it. */
function suffixes(found: Array<{ id: string }>, prefix: string): string[] {
  return found.filter((g) => g.id.startsWith(prefix)).map((g) => g.id.slice(prefix.length))
}

/* -------------------------------------------------------------------------- */
/* The quiet lines                                                            */
/* -------------------------------------------------------------------------- */

function buildNotes(
  tree: Tree,
  ctx: { stranded: Set<string>; noWorkup: Set<string>; byId: Map<string, TreeNode> },
): string[] {
  const notes: string[] = []

  /* "No tests before the visit" fires once per destination and is not a
   * problem — it is a choice the previous section already offered. One
   * sentence, no matter how many destinations it covers. */
  const destinations = tree.nodes.filter((n) => n.type === 'specialist' && !ctx.stranded.has(n.id))
  if (ctx.noWorkup.size > 0 && destinations.length > 0) {
    notes.push(
      `${ctx.noWorkup.size} of your ${destinations.length} destinations have no tests ordered ahead of the visit. ` +
        `That's allowed — go back to "Tests before the visit" if you'd like to change it.`,
    )
  }

  /* A destination nothing points at cannot strand anyone, and when the surgeon
   * themselves rerouted the group that used to lead there, saying anything at
   * all would be reporting their own decision back to them as a fault. */
  const leftOver = [...ctx.stranded].filter((id) => !explainedByDecision(tree, id, ctx.stranded))
  if (leftOver.length > 0) {
    notes.push(
      leftOver.length === 1
        ? "One destination isn't reached by any of your answers — no patient can land there."
        : `${capitalize(countWord(leftOver.length))} destinations aren't reached by any of your answers — no patient can land there.`,
    )
  }

  return notes
}

/** Is this stranded destination explained by a decision already made? */
function explainedByDecision(tree: Tree, strandedId: string, stranded: Set<string>): boolean {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const section = sectionOf(strandedId)
  for (const node of tree.nodes) {
    if (node.type !== 'variable' || stranded.has(node.id)) continue
    if (sectionOf(node.id) !== section) continue
    for (const branch of node.branches) {
      const target = byId.get(branch.nextNodeId)
      if (target?.type === 'escalation' && DECISION_REASON.test(target.reason)) return true
    }
  }
  return false
}

/** The clean-case ending: what was checked, said definitely. */
function buildReassurance(tree: Tree, stranded: Set<string>): string {
  const live = tree.nodes.filter((n) => n.type !== 'variable' && !stranded.has(n.id))
  const named = live.filter((n) => n.type === 'specialist').length
  const review = live.filter((n) => n.type === 'escalation').length
  if (live.length === 0) return 'We followed every answer through to the end and found nothing left hanging.'
  // Say what is TRUE of the draft, not what we'd like to be true: a
  // destination the guideline named is a place to send someone, which is not
  // the same as a person in this clinic having agreed to see them.
  const parts: string[] = []
  if (named > 0) parts.push(`${countWord(named)} end with a specific place to send the patient`)
  if (review > 0) parts.push(`${countWord(review)} go to a person to review`)
  return `We followed every answer through to the end: ${plural(live.length, 'destination')} in all — ${joinPhrases(parts)}.`
}
