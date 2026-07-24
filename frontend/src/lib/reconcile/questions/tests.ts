import type { SpecialistNode, Tree } from '../../../types/tree'
import type { DeltaDraft } from '../../deltas/api'
import { anchorForNode, fnv1a, normalizeKey } from '../../deltas/resolve'
import type { NodeAnchor } from '../../deltas/schema'
import { countWord, headline, isVerbose, joinPhrases, spokenCase, tidyLabel } from '../plainLabel'
import type { Deriver, FlowInput, RosterEntry, StepQuestion } from '../types'

/**
 * Blume — "Tests before the visit".
 *
 * A generated guideline almost never carries pre-visit tests: in the trees we
 * see, every destination arrives with an empty list. The old screen answered
 * that with six cards reading "No pre-visit tests yet." and a "+ Add test"
 * button — a blank canvas handed to a surgeon who came here to confirm things,
 * not to author them.
 *
 * So this section never shows an empty list. Where the guideline named tests,
 * it lists them. Where it named none, it proposes the standard ones for that
 * kind of patient from the small table below and says plainly that the
 * proposal is OURS. A suggestion only becomes real if the surgeon keeps it —
 * that keep is what writes `add_workup`. Keeping something the guideline
 * already asked for writes nothing, because it is already true.
 *
 * The table is deliberately small, deliberately dumb, and deliberately
 * editable: keywords in the destination's specialty and its plain headline,
 * first rule wins. It is a starting point for a conversation, not a claim to
 * clinical authority — which is exactly how the screen labels it.
 */

/* -------------------------------------------------------------------------- */
/* The question                                                               */
/* -------------------------------------------------------------------------- */

/** One test on the list, with the one line that says why it's there. */
export interface TestRow {
  name: string
  protocol?: string
  /** Never blank — a row with no reason is a row nobody can judge. */
  reason: string
  /** 'guideline' = the guideline asked for it. 'suggested' = we did. */
  source: 'guideline' | 'suggested'
}

export interface TestsQuestion extends StepQuestion {
  kind: 'tests'
  /** "Patients going to Dr. Reyes for suspected internal derangement" */
  groupLine: string
  /** Who the patient sees. Used in the closing sentences. */
  destination: string
  /** The guideline's own wording, for the destinations too long to show raw. */
  fullText: string[]
  items: TestRow[]
  /** True when every row on the list is ours rather than the guideline's. */
  suggested: boolean
  /** One per destination folded into this group — every delta is written to all. */
  anchors: NodeAnchor[]
}

const QUESTION = 'What do you want done before this patient walks in?'
const STAKES =
  'Ordering these ahead of time is what stops the first visit ending in "come back when you\'ve had the test."'
const NO_GUIDELINE_TESTS = "The guideline didn't say what to order first."

/* -------------------------------------------------------------------------- */
/* The suggestion table                                                       */
/* -------------------------------------------------------------------------- */

interface SuggestionRule {
  /** Lowercase substrings, matched against "<specialty> <headline>". */
  keywords: string[]
  tests: Array<{ name: string; protocol?: string; reason: string }>
}

/**
 * Ordered; the FIRST rule with a keyword in the destination's text wins.
 * Order is the whole design: "keep managing this conservatively" has to be
 * read before "…surgery" in the same sentence, or a patient who is explicitly
 * NOT being referred gets sent for imaging.
 */
const SUGGESTION_RULES: SuggestionRule[] = [
  {
    // Destinations whose action is to keep the patient where they are.
    keywords: [
      'continue conservative',
      'continue or initiate conservative',
      'physical medicine',
      'physical therapy',
      'physiotherapy',
    ],
    tests: [],
  },
  {
    // Knee / joint work-up.
    keywords: ['derangement', 'mechanical', 'meniscus', 'knee', 'ortho', 'osteoarthritis'],
    tests: [
      {
        name: 'Weight-bearing plain films of both knees',
        protocol: 'Standing AP, lateral and skyline views',
        reason: 'Standing views are what show true joint space loss; films taken lying down under-read it.',
      },
    ],
  },
  {
    // Nerve work-up.
    keywords: ['nerve', 'neuropath', 'radicul', 'carpal', 'ulnar', 'emg'],
    tests: [
      {
        name: 'Nerve conduction study',
        reason: 'Shows where the nerve is actually pinched before anyone discusses releasing it.',
      },
      {
        name: 'EMG',
        reason: 'Separates a nerve problem from a muscle one, and shows how long it has been going on.',
      },
    ],
  },
]

/** What we'd propose for this destination. Empty is a real answer. */
export function suggestFor(specialty: string, plainName: string): TestRow[] {
  const text = `${specialty} ${plainName}`.toLowerCase()
  for (const rule of SUGGESTION_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) {
      return rule.tests.map((t) => ({ ...t, source: 'suggested' as const }))
    }
  }
  return []
}

/* -------------------------------------------------------------------------- */
/* Sentences                                                                  */
/* -------------------------------------------------------------------------- */

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Nerve conduction study and EMG are ordered before visits to Dr. Reyes." */
export function orderedSummary(destination: string, names: string[]): string {
  const list = joinPhrases(names)
  // One test can still be a plural thing ("films of both knees"), and a
  // sentence that reads wrong is a sentence a surgeon stops trusting.
  const many = names.length > 1 || /s$/i.test(names[names.length - 1]?.trim() ?? '')
  return `${sentenceCase(list)} ${many ? 'are' : 'is'} ordered before visits to ${destination}.`
}

/** "Kept the two tests the guideline asks for." */
export function keptSummary(n: number): string {
  return `Kept the ${countWord(n)} test${n === 1 ? '' : 's'} the guideline asks for.`
}

/** "Nothing is ordered before visits to Dr. Osei." */
export function nothingSummary(destination: string): string {
  return `Nothing is ordered before visits to ${destination}.`
}

/* -------------------------------------------------------------------------- */
/* Deriving the questions                                                     */
/* -------------------------------------------------------------------------- */

/** Destinations a patient can actually arrive at. The rest aren't asked about. */
function reachableTerminals(tree: Tree): SpecialistNode[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const stack: string[] = [tree.rootNodeId]
  while (stack.length > 0) {
    const id = stack.pop()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (node?.type === 'variable') for (const b of node.branches) stack.push(b.nextNodeId)
  }
  return tree.nodes.filter((n): n is SpecialistNode => n.type === 'specialist' && seen.has(n.id))
}

/**
 * Stable across a guideline re-upload: the verbatim CPG text plus the
 * destination's name. Node ids are regenerated every upload and are never used
 * for anything a surgeon's progress depends on.
 *
 * BOTH halves are needed. One guideline sentence routinely produces two
 * destinations ("…refer" and "…keep managing conservatively" off the same
 * recommendation), so the CPG text alone collides and two different screens
 * end up sharing one answer.
 */
function stableKey(node: SpecialistNode): string {
  const tidy = (s: string) => normalizeKey(s).replace(/\s+/g, ' ')
  return `${tidy(node.specialistName)}||${tidy(node.clinicalBasis ?? '')}`
}

const TITLED = /^(dr|prof|mr|ms|mrs)\b\.?/i

/**
 * Words that belong to the software, never to a surgeon. Guideline text is
 * quoted verbatim elsewhere; anything we WRITE goes through this.
 */
const INTERNAL_WORDS =
  /\b(node|endpoint|tree|delta|reconcile|threshold|variable|condition|mapping|band|publish|scope|branch|anchor|workup)s?\b/i

/**
 * Who the patient actually sees. A destination bound to someone on the roster
 * is named; an unbound one is still a guideline sentence, so we say the
 * specialty instead of reading a paragraph back at the surgeon.
 */
function destinationFor(node: SpecialistNode, rosterNames: Set<string>): { destination: string; bound: boolean } {
  const name = node.specialistName.trim()
  if (rosterNames.has(name.toLowerCase()) || TITLED.test(name)) return { destination: name, bound: true }
  return { destination: node.specialty?.trim() || headline(name) || 'this clinic', bound: false }
}

/**
 * Why this group of patients is going there. Once a destination is bound its
 * name is the specialist's, so the clinical reason has to come from the
 * guideline text behind it — filtered, because that text sometimes carries
 * the extractor's own vocabulary.
 */
function reasonPhrase(node: SpecialistNode, bound: boolean): string {
  const source = bound && node.clinicalBasis?.trim() ? node.clinicalBasis : node.specialistName
  const stripped = source.replace(/^[A-Za-z ]{1,20}:\s*/, '').replace(/[“”"']/g, '')
  const phrase = spokenCase(tidyLabel(headline(stripped)))
  return INTERNAL_WORDS.test(phrase) ? '' : phrase
}

/** The tests the guideline itself put on this destination. */
function guidelineItems(node: SpecialistNode): TestRow[] {
  const rows: TestRow[] = []
  for (const item of node.workup.always) {
    rows.push({
      name: item.name,
      ...(item.protocol ? { protocol: item.protocol } : {}),
      reason: item.rationale?.trim() || 'The guideline asks for this before the visit.',
      source: 'guideline',
    })
  }
  for (const c of node.workup.conditional) {
    rows.push({
      name: c.item.name,
      ...(c.item.protocol ? { protocol: c.item.protocol } : {}),
      reason: c.reason?.trim() || c.item.rationale?.trim() || 'The guideline asks for this before the visit.',
      source: 'guideline',
    })
  }
  return rows
}

interface Group {
  destination: string
  whats: string[]
  fullText: string[]
  items: TestRow[]
  suggested: boolean
  anchors: NodeAnchor[]
  keys: string[]
}

export const deriveTestQuestions: Deriver<TestsQuestion> = (input: FlowInput) => {
  const rosterNames = new Set(
    (input.roster ?? []).map((r: RosterEntry) => r.name.trim().toLowerCase()).filter(Boolean),
  )

  const groups = new Map<string, Group>()

  for (const node of reachableTerminals(input.tree)) {
    const { destination, bound } = destinationFor(node, rosterNames)
    const plain = headline(node.specialistName)
    const fromGuideline = guidelineItems(node)
    const items = fromGuideline.length > 0 ? fromGuideline : suggestFor(node.specialty ?? '', plain)
    const suggested = fromGuideline.length === 0

    // Merge only when a surgeon would give the same answer twice: same person
    // to see, same list to order.
    const signature = `${destination.toLowerCase()}||${items
      .map((i) => i.name.toLowerCase())
      .sort()
      .join(',')}||${suggested ? 's' : 'g'}`

    const what = reasonPhrase(node, bound)
    const existing = groups.get(signature)
    if (existing) {
      if (what && !existing.whats.includes(what)) existing.whats.push(what)
      if (isVerbose(node.specialistName)) existing.fullText.push(node.specialistName)
      existing.anchors.push(anchorForNode(node))
      existing.keys.push(stableKey(node))
      continue
    }
    groups.set(signature, {
      destination,
      whats: what ? [what] : [],
      fullText: isVerbose(node.specialistName) ? [node.specialistName] : [],
      items,
      suggested,
      anchors: [anchorForNode(node)],
      keys: [stableKey(node)],
    })
  }

  return [...groups.values()].map((g) => {
    const whats = g.whats.filter((w) => w.toLowerCase() !== g.destination.toLowerCase())
    const where = spokenCase(g.destination.replace(/\s*\/\s*/g, ' or '))
    const groupLine =
      whats.length > 0
        ? `Patients going to ${where} for ${joinPhrases(whats)}`
        : `Patients going to ${where}`
    const n = g.suggested ? 0 : g.items.length
    return {
      id: `tests:${fnv1a([...g.keys].sort().join('|'))}`,
      kind: 'tests' as const,
      question: QUESTION,
      guidelineLine:
        n > 0 ? `The guideline asks for ${countWord(n)} thing${n === 1 ? '' : 's'} first.` : NO_GUIDELINE_TESTS,
      stakesLine: STAKES,
      groupLine,
      destination: g.destination,
      fullText: g.fullText,
      items: g.items,
      suggested: g.suggested,
      anchors: g.anchors,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Turning the screen's answer into deltas                                    */
/* -------------------------------------------------------------------------- */

export interface TestDecision extends TestRow {
  /** On the list when they're done. */
  kept: boolean
  /** Kept, but this clinic can't actually get it — a note, never a delta. */
  unavailable?: boolean
}

export interface TestsOutcome {
  drafts: DeltaDraft[]
  summary: string
  note?: string
  /**
   * 'change' writes the deltas. 'flag' records a note and writes nothing.
   * 'accept' keeps the guideline exactly as it stands and writes nothing —
   * which is what "keep the tests the guideline already asks for" means.
   */
  action: 'accept' | 'change' | 'flag'
}

/**
 * The single place a screen's answer becomes deltas. Every change on the
 * screen lands in ONE batch, so a surgeon's decision about a group of patients
 * is one entry in the record rather than six.
 */
export function resolveTests(question: TestsQuestion, decisions: TestDecision[]): TestsOutcome {
  const drafts: DeltaDraft[] = []

  for (const d of decisions) {
    if (d.kept && d.source === 'suggested') {
      for (const anchor of question.anchors) {
        drafts.push({
          payload: {
            op: 'add_workup',
            anchor,
            item: {
              name: d.name,
              ...(d.protocol ? { protocol: d.protocol } : {}),
              ...(d.reason ? { rationale: d.reason } : {}),
            },
          },
        })
      }
    }
    if (!d.kept && d.source === 'guideline') {
      for (const anchor of question.anchors) {
        drafts.push({ payload: { op: 'remove_workup', anchor, itemName: d.name } })
      }
    }
  }

  const kept = decisions.filter((d) => d.kept)
  const unavailable = kept.filter((d) => d.unavailable).map((d) => d.name)
  const note =
    unavailable.length > 0
      ? `Can't get ${joinPhrases(unavailable)} here — kept on the list and flagged.`
      : undefined

  const summary =
    kept.length === 0
      ? nothingSummary(question.destination)
      : drafts.length === 0
        ? keptSummary(kept.length)
        : orderedSummary(question.destination, kept.map((d) => d.name))

  const action: TestsOutcome['action'] = drafts.length > 0 ? 'change' : note ? 'flag' : 'accept'
  return { drafts, summary, ...(note ? { note } : {}), action }
}
