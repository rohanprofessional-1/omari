import type { Tree } from '../../types/tree'

/**
 * Blume — Builder assistant API client (/api/v1/assistant via the Vite
 * proxy → FastAPI). The backend is STATELESS here: it returns the model's
 * reply and (optionally) proposed operations, never a modified tree and
 * never a side effect. Validation and application happen in the Builder,
 * behind the clinician's explicit confirm.
 */

export type AssistantMode = 'answer' | 'clarify' | 'propose' | 'decline'

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface TreeChatResponse {
  mode: AssistantMode
  message: string
  /** Raw proposed operations — MUST be Zod-validated (TreeOpsSchema) before use. */
  operations: unknown[]
  /** Presentation-only: ids of nodes the reply refers to, for canvas highlight. */
  focusNodeIds: string[]
}

export async function sendTreeChat(input: {
  tree: Tree
  message: string
  history: AssistantTurn[]
  warnings: string[]
  /** Canvas selection scoping the conversation ("these nodes"). */
  selectedNodeIds?: string[]
}): Promise<TreeChatResponse> {
  const res = await fetch('/api/v1/assistant/tree-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tree: input.tree,
      message: input.message,
      history: input.history,
      warnings: input.warnings,
      selectedNodeIds: input.selectedNodeIds ?? [],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Assistant request failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  return {
    mode: data.mode ?? 'answer',
    message: data.message ?? '',
    operations: Array.isArray(data.operations) ? data.operations : [],
    focusNodeIds: Array.isArray(data.focusNodeIds)
      ? data.focusNodeIds.filter((x: unknown): x is string => typeof x === 'string')
      : [],
  }
}
