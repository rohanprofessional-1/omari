import type { Tree, VariableSpec } from '../types/tree'

/**
 * Blume — dynamic extraction schema.
 *
 * ⚠️ ARCHITECTURAL BOUNDARY: this builds the tool-use input schema the LLM uses
 * to EXTRACT clinical variables from patient text — and nothing else. The schema
 * contains no routing logic, no tree edges, no specialist names, and no concept
 * of a destination. The model only reports {value, confidence} per variable it
 * can identify. The deterministic engine makes every routing decision elsewhere.
 *
 * The schema is generated AT RUNTIME from whatever VariableSpecs exist, so adding
 * a variable in the Builder makes it extractable with zero code changes here.
 */

/** Minimal JSON Schema shape — the form Anthropic tool `input_schema` expects. */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'boolean'
  description?: string
  enum?: string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  minimum?: number
  maximum?: number
}

/** A full Anthropic tool definition (name + description + input_schema). */
export interface ExtractionTool {
  name: string
  description: string
  input_schema: JsonSchema
}

/** Schema for a variable's `value`, derived from its answerType/options. */
function valueSchema(spec: VariableSpec): JsonSchema {
  switch (spec.answerType) {
    case 'single_choice':
      return {
        type: 'string',
        ...(spec.options ? { enum: spec.options } : {}),
        description: 'The extracted value — must be EXACTLY one of the allowed options.',
      }
    case 'number':
      return { type: 'number', description: 'The extracted numeric value.' }
    case 'boolean':
      return { type: 'boolean', description: 'The extracted true/false value.' }
    case 'text':
      return { type: 'string', description: 'The extracted value as a short string.' }
  }
}

/** Schema for one variable: an object `{ value, confidence }` with hints. */
function variableSchema(spec: VariableSpec): JsonSchema {
  return {
    type: 'object',
    description:
      `${spec.clinicalPrompt} ` +
      `Recognise this variable from cues such as: ${spec.extractionHints}`,
    properties: {
      value: valueSchema(spec),
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description:
          'Your confidence from 0 to 1 that this value is correct, based ONLY on the patient text. ' +
          'Use lower values when the text is vague, hedged, or indirect.',
      },
    },
    required: ['value', 'confidence'],
    additionalProperties: false,
  }
}

/**
 * Build the tool-use INPUT SCHEMA dynamically from the given specs. Every spec
 * becomes an optional property; the model includes only the variables it finds
 * evidence for and omits the rest.
 */
export function buildExtractionToolSchema(specs: VariableSpec[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  for (const spec of specs) {
    properties[spec.key] = variableSchema(spec)
  }
  return {
    type: 'object',
    description:
      "Clinical variables extracted from the patient's free-text description. " +
      'Include a key ONLY when the text gives evidence for it; omit anything not mentioned. ' +
      'You are extracting information only — never infer routing, specialists, or a destination.',
    properties,
    required: [], // nothing required: the model fills only what it can extract
    additionalProperties: false,
  }
}

/**
 * Wrap the schema into a complete Anthropic tool definition, with a description
 * that restates the extraction-only boundary for the model.
 */
export function buildExtractionTool(specs: VariableSpec[]): ExtractionTool {
  return {
    name: 'record_extracted_variables',
    description:
      "Record the clinical variables you can identify in the patient's message. " +
      'You ONLY extract information from what the patient said. You never decide where the ' +
      'patient is routed, never see or name specialists, and never recommend a destination.',
    input_schema: buildExtractionToolSchema(specs),
  }
}

/**
 * Return only the specs for variables actually used by `tree`, in the order the
 * variable nodes appear — so we never ask the model about variables this tree
 * doesn't use. Accepts the specs as a keyed record or an array.
 */
export function getRelevantSpecs(
  tree: Tree,
  allSpecs: Record<string, VariableSpec> | VariableSpec[],
): VariableSpec[] {
  const lookup = Array.isArray(allSpecs)
    ? new Map(allSpecs.map((s) => [s.key, s] as const))
    : new Map(Object.entries(allSpecs))

  const seen = new Set<string>()
  const relevant: VariableSpec[] = []
  for (const node of tree.nodes) {
    if (node.type !== 'variable' || seen.has(node.variableKey)) continue
    seen.add(node.variableKey)
    const spec = lookup.get(node.variableKey)
    if (spec) relevant.push(spec)
  }
  return relevant
}
