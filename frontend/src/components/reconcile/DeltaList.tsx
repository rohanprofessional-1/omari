import { describeDelta } from '../../lib/deltas/describe'
import type { Delta, DeltaResult } from '../../lib/deltas/schema'

/**
 * Blume — the persistent delta review rail.
 *
 * Every clinic decision made in the Reconcile session, one readable sentence
 * each, newest last. This list IS the clinic's deviation register — it's what
 * the surgeon reviews at sign-off. Per-delta undo deletes the delta and
 * recompiles; nothing is edited in place silently.
 */

const STATUS_STYLE: Record<string, string> = {
  applied: 'bg-accent/10 text-accent-strong',
  active: 'bg-accent/10 text-accent-strong',
  stale_unresolved: 'bg-danger/10 text-danger',
  stale_ambiguous: 'bg-danger/10 text-danger',
  stale_conflict: 'bg-danger/10 text-danger',
  superseded: 'bg-line/60 text-muted',
  dismissed: 'bg-line/60 text-muted',
  error: 'bg-danger/10 text-danger',
}

const STATUS_LABEL: Record<string, string> = {
  applied: 'applied',
  stale_unresolved: 'needs re-review',
  stale_ambiguous: 'ambiguous',
  stale_conflict: 'CPG changed',
  superseded: 'superseded',
  dismissed: 'dismissed',
  error: 'error',
}

export default function DeltaList({
  deltas,
  results,
  onUndo,
  busy,
}: {
  deltas: Delta[]
  results: DeltaResult[]
  onUndo: (deltaId: string) => void
  busy: boolean
}) {
  const resultOf = new Map(results.map((r) => [r.deltaId, r]))
  const ordered = [...deltas].sort((a, b) => a.seq - b.seq)

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-line bg-canvas">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-display text-[13px] font-semibold text-ink">Clinic decisions</h2>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
          Every change this clinic has made to the guideline tree. This list is your sign-off record.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {ordered.length === 0 ? (
          <p className="px-1 py-3 text-[12px] text-muted">
            No decisions yet — map your first endpoints on the left.
          </p>
        ) : (
          <ul className="space-y-2">
            {ordered.map((d) => {
              const r = resultOf.get(d.id)
              const status = r?.status ?? d.status
              return (
                <li key={d.id} className="rounded-lg border border-line bg-bg px-3 py-2">
                  <p className="text-[12px] leading-snug text-ink">{describeDelta(d)}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${STATUS_STYLE[status] ?? ''}`}
                      title={r?.reason}
                    >
                      {STATUS_LABEL[status] ?? status}
                    </span>
                    <button
                      onClick={() => onUndo(d.id)}
                      disabled={busy}
                      className="text-[11px] text-muted hover:text-danger disabled:opacity-50"
                    >
                      undo
                    </button>
                  </div>
                  {r?.reason && status.startsWith('stale') && (
                    <p className="mt-1 text-[11px] leading-snug text-danger/90">{r.reason}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
