import { useState } from 'react'
import { describePlainDelta } from '../../../lib/reconcile/describePlain'
import type { Delta, DeltaResult } from '../../../lib/deltas/schema'

/**
 * Blume — "Your changes".
 *
 * The running record of everywhere this clinic differs from the guideline,
 * one plain sentence each. COLLAPSED BY DEFAULT: during the interview it is
 * a data feed sitting next to a question, and the place it genuinely belongs
 * is the closing screen. One click opens it for anyone who wants to look.
 */

const NEEDS_ATTENTION = new Set(['stale_unresolved', 'stale_ambiguous', 'stale_conflict', 'error'])

export default function ChangesRail({
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
  const [open, setOpen] = useState(false)
  const resultOf = new Map(results.map((r) => [r.deltaId, r]))
  const ordered = [...deltas].sort((a, b) => a.seq - b.seq)
  const live = ordered.filter((d) => {
    const status = resultOf.get(d.id)?.status ?? d.status
    return status !== 'dismissed' && status !== 'superseded'
  })

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-full w-11 shrink-0 flex-col items-center gap-3 border-l border-line bg-canvas py-4 text-muted hover:text-ink"
        title="Everything you've changed so far"
      >
        <span className="text-[13px] font-semibold text-accent-strong">{live.length}</span>
        <span className="text-[11.5px] font-medium [writing-mode:vertical-rl]">Your changes</span>
      </button>
    )
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-line bg-canvas">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-ink">Your changes</h2>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
            Everywhere your clinic differs from the guideline.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-[13px] text-muted hover:text-ink" title="Hide">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {live.length === 0 ? (
          <p className="px-1 py-3 text-[12px] leading-relaxed text-muted">
            Nothing yet — you've agreed with the guideline so far.
          </p>
        ) : (
          <ul className="space-y-2">
            {live.map((d) => {
              const result = resultOf.get(d.id)
              const status = result?.status ?? d.status
              const attention = NEEDS_ATTENTION.has(status)
              return (
                <li key={d.id} className="rounded-lg border border-line bg-bg px-3 py-2">
                  <p className="text-[12px] leading-snug text-ink">{describePlainDelta(d)}</p>
                  {attention && (
                    <p className="mt-1 text-[11px] leading-snug text-danger">
                      The guideline changed underneath this one — it needs another look.
                    </p>
                  )}
                  <button
                    onClick={() => onUndo(d.id)}
                    disabled={busy}
                    className="mt-1.5 text-[11px] text-muted hover:text-danger disabled:opacity-50"
                  >
                    Undo this
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
