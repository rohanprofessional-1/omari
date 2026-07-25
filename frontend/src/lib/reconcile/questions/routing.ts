import type { SpecialistNode, Urgency } from '../../../types/tree'
import type { DeltaDraft } from '../../deltas/api'
import { anchorForNode, fnv1a, normalizeKey } from '../../deltas/resolve'
import type { NodeAnchor } from '../../deltas/schema'
import { countWord, headline, isVerbose, spokenCase } from '../plainLabel'
import type { Deriver, FlowInput, RosterEntry, StepQuestion } from '../types'

/**
 * Blume — "Who sees what": the questions that decide which surgeon a referral
 * actually lands on. The most consequential section of the setup.
 *
 * Three things shape it:
 *
 *   1. A guideline names its destinations in whole sentences ("Referral for
 *      evaluation of suspected internal derangement (mechanical symptoms…)").
 *      Nobody can scan fifteen of those, so each one is shown as a `headline`
 *      with the guideline's own wording one click away. Stored data is never
 *      rewritten — only rendered shorter.
 *   2. A surgeon should see a handful of decisions, not a table. Destinations
 *      are grouped by the area of care the guideline sends them to, and a
 *      screen never carries more than six.
 *   3. Nothing is ever blank and nothing is ever guessed without grounds. A
 *      picker pre-fills only where the guideline's area of care demonstrably
 *      matches someone on the roster; everywhere else it says "No one
 *      assigned", which is a safe answer, not a missing one.
 *
 * The section writes exactly the two changes the old bulk table wrote —
 * `set_urgency` then `bind_terminal` — in that order, because urgency is
 * matched on the destination's identity BEFORE it is bound, which is still
 * unique. After binding, several destinations can carry the same person's
 * name.
 */

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

/** Every fixed string this section shows. Kept in one place so the language
 *  can be reviewed as language. */
export const ROUTING_COPY = {
  question: 'Who in your clinic should see each of these patients?',
  stakes: 'This is what decides which surgeon a referral lands on.',
  fastStakes:
    'This is what decides which surgeon a referral lands on. You can make exceptions on the next screen.',
  noOne: 'No one assigned',
  noOneNote: 'No one assigned — these will go to a person to review.',
  sendToPerson: 'No one here treats these — send to a person',
  save: '✓ Save and continue',
  oneAtATime: "I'll assign them one at a time →",
  showWording: "See the guideline's wording",
  hideWording: 'Hide the wording',
  whoLabel: 'Who sees these patients',
  howSoonLabel: 'How soon',
  fromGuideline: 'The guideline says:',
  answeredAlready: 'You answered this one already — saving again replaces that answer.',
  keptEverything: 'Kept the guideline for all of these.',
} as const

/** Urgency as a surgeon says it. `expedited` is stored vocabulary and is never
 *  shown; "sooner than routine" is. */
export const URGENCY_CHOICES: ReadonlyArray<{ value: Urgency; label: string }> = [
  { value: 'routine', label: 'Routine' },
  { value: 'expedited', label: 'Sooner than routine' },
  { value: 'urgent', label: 'Urgent' },
]

/** Picker value meaning "nobody here does this — a person should look at it". */
export const SEND_TO_PERSON = '__send_to_person__'

/** Stored reason on the destination that gets handed to a human. */
export const PERSON_REVIEW_REASON =
  'No one in this clinic treats these patients — a person reviews the referral.'

/** A screen never asks for more decisions than a person can hold at once. */
const MAX_PER_SCREEN = 6

/* -------------------------------------------------------------------------- */
/* Destinations                                                               */
/* -------------------------------------------------------------------------- */

/** One place the guideline sends patients, ready to render and to anchor. */
export interface RoutingDestination {
  /** The destination exactly as the guideline wrote it. Never modified. */
  node: SpecialistNode
  /** Short primary text — `headline` of the stored label. */
  title: string
  /** The stored label in full, when it says more than the headline does. */
  fullText: string
  /** The verbatim guideline sentence this destination came from. */
  clinicalBasis: string
  /** The area of care the guideline sends these patients to. */
  area: string
  urgency: Urgency
  /** The guideline never named anyone for this one. */
  unassigned: boolean
  /** Roster id we can defensibly pre-fill, or '' for "No one assigned". */
  suggestedId: string
  /** Identity material that survives a guideline re-upload. */
  key: string
  /** Another destination carries byte-identical guideline wording. */
  sharedWording: boolean
}

export interface RoutingQuestion extends StepQuestion {
  kind: 'routing'
  /** 'all' is the one-surgeon shortcut; 'assign' is a screen of destinations. */
  mode: 'all' | 'assign'
  destinations: RoutingDestination[]
  roster: RosterEntry[]
  /** 'all' only: the person everything would go to. */
  candidate?: RosterEntry
}

/** What a surgeon has decided for one destination on the current screen. */
export interface RoutingAssignment {
  destination: RoutingDestination
  /** A roster id, `SEND_TO_PERSON`, or '' for "No one assigned". */
  specialistId: string
  urgency: Urgency
}

const PLACEHOLDER = /^\[Assign specialist\s*[—–-]\s*(.*)\]$/

function isPlaceholder(node: SpecialistNode): boolean {
  return node.specialistName.startsWith('[Assign')
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Identity that survives regeneration: the verbatim CPG sentence when there
 *  is one, else the stored label. Never a node id — those are reissued on
 *  every upload. */
function identityOf(node: SpecialistNode): string {
  return normalizeKey(squash(node.clinicalBasis?.trim() || node.specialistName))
}

/* ---- matching an area of care to the roster ------------------------------ */

/** Words that appear in half the specialties on earth and so distinguish
 *  nothing. A shared "surgery" is not evidence that two people do the same
 *  work. */
const GENERIC_AREA_WORDS = new Set([
  'and', 'the', 'for', 'with', 'sub', 'general', 'adult', 'clinic', 'clinics', 'care',
  'medicine', 'medical', 'surgery', 'surgical', 'surgeon', 'service', 'services',
  'specialist', 'specialists', 'department', 'referral', 'referrals', 'assign',
])

/** Fold spelling variants (orthopaedic/orthopedics/orthopedic) onto one stem. */
function stemWord(word: string): string {
  let out = word.replace(/ae/g, 'e').replace(/oe/g, 'e')
  out = out.replace(/s$/, '')
  out = out.replace(/(ic|al)$/, '')
  return out
}

/** The distinguishing words in a free-text area of care. */
function areaWords(text: string | null | undefined): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !GENERIC_AREA_WORDS.has(w))
    .map(stemWord)
    .filter((w) => w.length > 2)
}

/**
 * The one person on the roster whose own area demonstrably covers this
 * destination — or '' when there is no such person, or more than one and no
 * reason to prefer either. A tie is not a guess we are entitled to make.
 */
export function bestGuess(area: string, roster: RosterEntry[]): string {
  const want = new Set(areaWords(area))
  if (want.size === 0) return ''
  let bestScore = 0
  let bestId = ''
  let tied = false
  for (const person of roster) {
    const score = areaWords(person.specialty).filter((w) => want.has(w)).length
    if (score === 0) continue
    if (score > bestScore) {
      bestScore = score
      bestId = person.id
      tied = false
    } else if (score === bestScore) {
      tied = true
    }
  }
  return tied ? '' : bestId
}

function describeDestination(
  node: SpecialistNode,
  roster: RosterEntry[],
  sharedWording: boolean,
): RoutingDestination {
  const placeholder = isPlaceholder(node)
  const area = squash(node.specialty) || 'your clinic'
  const label = placeholder ? (PLACEHOLDER.exec(node.specialistName)?.[1] ?? area) : node.specialistName

  // Already handled by someone on the roster (an earlier answer, or a previous
  // session) — that is the only pre-fill stronger than an area match.
  const bound = roster.find((r) => squash(r.name).toLowerCase() === squash(node.specialistName).toLowerCase())

  return {
    node,
    title: headline(label) || squash(label),
    fullText: placeholder || !isVerbose(node.specialistName) ? '' : squash(node.specialistName),
    clinicalBasis: squash(node.clinicalBasis ?? ''),
    area,
    urgency: node.urgency,
    unassigned: placeholder,
    suggestedId: bound ? bound.id : bestGuess(area, roster),
    key: identityOf(node),
    sharedWording,
  }
}

/** Every place this guideline sends a patient, in the order it names them. */
export function routingDestinations(input: FlowInput): RoutingDestination[] {
  const terminals = input.tree.nodes.filter((n): n is SpecialistNode => n.type === 'specialist')
  const wordingCounts = new Map<string, number>()
  for (const t of terminals) {
    const basis = squash(t.clinicalBasis ?? '')
    if (basis) wordingCounts.set(basis, (wordingCounts.get(basis) ?? 0) + 1)
  }
  return terminals.map((t) =>
    describeDestination(t, input.roster, (wordingCounts.get(squash(t.clinicalBasis ?? '')) ?? 0) > 1),
  )
}

/* -------------------------------------------------------------------------- */
/* Screens                                                                    */
/* -------------------------------------------------------------------------- */

/** Destinations grouped by area of care, then packed so no screen carries
 *  more than `MAX_PER_SCREEN` decisions. */
function screensOf(destinations: RoutingDestination[]): RoutingDestination[][] {
  const byArea = new Map<string, RoutingDestination[]>()
  for (const d of destinations) {
    const list = byArea.get(d.area)
    if (list) list.push(d)
    else byArea.set(d.area, [d])
  }
  // The ones nobody is named for come first — they are the ones that decide
  // whether a referral has anywhere to land at all.
  const groups = [...byArea.entries()]
    .sort((a, b) => {
      const aOpen = a[1].some((d) => d.unassigned) ? 0 : 1
      const bOpen = b[1].some((d) => d.unassigned) ? 0 : 1
      return aOpen - bOpen || a[0].localeCompare(b[0])
    })
    .map(([, list]) => list)

  const screens: RoutingDestination[][] = []
  let current: RoutingDestination[] = []
  for (const group of groups) {
    if (group.length > MAX_PER_SCREEN) {
      if (current.length > 0) {
        screens.push(current)
        current = []
      }
      for (let i = 0; i < group.length; i += MAX_PER_SCREEN) {
        screens.push(group.slice(i, i + MAX_PER_SCREEN))
      }
      continue
    }
    if (current.length + group.length > MAX_PER_SCREEN) {
      screens.push(current)
      current = []
    }
    current = [...current, ...group]
  }
  if (current.length > 0) screens.push(current)
  return screens
}

/** An area of care as it reads inside a sentence. */
function spokenArea(area: string): string {
  return spokenCase(area.replace(/\s*\/\s*/g, ' or '))
}

/** The first-named area, so "Orthopedic Surgery / Primary Care" and
 *  "Orthopedic Surgery" don't read as two different places. */
function primaryArea(area: string): string {
  return spokenArea(area.split(/\s*\/\s*/)[0] ?? area)
}

function joinAreas(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? 'your clinic'
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** What the guideline proposed for this screen, in one sentence. */
export function guidelineLineFor(destinations: RoutingDestination[]): string {
  const areas = [...new Set(destinations.map((d) => d.area))]
  const where =
    areas.length === 1
      ? spokenArea(areas[0])
      : joinAreas([...new Set(areas.map(primaryArea))].slice(0, 3))
  const n = destinations.length
  if (destinations.every((d) => d.unassigned)) {
    return n === 1
      ? `The guideline asks for ${where} but doesn't name anyone.`
      : `The guideline asks for ${where} ${countWord(n)} times but doesn't name anyone.`
  }
  if (n === 1) return `The guideline sends this one to ${where}.`
  return `The guideline sends these ${countWord(n)} to ${where}.`
}

function idFor(mode: 'all' | 'assign', destinations: RoutingDestination[]): string {
  return `routing:${mode}:${fnv1a(destinations.map((d) => d.key).join('|'))}`
}

/* -------------------------------------------------------------------------- */
/* The questions                                                              */
/* -------------------------------------------------------------------------- */

/** With one or two people on the roster, "everything goes to me" is the true
 *  answer most of the time, and asking it first turns fifteen decisions into
 *  one click plus exceptions. */
function fastPathQuestion(
  destinations: RoutingDestination[],
  roster: RosterEntry[],
): RoutingQuestion | null {
  if (roster.length === 0 || roster.length > 2 || destinations.length < 2) return null
  const tally = new Map<string, number>()
  for (const d of destinations) {
    if (d.suggestedId) tally.set(d.suggestedId, (tally.get(d.suggestedId) ?? 0) + 1)
  }
  const candidate =
    roster.slice().sort((a, b) => (tally.get(b.id) ?? 0) - (tally.get(a.id) ?? 0))[0] ?? roster[0]
  return {
    id: idFor('all', destinations),
    kind: 'routing',
    mode: 'all',
    question: `Should all ${countWord(destinations.length)} kinds of referral go to ${candidate.name}?`,
    guidelineLine:
      roster.length === 1 ? 'You have one surgeon on file.' : 'You have two surgeons on file.',
    stakesLine: ROUTING_COPY.fastStakes,
    destinations,
    roster,
    candidate,
  }
}

export const deriveRoutingQuestions: Deriver<RoutingQuestion> = (input: FlowInput) => {
  const destinations = routingDestinations(input)
  if (destinations.length === 0) return []

  const questions: RoutingQuestion[] = []
  const fast = fastPathQuestion(destinations, input.roster)
  if (fast) questions.push(fast)

  for (const screen of screensOf(destinations)) {
    questions.push({
      id: idFor('assign', screen),
      kind: 'routing',
      mode: 'assign',
      question: ROUTING_COPY.question,
      guidelineLine: guidelineLineFor(screen),
      stakesLine: ROUTING_COPY.stakes,
      destinations: screen,
      roster: input.roster,
    })
  }
  return questions
}

/* -------------------------------------------------------------------------- */
/* What gets written                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The strongest anchor for a destination.
 *
 * `anchorForNode` prefers a hash of the verbatim CPG text, which is the right
 * default — it survives a re-upload. But a real guideline can attach the SAME
 * sentence to two different destinations (the knee CPG does), and then that
 * hash matches two nodes and the change is reported ambiguous rather than
 * applied. Where the wording is shared, we fall back to the stored label,
 * which is still unique at the moment we write — and stays unique through the
 * batch, because bindings apply in order and every later anchor resolves
 * against the tree as the earlier ones left it.
 */
export function anchorForDestination(destination: RoutingDestination): NodeAnchor {
  const anchor = anchorForNode(destination.node)
  if (destination.sharedWording && anchor.kind === 'terminal' && anchor.specialistName) {
    const { clinicalBasisHash: _unused, ...rest } = anchor
    return rest
  }
  return anchor
}

function provenanceFor(destination: RoutingDestination): DeltaDraft['provenance'] {
  return destination.clinicalBasis ? { cpgBasis: destination.clinicalBasis } : {}
}

/**
 * Everything the surgeon decided on one screen, as one batch.
 *
 * ORDER IS LOAD-BEARING: every urgency change is emitted before any binding,
 * so it is matched against the destination's pre-binding identity. Bind first
 * and two destinations can share a name, and the urgency change no longer
 * knows which one it meant.
 */
export function assignmentDrafts(
  assignments: RoutingAssignment[],
  roster: RosterEntry[],
): DeltaDraft[] {
  const urgencies: DeltaDraft[] = []
  const bindings: DeltaDraft[] = []

  for (const a of assignments) {
    const d = a.destination
    const toPerson = a.specialistId === SEND_TO_PERSON
    const person = toPerson ? undefined : roster.find((r) => r.id === a.specialistId)

    if (!toPerson && a.urgency !== d.urgency) {
      urgencies.push({
        payload: { op: 'set_urgency', anchors: [anchorForDestination(d)], urgency: a.urgency },
        provenance: provenanceFor(d),
      })
    }

    if (toPerson) {
      bindings.push({
        payload: {
          op: 'bind_terminal',
          anchors: [anchorForDestination(d)],
          target: { kind: 'escalation', reason: PERSON_REVIEW_REASON },
        },
        provenance: provenanceFor(d),
      })
      continue
    }

    if (person && squash(person.name) !== squash(d.node.specialistName)) {
      bindings.push({
        payload: {
          op: 'bind_terminal',
          anchors: [anchorForDestination(d)],
          target: {
            kind: 'specialist',
            specialistId: person.id,
            specialistName: person.name,
            // The guideline's own area of care, NOT the person's. Who does the
            // work changes; what kind of work it is does not, and the screens
            // are grouped by it.
            specialty: d.area,
          },
        },
        specialistId: person.id,
        provenance: provenanceFor(d),
      })
    }
  }

  return [...urgencies, ...bindings]
}

/** The one-click shortcut: everything on file goes to one person. */
export function bindAllDrafts(
  destinations: RoutingDestination[],
  person: RosterEntry,
): DeltaDraft[] {
  const targets = destinations.filter((d) => squash(d.node.specialistName) !== squash(person.name))
  if (targets.length === 0) return []
  return targets.map((d) => ({
    payload: {
      op: 'bind_terminal',
      anchors: [anchorForDestination(d)],
      target: {
        kind: 'specialist',
        specialistId: person.id,
        specialistName: person.name,
        specialty: d.area,
      },
    },
    specialistId: person.id,
    provenance: provenanceFor(d),
  }))
}

/* -------------------------------------------------------------------------- */
/* Summaries                                                                  */
/* -------------------------------------------------------------------------- */

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Dr. Reyes sees 4 of these. Dr. Osei sees 1. One has no one assigned and
 *  will go to a person to review." */
export function assignmentSummary(assignments: RoutingAssignment[], roster: RosterEntry[]): string {
  const counts = new Map<string, number>()
  let toPerson = 0
  let none = 0
  for (const a of assignments) {
    if (a.specialistId === SEND_TO_PERSON) toPerson += 1
    else if (!a.specialistId) none += 1
    else counts.set(a.specialistId, (counts.get(a.specialistId) ?? 0) + 1)
  }

  const parts: string[] = []
  ;[...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([id, n], i) => {
      const name = roster.find((r) => r.id === id)?.name ?? 'Your clinic'
      parts.push(i === 0 ? `${name} sees ${n} of these.` : `${name} sees ${n}.`)
    })
  if (none > 0) {
    parts.push(
      `${cap(countWord(none))} ${none === 1 ? 'has' : 'have'} no one assigned and will go to a person to review.`,
    )
  }
  if (toPerson > 0) {
    parts.push(`${cap(countWord(toPerson))} ${toPerson === 1 ? 'goes' : 'go'} to a person to review.`)
  }
  for (const choice of URGENCY_CHOICES) {
    if (choice.value === 'routine') continue
    const n = assignments.filter((a) => a.urgency === choice.value).length
    if (n > 0) parts.push(`${cap(countWord(n))} ${n === 1 ? 'is' : 'are'} ${choice.label.toLowerCase()}.`)
  }
  return parts.length > 0 ? parts.join(' ') : ROUTING_COPY.keptEverything
}

/** "All seven kinds of referral go to Dr. Reyes." */
export function bindAllSummary(destinations: RoutingDestination[], person: RosterEntry): string {
  return `All ${countWord(destinations.length)} kinds of referral go to ${person.name}.`
}

/** What we record when a surgeon would rather take them one at a time. */
export function oneAtATimeSummary(): string {
  return 'Assigning each kind of referral one at a time.'
}
