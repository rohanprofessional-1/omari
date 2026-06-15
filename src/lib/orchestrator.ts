import { evaluateCondition, runEngine } from './engine'
import {
  classifyEscalation,
  isAmbiguousValue,
  type EscalationAnalysis,
} from './escalation'
// Default extractor is the DEMO_MODE-aware provider: real Claude call when off,
// scripted offline extraction when on — identical shape either way.
import { extractVariablesAuto as defaultExtract } from './extractionProvider'
import type {
  FilledVariables,
  Node as TreeNode,
  SpecialistNode,
  Tree,
  VariableNode,
  VariableSpec,
} from '../types/tree'

/**
 * Blume — conversation orchestration.
 *
 * ⚠️ HARD RULE (everything in this file): the deterministic ENGINE decides where
 * a patient routes; the LLM ONLY extracts variable VALUES (with a confidence)
 * and phrases questions. The LLM is never given the tree and is never asked
 * "what should I ask next." The questions come from the engine's tree-walk
 * reporting the ONE missing variable on the patient's path — never from the LLM.
 *
 * This file has two layers:
 *  1. The pure step core (`nextStep`, `confidenceBand`) + the synchronous,
 *     callback-driven `runOrchestrator`, plus a SIMULATED keyword extractor
 *     (`extractVariables`) used for deterministic tests/Demo mode.
 *  2. The resumable, async, engine-driven state machine
 *     (`startConversation` / `advance` / `submitAnswer`) intended to drive a UI
 *     turn by turn, using a pluggable `Extractor` (defaulting to the real
 *     Claude-backed call in extract.ts). See the §state-machine block below.
 */

export type AnswerValue = string | number | boolean

export interface Extraction {
  value: AnswerValue
  confidence: number
}

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'absent'

export interface AskRequest {
  key: string
  question: string
  spec?: VariableSpec
  reason: 'missing' | 'rejected'
}

export interface ConfirmRequest {
  key: string
  value: AnswerValue
  question: string
  spec?: VariableSpec
}

export type OrchestratorEvent =
  | { type: 'extract'; values: Record<string, Extraction> }
  | { type: 'commit'; key: string; value: AnswerValue; confidence: number; via: 'extraction' | 'answer' | 'confirmation' }
  | { type: 'ask'; key: string; question: string; reason: AskRequest['reason'] }
  | { type: 'answer'; key: string; value: AnswerValue }
  | { type: 'confirm'; key: string; value: AnswerValue; accepted: boolean }
  | { type: 'routed'; specialist: string }
  | { type: 'escalated'; reason?: string }
  | { type: 'guard'; iterations: number }

export interface OrchestratorOptions {
  tree: Tree
  specs: Record<string, VariableSpec>
  /** Initial free-text (e.g. referral / patient message) to seed extraction. */
  initialText?: string
  /** Simulated extractor; defaults to the keyword-based `extractVariables`. */
  extract?: (text: string, specs: Record<string, VariableSpec>) => Record<string, Extraction>
  /** Driver: answer a fresh question (returns the resolved value). */
  ask: (req: AskRequest) => AnswerValue
  /** Driver: confirm a medium-confidence value (returns true if confirmed). */
  confirm: (req: ConfirmRequest) => boolean
  thresholds?: { high?: number; medium?: number }
  maxIterations?: number
  log?: (event: OrchestratorEvent) => void
}

export interface OrchestratorResult {
  outcome: 'routed' | 'escalated' | 'guard_exceeded'
  specialist?: SpecialistNode
  escalationReason?: string
  filled: FilledVariables
  pathTaken: string[]
  questionsAsked: number
  confirmations: number
  iterations: number
  /** True when routed and every path variable was high-confidence/confirmed. */
  pathVariablesConfident: boolean
}

/** Friendly label for a value at a variable node (its matching branch label). */
function friendlyAnswer(node: TreeNode | undefined, value: AnswerValue): string {
  if (node?.type === 'variable') {
    const branch = node.branches.find((b) => evaluateCondition(b.condition, value))
    if (branch) return `“${branch.label}”`
  }
  return `“${String(value)}”`
}

/** Classify a confidence score into a band. */
export function confidenceBand(
  confidence: number,
  high = 0.8,
  medium = 0.5,
): 'high' | 'medium' | 'low' {
  return confidence >= high ? 'high' : confidence >= medium ? 'medium' : 'low'
}

/**
 * The pure, step-wise core of the loop: given the current state, decide the
 * single next action. Shared by `runOrchestrator` (synchronous) and the Runner
 * UI (which pauses for user input between steps).
 */
/**
 * Why an 'ask' is being asked:
 *  - 'intake'  → a core-intake variable (the standard set asked before ANY outcome).
 *  - 'clarify' → a re-ask of an ambiguous/low-confidence core value.
 */
export type AskPurpose = 'intake' | 'clarify'

export type OrchestratorStep =
  | { kind: 'route'; specialist: SpecialistNode; pathTaken: string[] }
  | { kind: 'escalate'; reason?: string; pathTaken: string[]; analysis?: EscalationAnalysis }
  | { kind: 'ask'; key: string; node?: VariableNode; spec?: VariableSpec; reason: 'missing' | 'low'; pathTaken: string[]; purpose?: AskPurpose }
  | { kind: 'confirm'; key: string; candidate: Extraction; node?: VariableNode; spec?: VariableSpec; pathTaken: string[] }
  | { kind: 'guard'; pathTaken: string[] }

export function nextStep(
  tree: Tree,
  filled: FilledVariables,
  candidates: Record<string, Extraction>,
  specs: Record<string, VariableSpec>,
  thresholds?: { high?: number; medium?: number },
): OrchestratorStep {
  const high = thresholds?.high ?? 0.8
  const medium = thresholds?.medium ?? 0.5

  const result = runEngine(tree, filled)
  if (result.outcome === 'routed' && result.specialist) {
    return { kind: 'route', specialist: result.specialist, pathTaken: result.pathTaken }
  }
  if (result.outcome === 'escalated') {
    return { kind: 'escalate', reason: result.escalationReason, pathTaken: result.pathTaken }
  }

  const key = result.missingVariables[0]
  if (!key) return { kind: 'guard', pathTaken: result.pathTaken }

  const lastId = result.pathTaken[result.pathTaken.length - 1]
  const found = tree.nodes.find((n) => n.id === lastId)
  const node = found && found.type === 'variable' ? found : undefined
  const spec = specs[key]
  const cand = candidates[key]

  if (cand && confidenceBand(cand.confidence, high, medium) === 'medium') {
    return { kind: 'confirm', key, candidate: cand, node, spec, pathTaken: result.pathTaken }
  }
  return { kind: 'ask', key, node, spec, reason: cand ? 'low' : 'missing', pathTaken: result.pathTaken }
}

/**
 * Bookkeeping the policy below needs to persist across turns (held by the UI).
 *  - coreKeys      → the standard-intake variables to gather before an
 *                    ambiguity handoff (from `coreIntakeKeys(tree)`).
 *  - clarifiedKeys → triggers we've already attempted one clarification on.
 *  - gatheredKeys  → core variables we've already asked during gathering.
 */
export interface PlanState {
  coreKeys: string[]
  clarifiedKeys: Set<string>
  gatheredKeys: Set<string>
}

type CoreStatus = 'satisfied' | 'confirm' | 'clarify' | 'ask'

/**
 * Whether a single core-intake variable still needs attention.
 *  - satisfied → filled (confirmed/confident, and any ambiguous value clarified),
 *                OR already asked once during intake (don't loop on it).
 *  - clarify   → filled with an ambiguous "can't pin down" value, not yet re-asked.
 *  - confirm   → a fresh MEDIUM-confidence extraction to confirm (pre-ask only).
 *  - ask       → missing / low-confidence and not yet asked.
 */
function coreStatus(
  key: string,
  filled: FilledVariables,
  candidates: Record<string, Extraction>,
  plan: PlanState,
  high: number,
  medium: number,
): CoreStatus {
  const f = filled[key]
  if (f) {
    if (isAmbiguousValue(f.value) && !plan.clarifiedKeys.has(key)) return 'clarify'
    return 'satisfied'
  }
  // Already asked during intake but nothing usable came back → move on (flagged).
  if (plan.gatheredKeys.has(key)) return 'satisfied'
  const c = candidates[key]
  if (c && confidenceBand(c.confidence, high, medium) === 'medium') return 'confirm'
  return 'ask'
}

/**
 * The intake-first orchestration step. The ENGINE still owns the routing /
 * escalation DECISION; this only separates INTAKE from ROUTING so neither
 * outcome is finalised before a full core intake — except a true emergency.
 *
 *   1. EMERGENCY interrupt — if the engine on the current values reaches an
 *      EMERGENCY-category escalation (mass/lump, acute progressive weakness),
 *      escalate immediately and skip the rest of intake.
 *   2. INTAKE phase — ask/confirm/clarify each CORE variable until the whole
 *      core set is satisfactorily resolved. (Ambiguous answers get one clarify.)
 *   3. DECISION phase — only once core intake is complete, run the engine on the
 *      full set to produce the final route or escalation, with a complete packet.
 *
 * The LLM is never consulted here; this is pure policy over engine output. A
 * non-emergency early route the engine could make on partial data is deliberately
 * IGNORED until intake is complete.
 */
export function planConversationStep(
  tree: Tree,
  filled: FilledVariables,
  candidates: Record<string, Extraction>,
  specs: Record<string, VariableSpec>,
  plan: PlanState,
  thresholds?: { high?: number; medium?: number },
): OrchestratorStep {
  const high = thresholds?.high ?? 0.8
  const medium = thresholds?.medium ?? 0.5
  const engine = runEngine(tree, filled)
  const pathTaken = engine.pathTaken

  // 1. EMERGENCY interrupt — the only thing that finishes before full intake.
  if (engine.outcome === 'escalated') {
    const analysis = classifyEscalation(tree, filled, engine, high)
    if (analysis.category === 'emergency') {
      return { kind: 'escalate', reason: engine.escalationReason, pathTaken, analysis }
    }
  }

  // 2. INTAKE phase — resolve every core variable before ANY outcome.
  for (const key of plan.coreKeys) {
    const status = coreStatus(key, filled, candidates, plan, high, medium)
    if (status === 'satisfied') continue
    const node = variableNodeByKey(tree, key)
    const spec = specs[key]
    if (status === 'confirm') {
      return { kind: 'confirm', key, candidate: candidates[key], node, spec, pathTaken }
    }
    if (status === 'clarify') {
      return { kind: 'ask', key, node, spec, reason: 'low', pathTaken, purpose: 'clarify' }
    }
    return {
      kind: 'ask',
      key,
      node,
      spec,
      reason: candidates[key] ? 'low' : 'missing',
      pathTaken,
      purpose: 'intake',
    }
  }

  // 3. DECISION phase — core intake complete; the engine decides on the full set.
  if (engine.outcome === 'routed' && engine.specialist) {
    return { kind: 'route', specialist: engine.specialist, pathTaken }
  }
  if (engine.outcome === 'escalated') {
    const analysis = classifyEscalation(tree, filled, engine, high)
    return {
      kind: 'escalate',
      reason: engine.escalationReason,
      pathTaken,
      analysis: {
        ...analysis,
        clarifiedKeys: [...plan.clarifiedKeys],
        gatheredKeys: [...plan.gatheredKeys],
      },
    }
  }

  // Incomplete at decision time → a path-required core var is still missing.
  const missing = engine.missingVariables[0]
  if (missing && !plan.gatheredKeys.has(missing)) {
    return {
      kind: 'ask',
      key: missing,
      node: variableNodeByKey(tree, missing),
      spec: specs[missing],
      reason: candidates[missing] ? 'low' : 'missing',
      pathTaken,
      purpose: 'intake',
    }
  }
  // Asked but uncapturable, or no question determinable → escalate for review.
  const analysis: EscalationAnalysis = {
    category: 'complex',
    triggerKey: missing,
    reasonText: missing
      ? `Could not capture "${missing}" during intake; routing needs a human.`
      : 'Intake could not be completed (tree may be incomplete).',
    pathTaken,
    clarifiedKeys: [...plan.clarifiedKeys],
    gatheredKeys: [...plan.gatheredKeys],
  }
  return { kind: 'escalate', reason: analysis.reasonText, pathTaken, analysis }
}

/**
 * Placeholder simulated extractor (stands in for the future LLM call).
 *
 * A curated rules engine over the patient's free text: ordered rules per
 * variable, first match wins. Confidences are deliberate — clear phrasing is
 * high (≥0.8, auto-committed), ambiguous phrasing is medium (→ confirmation),
 * so the demo reliably exercises the confirmation path. The real LLM will
 * replace this behind the same signature.
 */
interface ExtractRule {
  value: AnswerValue
  confidence: number
  test: (text: string) => boolean
}

const EMG_TESTED = (t: string): boolean =>
  /\b(emg|nerve test|nerve study|nerve conduction|conduction study|electromyogra\w*|electrodiagnostic)\b/.test(t)

const EXTRACTION_RULES: Record<string, ExtractRule[]> = {
  presentationType: [
    { value: 'mass_lump', confidence: 0.93, test: (t) => /\b(lump|mass|bump|swelling|growth|knot|nodule)\b/.test(t) },
    { value: 'acute_trauma', confidence: 0.9, test: (t) => /\b(injur\w*|trauma\w*|accident|fell|fall|cut|laceration|wound|fracture\w*|broke|broken|stab\w*|crush\w*)\b/.test(t) },
    { value: 'typical_nerve_symptoms', confidence: 0.85, test: (t) => /\b(numb\w*|tingl\w*|pins and needles|weak\w*|pain\w*|burning|shooting|nerve)\b/.test(t) },
    { value: 'unsure', confidence: 0.55, test: (t) => /\b(not sure|unsure|don'?t know|no idea|hard to say|confus\w*)\b/.test(t) },
  ],
  dominantSymptom: [
    { value: 'weakness', confidence: 0.88, test: (t) => /\b(weak\w*|grip|dropping|drop things|giving way|can'?t lift)\b/.test(t) },
    { value: 'numbness_tingling', confidence: 0.9, test: (t) => /\b(numb\w*|tingl\w*|pins and needles|asleep|prickl\w*)\b/.test(t) },
    { value: 'pain', confidence: 0.88, test: (t) => /\b(pain\w*|ache|aching|sore|burning|shooting|sharp)\b/.test(t) },
    { value: 'mixed', confidence: 0.6, test: (t) => /\b(a mix|mixed|everything|all of it|combination|bit of everything|several things)\b/.test(t) },
  ],
  symptomLocation: [
    { value: 'neck_radiating', confidence: 0.85, test: (t) => /\b(neck|radiat\w*|shoulder|down my arm|shoots down|from my neck)\b/.test(t) },
    { value: 'arm_hand', confidence: 0.9, test: (t) => /\b(hand|hands|finger\w*|thumb|wrist|forearm|arm)\b/.test(t) },
    { value: 'leg_foot', confidence: 0.9, test: (t) => /\b(leg|legs|foot|feet|ankle|calf|toe\w*|thigh|shin)\b/.test(t) },
  ],
  symptomDuration: [
    { value: 'chronic', confidence: 0.85, test: (t) => /\b(month\w*|year\w*|long time|chronic|ages|forever)\b/.test(t) },
    { value: 'subacute', confidence: 0.8, test: (t) => /\b(weeks?|couple of weeks|few weeks|fortnight)\b/.test(t) },
    { value: 'acute', confidence: 0.85, test: (t) => /\b(\bday\b|days|yesterday|today|just started|recently|sudden\w*|this morning|overnight)\b/.test(t) },
  ],
  emgStatus: [
    { value: 'done_abnormal', confidence: 0.85, test: (t) => EMG_TESTED(t) && /\b(abnormal|positive|showed|confirmed|compression|damage|denervation)\b/.test(t) },
    { value: 'done_normal', confidence: 0.85, test: (t) => EMG_TESTED(t) && /\b(normal|clear|fine|unremarkable|negative|nothing wrong)\b/.test(t) },
    { value: 'not_done', confidence: 0.78, test: (t) => /\b(no nerve test|haven'?t had|not had|none yet|no emg|haven'?t done|never had|hasn'?t had)\b/.test(t) },
  ],
}

export function extractVariables(
  text: string,
  specs: Record<string, VariableSpec>,
): Record<string, Extraction> {
  const t = text.toLowerCase()
  const out: Record<string, Extraction> = {}
  for (const key of Object.keys(specs)) {
    const rules = EXTRACTION_RULES[key]
    if (!rules) continue
    for (const rule of rules) {
      if (rule.test(t)) {
        out[key] = { value: rule.value, confidence: rule.confidence }
        break
      }
    }
  }
  return out
}

/** Run the conversation loop to a routing decision (or escalation). */
export function runOrchestrator(opts: OrchestratorOptions): OrchestratorResult {
  const {
    tree,
    specs,
    initialText,
    extract = extractVariables,
    ask,
    confirm,
    log = () => {},
  } = opts
  const HIGH = opts.thresholds?.high ?? 0.8
  const MEDIUM = opts.thresholds?.medium ?? 0.5
  const maxIterations = opts.maxIterations ?? 50

  const filled: FilledVariables = {}
  const candidates: Record<string, Extraction> =
    initialText !== undefined ? { ...extract(initialText, specs) } : {}
  log({ type: 'extract', values: { ...candidates } })

  const commit = (key: string, value: AnswerValue, confidence: number, via: 'extraction' | 'answer' | 'confirmation') => {
    filled[key] = { value, confidence }
    log({ type: 'commit', key, value, confidence, via })
  }

  // Auto-commit high-confidence extractions up front.
  for (const [key, c] of Object.entries(candidates)) {
    if (confidenceBand(c.confidence, HIGH, MEDIUM) === 'high') {
      commit(key, c.value, c.confidence, 'extraction')
      delete candidates[key]
    }
  }

  let iterations = 0
  let questionsAsked = 0
  let confirmations = 0

  while (iterations < maxIterations) {
    iterations++
    const step = nextStep(tree, filled, candidates, specs, { high: HIGH, medium: MEDIUM })

    if (step.kind === 'route') {
      log({ type: 'routed', specialist: step.specialist.specialistName })
      return {
        outcome: 'routed',
        specialist: step.specialist,
        filled,
        pathTaken: step.pathTaken,
        questionsAsked,
        confirmations,
        iterations,
        pathVariablesConfident: true,
      }
    }

    if (step.kind === 'escalate') {
      log({ type: 'escalated', reason: step.reason })
      return {
        outcome: 'escalated',
        escalationReason: step.reason,
        filled,
        pathTaken: step.pathTaken,
        questionsAsked,
        confirmations,
        iterations,
        pathVariablesConfident: false,
      }
    }

    if (step.kind === 'guard') break

    const freshQuestion =
      step.spec?.patientQuestion ?? (step.node ? step.node.prompt : `What is “${step.key}”?`)

    if (step.kind === 'confirm') {
      const question = `It sounds like ${friendlyAnswer(step.node, step.candidate.value)} — is that right?`
      log({ type: 'ask', key: step.key, question, reason: 'missing' })
      const accepted = confirm({ key: step.key, value: step.candidate.value, question, spec: step.spec })
      confirmations++
      log({ type: 'confirm', key: step.key, value: step.candidate.value, accepted })
      delete candidates[step.key]
      if (accepted) {
        commit(step.key, step.candidate.value, Math.max(step.candidate.confidence, HIGH), 'confirmation')
      } else {
        log({ type: 'ask', key: step.key, question: freshQuestion, reason: 'rejected' })
        const answer = ask({ key: step.key, question: freshQuestion, spec: step.spec, reason: 'rejected' })
        questionsAsked++
        log({ type: 'answer', key: step.key, value: answer })
        commit(step.key, answer, 1, 'answer')
      }
    } else {
      // ask (absent or low) → ask fresh.
      log({ type: 'ask', key: step.key, question: freshQuestion, reason: 'missing' })
      const answer = ask({ key: step.key, question: freshQuestion, spec: step.spec, reason: 'missing' })
      questionsAsked++
      log({ type: 'answer', key: step.key, value: answer })
      delete candidates[step.key]
      commit(step.key, answer, 1, 'answer')
    }
  }

  // Safety guard: should be unreachable for a finite, acyclic tree.
  log({ type: 'guard', iterations })
  const final = runEngine(tree, filled)
  return {
    outcome: 'guard_exceeded',
    filled,
    pathTaken: final.pathTaken,
    questionsAsked,
    confirmations,
    iterations,
    pathVariablesConfident: false,
  }
}

/* ========================================================================== */
/* Engine-driven conversation loop — resumable state machine                  */
/* ========================================================================== */
/*
 * ⚠️ HARD RULE: the ENGINE decides; the LLM only extracts/phrases.
 *
 * This loop is driven entirely by runEngine reporting the ONE missing variable
 * on the patient's ACTUAL path. The LLM is NEVER given the tree and is NEVER
 * asked "what should I ask next" — it only extracts a variable VALUE (with a
 * confidence) from the patient's words. Because the engine only ever reports
 * variables on the path it is actually walking, the questions are automatically
 * relevant: a patient heading toward a lower-limb specialist is never asked a
 * wrist-specific question, because the engine never reaches that node. There is
 * deliberately NO logic here that asks about variables off the path.
 */

/** Confidence thresholds. */
export const CONFIDENCE_HIGH = 0.8 // ≥ → use directly
export const CONFIDENCE_LOW = 0.4 // [LOW, HIGH) → confirm ; < LOW or absent → ask fresh
/** Safety guard so the loop can never run forever. */
export const MAX_TURNS = 50

export type ConvAnswerValue = string | number | boolean

export interface TranscriptTurn {
  role: 'patient' | 'bot'
  text: string
}

export interface PendingQuestion {
  kind: 'question' | 'confirm'
  variableKey: string
  text: string
  /** The value being confirmed (kind === 'confirm' only). */
  value?: ConvAnswerValue
}

export type ConversationResult =
  | { kind: 'routed'; specialist: SpecialistNode; pathTaken: string[] }
  | { kind: 'escalated'; reason?: string; pathTaken: string[] }

export interface ConversationState {
  filled: FilledVariables
  transcript: TranscriptTurn[]
  status: 'asking' | 'routed' | 'escalated'
  /** The question to show the UI when status === 'asking'. */
  currentQuestion: PendingQuestion | null
  /** The terminal outcome when status is 'routed' | 'escalated'. */
  result: ConversationResult | null
  /** Turn counter for the safety guard. */
  turns: number
}

/** Pluggable extractor — defaults to the real Claude-backed call (extract.ts). */
export type Extractor = (
  text: string,
  specs: Record<string, VariableSpec> | VariableSpec[],
  tree: Tree,
) => Promise<FilledVariables>

interface ConvOptions {
  extract?: Extractor
}

function specMap(specs: Record<string, VariableSpec> | VariableSpec[]): Map<string, VariableSpec> {
  return Array.isArray(specs)
    ? new Map(specs.map((s) => [s.key, s] as const))
    : new Map(Object.entries(specs))
}

/** First variable node in the tree that uses `key` (for confirmation wording). */
function variableNodeByKey(tree: Tree, key: string): VariableNode | undefined {
  return tree.nodes.find((n): n is VariableNode => n.type === 'variable' && n.variableKey === key)
}

/** Human label for a value at a variable node — its matching branch label. */
function branchLabelForValue(node: VariableNode | undefined, value: ConvAnswerValue): string {
  const branch = node?.branches.find((b) => evaluateCondition(b.condition, value))
  return branch ? branch.label : String(value)
}

/**
 * Merge newly extracted values into filled, keeping only those at or above the
 * LOW threshold. Anything below LOW (or absent) is treated as not-extracted, so
 * the engine will ask for it fresh.
 */
function mergeFilled(filled: FilledVariables, extracted: FilledVariables): FilledVariables {
  const next: FilledVariables = { ...filled }
  for (const [key, v] of Object.entries(extracted)) {
    if (typeof v?.confidence === 'number' && v.confidence >= CONFIDENCE_LOW) {
      next[key] = v
    }
  }
  return next
}

/** The first MEDIUM-confidence variable on the routed path, if any. */
function firstMediumPathVariable(
  tree: Tree,
  pathTaken: string[],
  filled: FilledVariables,
): string | null {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]))
  for (const id of pathTaken) {
    const node = byId.get(id)
    if (node?.type !== 'variable') continue
    const v = filled[node.variableKey]
    if (v && confidenceBand(v.confidence, CONFIDENCE_HIGH, CONFIDENCE_LOW) === 'medium') {
      return node.variableKey
    }
  }
  return null
}

/**
 * The heart of the loop. Runs the engine ONCE against the current filled state
 * and decides the next user-facing step — then RETURNS control to the UI. It
 * never auto-answers.
 */
export function advance(
  state: ConversationState,
  tree: Tree,
  specs: Record<string, VariableSpec> | VariableSpec[],
): ConversationState {
  const turns = state.turns + 1
  const lookup = specMap(specs)

  // Safety guard.
  if (turns > MAX_TURNS) {
    const reason = 'Safety stop: too many turns without a decision.'
    return {
      ...state,
      turns,
      status: 'escalated',
      currentQuestion: null,
      result: { kind: 'escalated', reason, pathTaken: [] },
      transcript: [...state.transcript, { role: 'bot', text: reason }],
    }
  }

  const result = runEngine(tree, state.filled)

  if (result.outcome === 'escalated') {
    return {
      ...state,
      turns,
      status: 'escalated',
      currentQuestion: null,
      result: { kind: 'escalated', reason: result.escalationReason, pathTaken: result.pathTaken },
      transcript: [
        ...state.transcript,
        { role: 'bot', text: `Flagged for human review: ${result.escalationReason ?? ''}`.trim() },
      ],
    }
  }

  if (result.outcome === 'routed' && result.specialist) {
    // Before routing: confirm any MEDIUM-confidence variable ON THE PATH.
    const mediumKey = firstMediumPathVariable(tree, result.pathTaken, state.filled)
    if (mediumKey) {
      const value = state.filled[mediumKey].value as ConvAnswerValue
      const label = branchLabelForValue(variableNodeByKey(tree, mediumKey), value)
      const text = `It sounds like ${label} — is that right?`
      return {
        ...state,
        turns,
        status: 'asking',
        currentQuestion: { kind: 'confirm', variableKey: mediumKey, text, value },
        result: null,
        transcript: [...state.transcript, { role: 'bot', text }],
      }
    }
    return {
      ...state,
      turns,
      status: 'routed',
      currentQuestion: null,
      result: { kind: 'routed', specialist: result.specialist, pathTaken: result.pathTaken },
      transcript: [
        ...state.transcript,
        { role: 'bot', text: `Routing to ${result.specialist.specialistName}.` },
      ],
    }
  }

  // incomplete → ask for the ONE missing variable on the path.
  const key = result.missingVariables[0]
  if (!key) {
    const reason = 'No further question could be determined (tree may be incomplete).'
    return {
      ...state,
      turns,
      status: 'escalated',
      currentQuestion: null,
      result: { kind: 'escalated', reason, pathTaken: result.pathTaken },
      transcript: [...state.transcript, { role: 'bot', text: reason }],
    }
  }

  const stopNode = tree.nodes.find((n) => n.id === result.pathTaken[result.pathTaken.length - 1])
  const spec = lookup.get(key)
  const text =
    spec?.patientQuestion ??
    (stopNode?.type === 'variable' ? stopNode.prompt : `Tell me about “${key}”.`)

  return {
    ...state,
    turns,
    status: 'asking',
    currentQuestion: { kind: 'question', variableKey: key, text },
    result: null,
    transcript: [...state.transcript, { role: 'bot', text }],
  }
}

/**
 * Start a conversation: bulk-extract from the opening ramble, then advance.
 * The LLM fills as many variables as the text supports; the engine decides what
 * (if anything) still needs asking.
 */
export async function startConversation(
  openingText: string,
  tree: Tree,
  specs: Record<string, VariableSpec> | VariableSpec[],
  opts: ConvOptions = {},
): Promise<ConversationState> {
  const extract = opts.extract ?? defaultExtract
  const extracted = await extract(openingText, specs, tree)
  const state: ConversationState = {
    filled: mergeFilled({}, extracted),
    transcript: [{ role: 'patient', text: openingText }],
    status: 'asking',
    currentQuestion: null,
    result: null,
    turns: 0,
  }
  return advance(state, tree, specs)
}

/**
 * Submit the patient's answer to the current question, then advance.
 * - For a normal question: the LLM extracts the variable from the answer.
 * - For a confirmation: a yes keeps the value (now high-confidence); a no clears
 *   it so the engine asks fresh.
 */
export async function submitAnswer(
  state: ConversationState,
  answerText: string,
  tree: Tree,
  specs: Record<string, VariableSpec> | VariableSpec[],
  opts: ConvOptions = {},
): Promise<ConversationState> {
  const q = state.currentQuestion
  const withAnswer: ConversationState = {
    ...state,
    transcript: [...state.transcript, { role: 'patient', text: answerText }],
  }
  if (!q) return advance(withAnswer, tree, specs)

  if (q.kind === 'confirm') {
    const yes = parseYesNo(answerText)
    let filled: FilledVariables
    if (yes) {
      // Confirmed → promote to high confidence so it routes.
      filled = { ...withAnswer.filled, [q.variableKey]: { ...withAnswer.filled[q.variableKey], confidence: 1 } }
    } else {
      // Rejected → drop it; the engine will ask fresh.
      filled = { ...withAnswer.filled }
      delete filled[q.variableKey]
    }
    return advance({ ...withAnswer, filled }, tree, specs)
  }

  // Normal question → extract the variable from the answer, merge, advance.
  const extract = opts.extract ?? defaultExtract
  const extracted = await extract(answerText, specs, tree)
  return advance({ ...withAnswer, filled: mergeFilled(withAnswer.filled, extracted) }, tree, specs)
}

/** Lenient yes/no parse for confirmation answers. */
function parseYesNo(text: string): boolean {
  return /\b(yes|yeah|yep|yup|correct|right|true|that'?s right|sounds right|exactly|affirmative)\b/i.test(
    text,
  )
}
