import { buildExtractionTool, getRelevantSpecs } from './extractionSchema'
import type { FilledVariables, Tree, VariableSpec } from '../types/tree'

/**
 * Blume — real Claude-powered extraction.
 *
 * ⚠️ ARCHITECTURAL BOUNDARY: the LLM ONLY extracts clinical variable VALUES
 * from patient text. It never routes, diagnoses, or recommends — the
 * deterministic runEngine makes ALL routing decisions. This function returns
 * FilledVariables (value + confidence) and nothing else.
 *
 * The API key is never here: this calls the backend (/api/extract), which holds
 * the key and forces tool use so the model can only return structured JSON.
 */

const DEFAULT_ENDPOINT = '/api/extract'

interface ExtractOptions {
  /** Override the backend URL (e.g. an absolute URL for a Node test harness). */
  endpoint?: string
  /** Abort signal for cancellation/timeout. */
  signal?: AbortSignal
  /**
   * When true, rethrow on failure instead of returning {}. Lets the UI surface a
   * clear error (e.g. "backend not running" / "missing API key") and offer the
   * Demo-mode fallback. Defaults false to preserve the never-throws contract.
   */
  throwOnError?: boolean
}

/**
 * Extract whatever variables THIS tree uses from the patient's free text.
 * Returns only what was actually found; a failed call returns {} and never
 * throws, so the app keeps running.
 */
export async function extractVariables(
  patientText: string,
  specs: Record<string, VariableSpec> | VariableSpec[],
  tree: Tree,
  options: ExtractOptions = {},
): Promise<FilledVariables> {
  // Build the tool for ONLY this tree's variables, so we never ask about
  // variables the tree doesn't use.
  const relevant = getRelevantSpecs(tree, specs)
  const tool = buildExtractionTool(relevant)

  try {
    const response = await fetch(options.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patientText, tool }),
      signal: options.signal,
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || `Extraction request failed (${response.status}).`)
    }

    const data = (await response.json()) as { variables?: unknown }
    return parseExtracted(data.variables, relevant)
  } catch (err) {
    console.error('[Blume] extractVariables failed:', err)
    if (options.throwOnError) {
      throw err instanceof Error ? err : new Error('Extraction request failed.')
    }
    return {}
  }
}

/**
 * Validate and normalise the model's raw tool input into FilledVariables.
 * Drops anything with no value, zero/absent confidence, or an out-of-enum value
 * — so only what the patient actually supported survives.
 */
function parseExtracted(raw: unknown, specs: VariableSpec[]): FilledVariables {
  const out: FilledVariables = {}
  if (!raw || typeof raw !== 'object') return out

  const byKey = new Map(specs.map((s) => [s.key, s]))

  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const { value, confidence } = entry as { value?: unknown; confidence?: unknown }

    if (value === undefined || value === null) continue

    const conf = typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : 0
    if (conf <= 0) continue // absent / not mentioned → correctly omitted

    const spec = byKey.get(key)
    if (
      spec?.answerType === 'single_choice' &&
      spec.options &&
      !spec.options.includes(String(value))
    ) {
      // Model returned a value outside the allowed options — drop it rather than
      // feed the engine something it can't route on.
      console.warn(`[Blume] dropped out-of-options value for "${key}": ${String(value)}`)
      continue
    }

    out[key] = { value: value as FilledVariables[string]['value'], confidence: conf }
  }

  return out
}
