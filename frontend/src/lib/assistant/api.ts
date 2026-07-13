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
  return normalizeResponse(data)
}

function normalizeResponse(data: any): TreeChatResponse {
  return {
    mode: data.mode ?? 'answer',
    message: data.message ?? '',
    operations: Array.isArray(data.operations) ? data.operations : [],
    focusNodeIds: Array.isArray(data.focusNodeIds)
      ? data.focusNodeIds.filter((x: unknown): x is string => typeof x === 'string')
      : [],
  }
}

/**
 * Streaming variant: `onDelta` receives reply-text increments as the model
 * generates; resolves with the SAME final payload as sendTreeChat. Throws on
 * any stream problem — callers fall back to the non-streaming endpoint.
 */
export async function sendTreeChatStream(
  input: Parameters<typeof sendTreeChat>[0],
  onDelta: (text: string) => void,
): Promise<TreeChatResponse> {
  const res = await fetch('/api/v1/assistant/tree-chat/stream', {
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
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Assistant stream failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let done: TreeChatResponse | null = null
  for (;;) {
    const { value, done: eof } = await reader.read()
    if (eof) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const evt = JSON.parse(line.slice(6))
      if (evt.type === 'delta' && typeof evt.text === 'string') onDelta(evt.text)
      else if (evt.type === 'done') done = normalizeResponse(evt)
      else if (evt.type === 'error') throw new Error(evt.detail ?? 'assistant stream error')
    }
  }
  if (!done) throw new Error('Assistant stream ended without a result.')
  return done
}
