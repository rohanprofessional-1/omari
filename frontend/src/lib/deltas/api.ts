import type { Tree } from '../../types/tree'
import { DeltaSchema, type Delta, type DeltaResult } from './schema'

/**
 * Blume — delta layer REST client (mirrors lib/api.ts conventions).
 *
 * Deltas persist server-side in tree_deltas, separate from the compiled
 * tree rows. The compiler runs in the frontend; `reconcileTree` saves a
 * compiled tree together with the compile's per-delta verdicts in one
 * transaction.
 */

const API_BASE = '/api/v1'

/** A delta as the server returns it (DeltaRead). */
interface ServerDelta {
  id: string
  tree_id: string
  seq: number
  op: string
  payload: Record<string, unknown>
  expected?: Record<string, unknown> | null
  provenance: Record<string, unknown>
  specialist_id?: string | null
  status: string
  stale_reason?: string | null
  base_hash?: string | null
  created_at: string
  updated_at: string
}

/** Server row → the compiler's Delta shape (Zod-validated). */
function toDelta(row: ServerDelta): Delta {
  return DeltaSchema.parse({
    id: row.id,
    seq: row.seq,
    payload: row.payload,
    expected: row.expected ?? undefined,
    provenance: row.provenance,
    status: row.status,
    baseHash: row.base_hash ?? undefined,
  })
}

export interface DeltaDraft {
  payload: Delta['payload']
  expected?: unknown
  provenance?: Partial<Delta['provenance']>
  specialistId?: string
  baseHash?: string
}

export async function listDeltas(treeId: string): Promise<Delta[]> {
  const res = await fetch(`${API_BASE}/trees/${treeId}/deltas`)
  if (!res.ok) throw new Error(`Failed to load deltas: ${await res.text()}`)
  const rows: ServerDelta[] = await res.json()
  return rows.map(toDelta)
}

/** Create one delta or a bulk batch (a session stage saves in one call). */
export async function createDeltas(treeId: string, drafts: DeltaDraft[]): Promise<Delta[]> {
  const body = drafts.map((d) => ({
    op: d.payload.op,
    payload: d.payload,
    expected: d.expected,
    provenance: d.provenance ?? {},
    specialist_id: d.specialistId,
    base_hash: d.baseHash,
  }))
  const res = await fetch(`${API_BASE}/trees/${treeId}/deltas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Failed to save deltas: ${await res.text()}`)
  const rows: ServerDelta[] = await res.json()
  return rows.map(toDelta)
}

export async function updateDelta(
  treeId: string,
  deltaId: string,
  patch: Partial<{ payload: Delta['payload']; seq: number; provenance: Delta['provenance']; status: Delta['status']; staleReason: string }>,
): Promise<Delta> {
  const res = await fetch(`${API_BASE}/trees/${treeId}/deltas/${deltaId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: patch.payload,
      seq: patch.seq,
      provenance: patch.provenance,
      status: patch.status,
      stale_reason: patch.staleReason,
    }),
  })
  if (!res.ok) throw new Error(`Failed to update delta: ${await res.text()}`)
  return toDelta(await res.json())
}

/** Hard delete — per-delta undo in the review rail. */
export async function deleteDelta(treeId: string, deltaId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/trees/${treeId}/deltas/${deltaId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) throw new Error('Failed to delete delta')
}

/** The raw CPG scaffold this tree compiles from, plus anchoring metadata. */
export async function fetchTreeBase(
  treeId: string,
): Promise<{ baseTree: unknown | null; baseMeta: { docId?: string; documentName?: string; sections?: string[] } | null }> {
  const res = await fetch(`${API_BASE}/trees/${treeId}/base`)
  if (!res.ok) throw new Error(`Failed to load base tree: ${await res.text()}`)
  return res.json()
}

/** Compile-result status → persisted delta status ('applied' stays active;
 *  'error' stays active but records why, so it resurfaces next session). */
function persistedStatus(r: DeltaResult): { status: string; stale_reason?: string } {
  if (r.status === 'applied') return { status: 'active' }
  if (r.status === 'error') return { status: 'active', stale_reason: r.reason ?? 'compile error' }
  return { status: r.status, ...(r.reason ? { stale_reason: r.reason } : {}) }
}

/** Save a compiled tree + the compile's per-delta verdicts, transactionally. */
export async function reconcileTree(
  treeId: string,
  compiled: Tree,
  results: DeltaResult[],
  opts: { name?: string; description?: string; baseHash?: string } = {},
): Promise<Delta[]> {
  const res = await fetch(`${API_BASE}/trees/${treeId}/reconcile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tree: {
        name: opts.name,
        description: opts.description,
        rootNodeId: compiled.rootNodeId,
        nodes: compiled.nodes,
      },
      base_hash: opts.baseHash,
      delta_results: results.map((r) => ({ delta_id: r.deltaId, ...persistedStatus(r) })),
    }),
  })
  if (!res.ok) throw new Error(`Failed to reconcile tree: ${await res.text()}`)
  const rows: ServerDelta[] = await res.json()
  return rows.map(toDelta)
}
