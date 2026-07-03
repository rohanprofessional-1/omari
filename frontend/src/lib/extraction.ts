import { type Extraction } from './orchestrator'
import { extractVariables as liveBackendExtract } from './extract'
import type { Tree, VariableSpec } from '../types/tree'

/**
 * Blume — extraction seam (async).
 *
 * REAL Claude extraction via the backend (/api/extract). The API key lives ONLY
 * on the server; the browser never holds it. On any failure (backend down,
 * missing key) it throws a clear message so the UI can surface the error.
 *
 * Per the project's HARD RULE, extraction only ever produces variable VALUES
 * with confidence — it never sees the tree's routing or decides what to ask.
 */

export async function extract(
  text: string,
  specs: Record<string, VariableSpec>,
  tree: Tree,
): Promise<Record<string, Extraction>> {
  // The tree is used only to build the tool schema (which variables to look
  // for); it is never sent to the model as routing logic. throwOnError surfaces
  // failures to the UI.
  const filled = await liveBackendExtract(text, specs, tree, { throwOnError: true })
  // extract.ts only emits entries with a defined value+confidence, so each entry
  // satisfies Extraction; the cast bridges FilledVariables' optional `value`.
  return filled as Record<string, Extraction>
}
