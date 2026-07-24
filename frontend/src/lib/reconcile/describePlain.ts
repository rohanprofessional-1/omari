import type { Condition, Urgency } from '../../types/tree'
import type { BranchAnchor, Delta, NodeAnchor } from '../deltas/schema'
import { formatNumber, headline, subjectOf, tidyLabel } from './plainLabel'

/**
 * Blume — clinic changes as plain sentences.
 *
 * `lib/deltas/describe.ts` renders the DATA ("Set the 'Duration < 6 weeks'
 * threshold on 'duration_of_symptoms_weeks' to ≥ 8"). That is the right voice
 * for the stored governance record and the wrong voice for a person, so this
 * module renders the same change the way a surgeon would say it out loud.
 *
 * It is a fallback: the flow records its own summary sentence when a question
 * is answered ("Patients under 8 weeks now go to conservative management"),
 * because at that moment we know both the old answer and the new one. This
 * covers changes that arrive without one — Sprout's freeform edits, and
 * anything authored in an earlier session.
 */

const URGENCY_PHRASE: Record<Urgency, string> = {
  routine: 'as routine',
  expedited: 'sooner than routine',
  urgent: 'urgently',
}

function whoText(a: NodeAnchor): string {
  if (a.kind === 'variable') return `patients asked about ${subjectOf(a.variableKey)}`
  if (a.kind === 'terminal') {
    if (a.specialistName) return headline(a.specialistName).toLowerCase()
    return a.specialty ? a.specialty.toLowerCase() : 'these patients'
  }
  return 'these patients'
}

function groupText(b: BranchAnchor): string {
  return b.label ? `“${tidyLabel(b.label)}”` : 'this group'
}

function conditionText(c: Condition): string {
  if (c.op === 'equals') return `is ${String(c.value)}`
  if (c.op === 'range') {
    if (c.min !== undefined && c.max !== undefined) return `is between ${formatNumber(c.min)} and ${formatNumber(c.max)}`
    if (c.min !== undefined) return `is ${formatNumber(c.min)} or more`
    return `is under ${formatNumber(c.max!)}`
  }
  return `is one of ${c.values.join(', ')}`
}

export function describePlainDelta(delta: Delta): string {
  const p = delta.payload
  switch (p.op) {
    case 'bind_terminal': {
      const who = p.anchors.length === 1 ? whoText(p.anchors[0]) : `${p.anchors.length} kinds of referral`
      return p.target.kind === 'specialist'
        ? `${sentence(who)} now go to ${p.target.specialistName}.`
        : `${sentence(who)} now go to a person to review — ${p.target.reason.toLowerCase()}.`
    }
    case 'set_urgency': {
      const who = p.anchors.length === 1 ? whoText(p.anchors[0]) : `${p.anchors.length} kinds of referral`
      return `${sentence(who)} are seen ${URGENCY_PHRASE[p.urgency]}.`
    }
    case 'set_threshold':
      return p.mode === 'replace' && p.replacement
        ? `Your cutoff for ${groupText(p.branch)} is now that it ${conditionText(p.replacement)}.`
        : `You split ${groupText(p.branch)} into ${p.split?.length ?? 0} groups.`
    case 'add_workup':
      return p.when
        ? `${p.item.name} is ordered before visits to ${whoText(p.anchor)} when ${subjectOf(p.when.key)} ${conditionText(p.when)}.`
        : `${p.item.name} is ordered before every visit to ${whoText(p.anchor)}.`
    case 'remove_workup':
      return p.guardInstead
        ? `${p.itemName} is only ordered for ${whoText(p.anchor)} when ${subjectOf(p.guardInstead.key)} ${conditionText(p.guardInstead)}.`
        : `${p.itemName} is no longer ordered for ${whoText(p.anchor)}.`
    case 'set_scope':
    case 'suppress_branch':
      return `You don't treat ${groupText(p.branch)} here — those patients go to a person to review.`
    case 'retarget_branch':
      return p.target.kind === 'node'
        ? `${sentence(groupText(p.branch))} now goes to ${whoText(p.target.anchor)}.`
        : `${sentence(groupText(p.branch))} now goes to a person to review.`
    case 'add_rule':
      return `You added a rule before ${groupText(p.insertAt)}: “${p.prompt}”.`
    case 'reorder_priority':
      return `You changed the order these are checked in.`
    case 'reword':
      return `You reworded something. Nothing about where patients go changed.`
  }
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function describePlainDeltas(deltas: Delta[]): string[] {
  return [...deltas].sort((a, b) => a.seq - b.seq).map(describePlainDelta)
}
