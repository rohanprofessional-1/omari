import type { Branch, Condition, Node as TreeNode, Tree, VariableNode } from '../../../types/tree'
import { anchorForBranch, conditionFingerprint, fnv1a, normalizeKey } from '../../deltas/resolve'
import type { BranchAnchor } from '../../deltas/schema'
import { countWord, formatNumber, headline, isVerbose, joinPhrases, subjectOf, tidyLabel } from '../plainLabel'
import type { Deriver, FlowInput, StepQuestion } from '../types'

/**
 * Blume — "What you treat": the first thing a surgeon is asked.
 *
 * THE TRAP THIS MODULE EXISTS TO AVOID. A CPG-generated base does not start
 * at a clinical decision. It starts at a synthetic router whose answers are
 * the headings of the PDF it was extracted from — "**Scope**", "**Narrative
 * Notes**". Listing those and asking "which of these do you handle?" asks a
 * surgeon about a table of contents. So we walk PAST every synthetic router
 * to the first real clinical decision under each section, and take the
 * patient groups from THOSE.
 *
 * Then three filters, in this order:
 *   1. A group whose destination is already a person is not a question —
 *      those patients are already handled the way unchecking would handle
 *      them.
 *   2. A safety route is not a scope question. "Red flags present" is how a
 *      guideline protects a patient, not a service line a clinic opts out of.
 *      What survives is decisions whose answers read as "which patients":
 *      age ranges and presentation types.
 *   3. The same decision appears under several sections of one document.
 *      Identical groups (same normalized key, same condition) collapse.
 *
 * And one judgement that decides which screen gets built. A decision with
 * only ONE remaining group is not a choice — it is a PRECONDITION. Every
 * other answer already goes to a person, so unchecking the survivor would
 * mean "we don't see the only patients this guideline is about". Those
 * become the sentence on a confirmation screen instead of rows in a
 * checklist. Only decisions with two or more live groups are real choices.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulary guards                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Our words, never theirs. Any string this module composes for a screen is
 * checked against these; guideline wording we quote verbatim is the one thing
 * we don't rewrite, because paraphrasing clinical text is not our call.
 */
const HOUSE_JARGON =
  /\b(node|endpoint|tree|delta|reconcile|gap sweep|threshold|variable|condition|mapping|band|publish|scope|branch|anchor)s?\b/i

/** True when a string we composed is safe to show. */
function isPlain(text: string): boolean {
  return text.length > 0 && !HOUSE_JARGON.test(text)
}

/* -------------------------------------------------------------------------- */
/* What the screen carries                                                    */
/* -------------------------------------------------------------------------- */

/** One kind of patient the guideline routes, offered as a checkable row. */
export interface ScopeGroup {
  /** Stable within the question. Not shown to anyone. */
  id: string
  /** Row text. Short enough to scan; `headline()`d when the label is long. */
  label: string
  /** The guideline's own sentence, on expand. Never blank. */
  guidelineWording: string
  /** Two or three presentations found underneath, for "Patients who…". */
  examples: string[]
  /** Where the `set_scope` delta lands if this row is unchecked. */
  anchor: BranchAnchor
}

export interface ScopeQuestion extends StepQuestion {
  kind: 'scope'
  /**
   * 'choices' — two or more real choices, rendered as a checklist.
   * 'confirm' — the guideline covers one narrow population; there is nothing
   * to uncheck, only to confirm or to tell us we see more than that.
   */
  mode: 'choices' | 'confirm'
  /** Rows, in 'choices' mode. Empty in 'confirm'. */
  groups: ScopeGroup[]
  /** "non-traumatic knee pain in adults aged 18 to 75" — 'confirm' mode. */
  covers: string
}

/* -------------------------------------------------------------------------- */
/* Walking past the document-section routers                                  */
/* -------------------------------------------------------------------------- */

/**
 * A router the extractor invented so several sections of one PDF (or several
 * PDFs) could hang off one root. Its answers are headings, not clinical facts.
 * See `cpg_service.py` — per-document routers key on `<doc>_cpg_section`, the
 * multi-document master keys on `master_cpg_root`.
 */
function isSyntheticRouter(node: TreeNode): boolean {
  if (node.type !== 'variable') return false
  const key = normalizeKey(node.variableKey)
  return key === 'master_cpg_root' || /(^|_)cpg_section$/.test(key)
}

/** The first real clinical decision under each section, in document order. */
function firstRealDecisions(tree: Tree, byId: Map<string, TreeNode>): VariableNode[] {
  const out: VariableNode[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    const node = byId.get(id)
    if (!node || node.type !== 'variable') return
    if (isSyntheticRouter(node)) {
      for (const b of node.branches) walk(b.nextNodeId)
      return
    }
    out.push(node)
  }
  walk(tree.rootNodeId)
  return out
}

/* -------------------------------------------------------------------------- */
/* Which decisions are "which patients" decisions                             */
/* -------------------------------------------------------------------------- */

/** Safety routing. Never a service line a clinic declines. */
const SAFETY_KEY = /red[_ ]?flag|urgent|emergen|alarm|danger|warning/

/**
 * Findings and measurements — imaging, symptom duration, severity scores.
 * These are what the cutoffs and tests sections are for; they describe a
 * patient's state on the day, not the kind of patient a clinic takes.
 */
const MEASURE_KEY =
  /duration|weeks|months|days|score|grade|severity|level|count|bmi|radiograph|imaging|finding|treatment|symptom/

const AGE_KEY = /(^|_)age($|_)/

/**
 * Does this decision's answer set read as "which patients"? Age ranges and
 * named presentation types do. Yes/no findings never do: a boolean is a fact
 * about one patient, not a population.
 */
function isPatientGroupDecision(node: VariableNode): boolean {
  const key = normalizeKey(node.variableKey)
  if (SAFETY_KEY.test(key)) return false
  const ageLike = AGE_KEY.test(key)
  if (!ageLike && MEASURE_KEY.test(key)) return false
  return node.branches.some(
    (b) =>
      (b.condition.op === 'equals' && typeof b.condition.value === 'string') ||
      b.condition.op === 'in' ||
      (b.condition.op === 'range' && ageLike),
  )
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */

interface Candidate {
  node: VariableNode
  branch: Branch
  branchIndex: number
  /** Normalized decision key — survives a re-upload. */
  key: string
  /** Identity of the patient group itself, for collapsing repeats. */
  dedupeKey: string
}

/** Every group a clinic could still be asked about, repeats collapsed. */
function liveGroups(tree: Tree, byId: Map<string, TreeNode>): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const node of firstRealDecisions(tree, byId)) {
    if (!isPatientGroupDecision(node)) continue
    node.branches.forEach((branch, branchIndex) => {
      // Already goes to a person — there is nothing to ask.
      if (byId.get(branch.nextNodeId)?.type === 'escalation') return
      const key = normalizeKey(node.variableKey)
      const dedupeKey = `${key}::${conditionFingerprint(branch.condition)}`
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      out.push({ node, branch, branchIndex, key, dedupeKey })
    })
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Wording                                                                    */
/* -------------------------------------------------------------------------- */

/** A stored label as a row heading: markdown gone, ranges spelled out. */
function displayLabel(label: string): string {
  const stripped = label.replace(/\*\*/g, '').trim()
  if (isVerbose(stripped)) return headline(stripped)
  return stripped.replace(/\s*[–—-]\s*(?=\d)/g, ' to ').replace(/\s{2,}/g, ' ').trim()
}

/** Words that only classify the subject and add nothing said aloud. */
const CLASSIFIER_NOUN = new Set([
  'etiology',
  'aetiology',
  'type',
  'onset',
  'category',
  'presentation',
  'mechanism',
  'origin',
  'cause',
  'group',
  'class',
  'check',
])

/**
 * A subject so generic it names nothing a patient would recognise. When the
 * key reduces to one of these ("presentation_type" → "presentation"), the
 * guideline's own label is the better phrase.
 */
const GENERIC_SUBJECT = new Set([
  'presentation',
  'patient',
  'patients',
  'referral',
  'case',
  'cases',
  'pathway',
  'criteria',
  'indication',
  'entry',
  'population',
])

/** "18 to 75" as a person says it, with the population named. */
function agePhrase(condition: Condition): string {
  if (condition.op !== 'range') return ''
  const { min, max } = condition
  const who = min != null && min >= 18 ? 'adults' : 'patients'
  if (min != null && max != null) return `${who} aged ${formatNumber(min)} to ${formatNumber(max)}`
  if (min != null) return `${who} aged ${formatNumber(min)} and over`
  if (max != null) return `patients aged ${formatNumber(max)} and under`
  return ''
}

/**
 * "non-traumatic knee pain" — built from the decision's subject and the
 * answer's stored value rather than from the label, because the same group is
 * labelled differently in different sections of one document and the value is
 * the part that is actually the same.
 */
function categoricalPhrase(node: VariableNode, branch: Branch): string {
  if (branch.condition.op !== 'equals' || typeof branch.condition.value !== 'string') return ''
  const subject = subjectOf(node.variableKey).split(/\s+/).filter(Boolean)
  if (subject.length > 1 && CLASSIFIER_NOUN.has(subject[subject.length - 1])) subject.pop()
  const noun = subject.join(' ')
  if (subject.length <= 1 && GENERIC_SUBJECT.has(noun)) return ''
  const value = branch.condition.value
    .replace(/^non[_-]/i, 'non-')
    .replace(/_/g, ' ')
    .trim()
  if (!noun) return value
  if (!value) return noun
  // "traumatic knee pain" — don't say the same word twice.
  if (value.split(/[\s-]+/).some((w) => w.length > 3 && noun.includes(w))) return noun
  return `${value} ${noun}`
}

/** How a group is named inside a sentence. */
function groupPhrase(c: Candidate): string {
  const age = AGE_KEY.test(c.key) ? agePhrase(c.branch.condition) : ''
  if (age) return age
  const categorical = categoricalPhrase(c.node, c.branch)
  if (categorical && isPlain(categorical)) return categorical
  return tidyLabel(displayLabel(c.branch.label))
}

/**
 * "non-traumatic knee pain in adults aged 18 to 75" — the populations the
 * guideline already narrows to, said in one breath.
 */
function coversSentence(candidates: Candidate[]): string {
  const ages: string[] = []
  const kinds: string[] = []
  for (const c of candidates) {
    const phrase = groupPhrase(c)
    if (!isPlain(phrase)) continue
    const bucket = AGE_KEY.test(c.key) ? ages : kinds
    if (!bucket.includes(phrase)) bucket.push(phrase)
  }
  if (kinds.length === 0) return ages[0] ?? ''
  const what = joinPhrases(kinds)
  return ages.length > 0 ? `${what} in ${ages[0]}` : what
}

/**
 * Two or three presentations from under a group, so "does your clinic handle
 * this?" is answerable without opening the Builder. Anything already routed
 * to a person is not an example of what you'd be taking on.
 */
function examplesUnder(startId: string, byId: Map<string, TreeNode>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let frontier = [startId]
  for (let depth = 0; depth < 3 && frontier.length > 0 && out.length < 3; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      const node = byId.get(id)
      if (!node || node.type !== 'variable') continue
      if (!isSyntheticRouter(node)) {
        for (const b of node.branches) {
          if (byId.get(b.nextNodeId)?.type === 'escalation') continue
          const text = tidyLabel(displayLabel(b.label))
          if (isPlain(text) && !out.includes(text)) out.push(text)
        }
      }
      for (const b of node.branches) next.push(b.nextNodeId)
    }
    frontier = next
  }
  return out.slice(0, 3)
}

/** The guideline's own words behind a row. Never blank. */
function wording(c: Candidate, shown: string): string {
  const full = c.branch.label.replace(/\*\*/g, '').trim()
  if (full && full.toLowerCase() !== shown.toLowerCase()) return full
  return c.node.prompt.replace(/\*\*/g, '').trim() || full
}

function toGroup(c: Candidate, byId: Map<string, TreeNode>): ScopeGroup {
  const label = displayLabel(c.branch.label)
  return {
    id: c.dedupeKey,
    label,
    guidelineWording: wording(c, label),
    examples: examplesUnder(c.branch.nextNodeId, byId),
    anchor: anchorForBranch(c.node, c.branchIndex),
  }
}

/**
 * Ids survive a guideline re-upload: normalized keys (doc prefixes stripped)
 * plus a hash of the group labels, which are the guideline's text and not
 * ours.
 */
function questionId(candidates: Candidate[]): string {
  const keys = [...new Set(candidates.map((c) => c.key))].sort().join('+')
  const labels = candidates
    .map((c) => c.branch.label.replace(/\*\*/g, '').trim().toLowerCase())
    .join('|')
  return `scope:${keys}:${fnv1a(labels)}`
}

/* -------------------------------------------------------------------------- */
/* The question                                                               */
/* -------------------------------------------------------------------------- */

export const deriveScopeQuestions: Deriver<ScopeQuestion> = ({ tree }: FlowInput) => {
  const byId = new Map<string, TreeNode>(tree.nodes.map((n) => [n.id, n]))
  const candidates = liveGroups(tree, byId)
  if (candidates.length === 0) return []

  // A decision is only a CHOICE if two or more of its groups are still live.
  const byDecision = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const list = byDecision.get(c.key)
    if (list) list.push(c)
    else byDecision.set(c.key, [c])
  }
  const choices = [...byDecision.values()].filter((list) => list.length >= 2).flat()

  if (choices.length >= 2) {
    return [
      {
        kind: 'scope',
        id: questionId(choices),
        question: 'Which of these does your clinic handle?',
        guidelineLine: `The guideline covers ${countWord(choices.length)} kinds of referral.`,
        stakesLine:
          'Anything you uncheck will be sent to a person to review instead of being routed automatically.',
        mode: 'choices',
        groups: choices.map((c) => toGroup(c, byId)),
        covers: coversSentence(choices),
      },
    ]
  }

  // Fewer than two real choices: the guideline already narrows to one
  // population. A one-item checklist would be a question with one answer, so
  // ask the only thing left worth asking — is that population right for you?
  const covers = coversSentence(candidates)
  if (!covers || !isPlain(covers)) return []

  return [
    {
      kind: 'scope',
      id: questionId(candidates),
      question: `This starting point only covers ${covers}. Is that right for your clinic?`,
      guidelineLine: 'Anything outside that already goes to a person to review rather than being routed automatically.',
      stakesLine: "Nothing is turned away — it just doesn't get routed automatically.",
      mode: 'confirm',
      groups: [],
      covers,
    },
  ]
}
