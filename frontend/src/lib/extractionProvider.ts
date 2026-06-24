import { extractVariables as liveExtract } from './extract'
import { extractVariables as rulesExtract } from './orchestrator'
import type { FilledVariables, Tree, VariableSpec } from '../types/tree'

/**
 * Blume — extraction provider + DEMO_MODE safety net.
 *
 * ⚠️ HARD RULE: the engine decides; the LLM only extracts/phrases. DEMO_MODE
 * swaps the REAL Claude extractor for a SCRIPTED one with the IDENTICAL
 * signature and output shape (FilledVariables). Nothing downstream — the
 * orchestrator, the engine, the UI — changes; ONLY the source of the
 * {value, confidence} map changes. This guarantees a live demo never dies on a
 * flaky API: flip one switch and extraction becomes deterministic and offline.
 */

/** DEMO_MODE — flip `enabled` to true for scripted, offline extraction. */
export const demoConfig = { enabled: false }

export function setDemoMode(enabled: boolean): void {
  demoConfig.enabled = enabled
}

export function isDemoMode(): boolean {
  return demoConfig.enabled
}

/**
 * Scripted extractions for the 3 known demo patient inputs. Realistic
 * confidences — including ONE medium value (the vague case's dominantSymptom),
 * so the confirmation step still demonstrates.
 */
interface ScriptedCase {
  label: string
  match: RegExp
  result: FilledVariables
}

const SCRIPTS: ScriptedCase[] = [
  {
    // 1. CLEAN → routes straight to a specialist (all high confidence).
    label: 'clean',
    match: /numbness and tingling in my right hand/i,
    result: {
      presentationType: { value: 'typical_nerve_symptoms', confidence: 0.96 },
      dominantSymptom: { value: 'numbness_tingling', confidence: 0.94 },
      symptomLocation: { value: 'arm_hand', confidence: 0.95 },
      symptomDuration: { value: 'chronic', confidence: 0.9 },
      emgStatus: { value: 'done_abnormal', confidence: 0.92 },
    },
  },
  {
    // 2. VAGUE → follow-up questions + a confirmation (medium dominantSymptom).
    label: 'vague',
    match: /mix of everything/i,
    result: {
      symptomLocation: { value: 'arm_hand', confidence: 0.9 },
      dominantSymptom: { value: 'mixed', confidence: 0.55 }, // MEDIUM → confirmation
    },
  },
  {
    // 3. RED FLAG → escalates immediately.
    label: 'red-flag',
    match: /lump in my forearm/i,
    result: {
      presentationType: { value: 'mass_lump', confidence: 0.97 },
      symptomLocation: { value: 'arm_hand', confidence: 0.8 },
    },
  },
]

function toRecord(
  specs: Record<string, VariableSpec> | VariableSpec[],
): Record<string, VariableSpec> {
  return Array.isArray(specs) ? Object.fromEntries(specs.map((s) => [s.key, s])) : specs
}

/**
 * The SIMULATED extractor — same signature and output shape as the real one.
 * Matches a scripted case for the 3 known demo openings; otherwise falls back to
 * the deterministic keyword extractor (so follow-up ANSWERS also work offline).
 * No network, ever.
 */
export async function simulatedExtract(
  patientText: string,
  specs: Record<string, VariableSpec> | VariableSpec[],
): Promise<FilledVariables> {
  for (const script of SCRIPTS) {
    if (script.match.test(patientText)) return { ...script.result }
  }
  return rulesExtract(patientText, toRecord(specs))
}

/**
 * Drop-in replacement for the real `extractVariables`. Identical signature, so
 * the orchestrator can default to this and DEMO_MODE becomes a single global
 * switch honoured everywhere — without any caller passing extra arguments.
 */
export async function extractVariablesAuto(
  patientText: string,
  specs: Record<string, VariableSpec> | VariableSpec[],
  tree: Tree,
  options?: { endpoint?: string; signal?: AbortSignal },
): Promise<FilledVariables> {
  if (demoConfig.enabled) {
    return simulatedExtract(patientText, specs)
  }
  return liveExtract(patientText, specs, tree, options)
}
