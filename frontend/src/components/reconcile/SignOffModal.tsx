import { useState } from 'react'
import { describeDelta } from '../../lib/deltas/describe'
import type { Delta, DeltaResult } from '../../lib/deltas/schema'

/**
 * Blume — sign-off (publish) from the Reconcile session.
 *
 * The delta list IS the deviation register: before signing, the surgeon
 * reviews every clinic decision in one place, with guideline deviations
 * called out. Unresolved (stale) decisions are a hard stop — a tree is
 * published with every decision explicitly applied or dismissed, never
 * with silently-skipped ones.
 */

export default function SignOffModal({
  deltas,
  results,
  busy,
  onPublish,
  onClose,
}: {
  deltas: Delta[]
  results: DeltaResult[]
  busy: boolean
  onPublish: (signedBy: string) => void
  onClose: () => void
}) {
  const [signedBy, setSignedBy] = useState('')
  const resultOf = new Map(results.map((r) => [r.deltaId, r]))
  const ordered = [...deltas].sort((a, b) => a.seq - b.seq)
  const applied = ordered.filter((d) => resultOf.get(d.id)?.status === 'applied')
  const stale = ordered.filter((d) => (resultOf.get(d.id)?.status ?? '').startsWith('stale'))
  const deviations = applied.filter((d) => d.provenance.deviatesFromCpg)

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/30 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="font-serif text-[17px] font-semibold text-ink">Sign off &amp; publish</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {applied.length} clinic decision{applied.length === 1 ? '' : 's'} on top of the guideline
            {deviations.length > 0 && (
              <>
                {' '}
                · <span className="font-medium text-danger">{deviations.length} deviate{deviations.length === 1 ? 's' : ''} from the CPG</span>
              </>
            )}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {stale.length > 0 && (
            <div className="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">
              {stale.length} decision{stale.length === 1 ? '' : 's'} became stale when the guideline changed and
              {stale.length === 1 ? ' has' : ' have'} not been re-reviewed. Resolve (redo or undo) them in the
              rail before signing.
            </div>
          )}
          {ordered.length === 0 ? (
            <p className="text-[13px] text-muted">
              No clinic decisions yet — publishing would sign the guideline scaffold as-is.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {ordered.map((d) => {
                const status = resultOf.get(d.id)?.status ?? d.status
                if (status === 'dismissed' || status === 'superseded') return null
                return (
                  <li key={d.id} className="text-[12.5px] leading-snug text-ink">
                    · {describeDelta(d)}
                    {status.startsWith('stale') && <span className="ml-1.5 text-[11px] font-medium text-danger">(stale)</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/60"
              placeholder="Signing surgeon's name"
              value={signedBy}
              onChange={(e) => setSignedBy(e.target.value)}
            />
            <button
              onClick={() => onPublish(signedBy.trim())}
              disabled={busy || !signedBy.trim() || stale.length > 0}
              title={stale.length > 0 ? 'Resolve stale decisions first' : undefined}
              className="rounded-md bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Publish signed version
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            Publishing snapshots the compiled tree immutably; this decision list is recorded with it.
          </p>
        </div>
      </div>
    </div>
  )
}
