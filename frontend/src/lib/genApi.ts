import type { Tree, VariableSpec } from '../types/tree'
import type {
  GenCandidateVariable,
  GenCase,
  GenDecision,
  GenRosterEntry,
} from './generator/types'
import type { InducedRuleSummary } from './generator/induce'
import type { GapFinding } from './generator/gaps'
import type { ValidationReport } from './generator/validate'

/**
 * Blume — generator API client (/api/v1/gen via the Vite proxy → FastAPI).
 * Maps the backend's snake_case rows to the camelCase types the pure
 * pipeline modules consume. The deterministic stages run in the browser and
 * PERSIST here per stage, so the database — not component state — is the
 * record of the session.
 */

const API_BASE = '/api/v1'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

/* ── sessions ── */

export interface GenSession {
  id: string
  subspecialty: string
  surgeonName?: string | null
  stage: string
  status: string
  treeId?: string | null
  roster: GenRosterEntry[]
  draftTree?: Tree | null
  validationSummary?: Record<string, unknown> | null
}

function mapSession(s: any): GenSession {
  return {
    id: s.id,
    subspecialty: s.subspecialty,
    surgeonName: s.surgeon_name,
    stage: s.stage,
    status: s.status,
    treeId: s.tree_id,
    roster: (s.roster_json ?? []) as GenRosterEntry[],
    draftTree: s.draft_tree_json ?? null,
    validationSummary: s.validation_summary_json ?? null,
  }
}

export async function createGenSession(input: {
  subspecialty: string
  surgeonName?: string
  roster: GenRosterEntry[]
}): Promise<GenSession> {
  return mapSession(
    await req('/gen/sessions', {
      method: 'POST',
      body: JSON.stringify({
        subspecialty: input.subspecialty,
        surgeon_name: input.surgeonName,
        roster: input.roster.map((r) => ({ name: r.name, specialty: r.specialty, focus: r.focus ?? '' })),
      }),
    }),
  )
}

export async function listGenSessions(): Promise<GenSession[]> {
  return ((await req<any[]>('/gen/sessions')) ?? []).map(mapSession)
}

export async function patchGenSession(
  id: string,
  patch: { stage?: string; status?: string; treeId?: string },
): Promise<GenSession> {
  return mapSession(
    await req(`/gen/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: patch.stage, status: patch.status, tree_id: patch.treeId }),
    }),
  )
}

/* ── cases ── */

function mapCase(c: any): GenCase {
  return {
    id: c.id,
    subspecialty: c.subspecialty,
    narrative: c.narrative,
    groundTruth: c.ground_truth_json ?? {},
    source: c.source,
    qualityReviewed: c.quality_reviewed,
    minimalPairOf: c.minimal_pair_of,
    variedVariable: c.varied_variable,
  }
}

export async function listCases(subspecialty: string): Promise<GenCase[]> {
  const q = new URLSearchParams({ subspecialty })
  return ((await req<any[]>(`/gen/cases?${q}`)) ?? []).map(mapCase)
}

export async function generateCases(input: {
  subspecialty: string
  count: number
  variableHints?: string[]
  roster?: GenRosterEntry[]
  minimalPairOf?: string
  /** Boundary-targeting context for minimal pairs: how the surgeon decided
   * the seed case. Steers WHICH variable gets flipped — never the outcome. */
  parentDecision?: { routedTo?: string; escalated: boolean; workup: string[] }
}): Promise<GenCase[]> {
  return (
    (await req<any[]>('/gen/cases/generate', {
      method: 'POST',
      body: JSON.stringify({
        subspecialty: input.subspecialty,
        count: input.count,
        variable_hints: input.variableHints ?? [],
        roster: (input.roster ?? []).map((r) => ({ name: r.name, specialty: r.specialty, focus: r.focus ?? '' })),
        minimal_pair_of: input.minimalPairOf,
        parent_decision: input.parentDecision,
      }),
    })) ?? []
  ).map(mapCase)
}

export async function createCase(input: {
  subspecialty: string
  narrative: string
  groundTruth: Record<string, unknown>
  source?: string
}): Promise<GenCase> {
  return mapCase(
    await req('/gen/cases', {
      method: 'POST',
      body: JSON.stringify({
        subspecialty: input.subspecialty,
        narrative: input.narrative,
        ground_truth: input.groundTruth,
        source: input.source ?? 'hand_authored',
      }),
    }),
  )
}

/** LLM job 4 — DE-IDENTIFIED referral letters → synthetic cases (rewritten,
 * never copied). The caller is responsible for de-identification. */
export async function ingestReferralLetters(input: {
  subspecialty: string
  letters: string
}): Promise<GenCase[]> {
  return (
    (await req<any[]>('/gen/cases/ingest', {
      method: 'POST',
      body: JSON.stringify({ subspecialty: input.subspecialty, letters: input.letters }),
    })) ?? []
  ).map(mapCase)
}

/** LLM job 5 — advisory consistency flags across the surgeon's decisions. */
export interface ConsistencyFlag {
  caseIds: string[]
  concern: string
}

export async function checkConsistency(sessionId: string): Promise<ConsistencyFlag[]> {
  return (await req<ConsistencyFlag[]>(`/gen/sessions/${sessionId}/consistency`, { method: 'POST' })) ?? []
}

/** LLM job 6 — surgeon's free-text workup → proposed structured items. */
export async function structureWorkupText(
  text: string,
  knownTests: string[],
): Promise<{ items: { name: string; protocol?: string; rationale?: string }[]; wouldNotOrder: string[] }> {
  return req('/gen/workup/structure', {
    method: 'POST',
    body: JSON.stringify({ text, known_tests: knownTests }),
  })
}

export async function markCaseReviewed(id: string, reviewed: boolean): Promise<GenCase> {
  return mapCase(
    await req(`/gen/cases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ quality_reviewed: reviewed }),
    }),
  )
}

/* ── layer 1: highlights + candidate variables ── */

/** One distinct clinical concept found inside a highlight. */
export interface HighlightObservation {
  key: string
  label?: string | null
  value?: unknown
  spanText: string
  spanStart?: number | null
  spanEnd?: number | null
  axis: 'routing' | 'workup' | 'both'
  source: 'ground_truth' | 'llm' | 'fallback'
  confidence?: number | null
}

export interface GenHighlight {
  id: string
  caseId: string
  spanText: string
  axis: 'routing' | 'workup' | 'both'
  mappedVariableKey?: string | null
  /** The atomic units: a highlight owns MANY variable observations. */
  observations: HighlightObservation[]
}

function mapHighlight(h: any): GenHighlight {
  return {
    id: h.id,
    caseId: h.case_id,
    spanText: h.span_text,
    axis: h.axis,
    mappedVariableKey: h.mapped_variable_key,
    observations: (h.observations_json ?? []) as HighlightObservation[],
  }
}

export async function submitHighlight(input: {
  sessionId: string
  caseId: string
  spanText: string
  spanStart?: number
  spanEnd?: number
  axis: 'routing' | 'workup' | 'both'
}): Promise<GenHighlight> {
  return mapHighlight(
    await req<any>('/gen/highlights', {
      method: 'POST',
      body: JSON.stringify({
        session_id: input.sessionId,
        case_id: input.caseId,
        span_text: input.spanText,
        span_start: input.spanStart,
        span_end: input.spanEnd,
        axis: input.axis,
      }),
    }),
  )
}

/** Surgeon curation: replace a highlight's observation set (chip removal).
 * The backend rebuilds the candidate tally so frequencies never drift. */
export async function updateHighlightObservations(
  highlightId: string,
  observations: HighlightObservation[],
): Promise<GenHighlight> {
  return mapHighlight(
    await req<any>(`/gen/highlights/${highlightId}/observations`, {
      method: 'PUT',
      body: JSON.stringify({ observations }),
    }),
  )
}

export async function listCandidateVariables(sessionId: string): Promise<GenCandidateVariable[]> {
  const rows = (await req<any[]>(`/gen/sessions/${sessionId}/variables`)) ?? []
  return rows.map((v) => ({
    key: v.key,
    label: v.label,
    axis: v.axis,
    valueSamples: v.value_samples_json ?? [],
    frequency: v.frequency,
  }))
}

/* ── layer 2: decisions ── */

export async function submitDecision(sessionId: string, d: GenDecision): Promise<void> {
  await req('/gen/decisions', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      case_id: d.caseId,
      routed_specialist_name: d.routedSpecialistName,
      escalated: d.escalated,
      skipped: d.skipped ?? false,
      skip_reason: d.skipReason,
      urgency: d.urgency,
      workup: d.workup,
      workup_counterfactual: d.workupCounterfactual,
      would_not_order: d.wouldNotOrder,
      case_variables: d.caseVariables,
    }),
  })
}

export async function listDecisions(sessionId: string): Promise<GenDecision[]> {
  const rows = (await req<any[]>(`/gen/sessions/${sessionId}/decisions`)) ?? []
  return rows.map((r) => ({
    caseId: r.case_id,
    routedSpecialistName: r.routed_specialist_name ?? undefined,
    escalated: r.escalated,
    skipped: r.skipped ?? false,
    skipReason: r.skip_reason ?? undefined,
    urgency: r.urgency ?? undefined,
    workup: r.workup_json ?? [],
    workupCounterfactual: r.workup_counterfactual ?? undefined,
    wouldNotOrder: r.would_not_order_json ?? [],
    caseVariables: r.case_variables_json ?? {},
  }))
}

/* ── layers 2/3: persist pipeline outputs ── */

export async function persistRules(sessionId: string, rules: InducedRuleSummary[]): Promise<void> {
  await req(`/gen/sessions/${sessionId}/induce`, {
    method: 'POST',
    body: JSON.stringify({
      rules: rules.map((r) => ({
        kind: r.kind,
        condition: r.condition,
        target: r.target,
        support_case_ids: r.supportCaseIds,
        confidence: r.confidence,
      })),
    }),
  })
}

export async function persistDraft(sessionId: string, tree: Tree): Promise<void> {
  await req(`/gen/sessions/${sessionId}/assemble`, {
    method: 'POST',
    body: JSON.stringify({ tree }),
  })
}

export interface PersistedGap {
  id: string
  kind: string
  detail: Record<string, unknown>
  question: string | null
  status: 'open' | 'resolved' | 'dismissed'
}

export async function persistGaps(sessionId: string, gaps: GapFinding[]): Promise<PersistedGap[]> {
  const rows = await req<any[]>(`/gen/sessions/${sessionId}/gaps`, {
    method: 'POST',
    body: JSON.stringify({
      // LLM job 3: ask for warmer phrasing; the deterministic template travels
      // along as the guaranteed fallback (detection already happened client-side).
      gaps: gaps.map((g) => ({ kind: g.kind, detail: g.detail, question: g.question, phrase_with_llm: true })),
    }),
  })
  return (rows ?? []).map((g) => ({
    id: g.id,
    kind: g.kind,
    detail: g.detail_json ?? {},
    question: g.question,
    status: g.status,
  }))
}

export async function setGapStatus(gapId: string, status: 'open' | 'resolved' | 'dismissed'): Promise<void> {
  await req(`/gen/gaps/${gapId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export async function persistValidation(sessionId: string, tree: Tree, report: ValidationReport): Promise<void> {
  await req(`/gen/sessions/${sessionId}/validate`, {
    method: 'POST',
    body: JSON.stringify({
      tree,
      summary: report.summary,
      results: report.results.map((r) => ({
        case_id: r.caseId,
        expected: r.expected,
        engine: r.engine,
        routing_match: r.routingMatch,
        workup_under_order: r.underOrdered.length > 0,
        workup_over_order: r.overOrdered.length > 0,
      })),
    }),
  })
}

/* ── variable registry (best-effort spec registration on save) ── */

export async function registerVariableSpecs(specs: VariableSpec[]): Promise<void> {
  for (const s of specs) {
    try {
      await req('/variables', {
        method: 'POST',
        body: JSON.stringify({
          key: s.key,
          clinical_prompt: s.clinicalPrompt,
          patient_question: s.patientQuestion,
          answer_type: s.answerType,
          options_json: s.options ?? null,
          extraction_hints: s.extractionHints,
        }),
      })
    } catch {
      // Key may already exist (global registry) — that's fine; move on.
    }
  }
}

/* ── cpg-to-scaffold (additive tree generation) ── */

export interface CPGBaseMeta {
  docId: string
  documentName: string
  subspecialty?: string
  sections?: string[]
}

export async function generateCPGScaffold(
  sessionId: string,
  file: File
): Promise<{ tree: Tree; placeholderCount: number; validationIssues: any[]; baseMeta: CPGBaseMeta | null }> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/gen/sessions/${sessionId}/cpg-scaffold`, {
    method: 'POST',
    // Do NOT set Content-Type header when using FormData; fetch handles the multipart boundary automatically
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST /cpg-scaffold failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  return {
    tree: data.tree,
    placeholderCount: data.placeholder_count,
    validationIssues: data.validation_issues,
    baseMeta: data.base_meta ?? null,
  }
}
