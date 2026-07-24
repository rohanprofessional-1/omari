import { useEffect, useMemo, useState } from 'react'
import { getReferralSource } from '../../data/adapter'
import { useDashboardStore } from '../../lib/reviewStore'
import { buildWorkupEntries, type WorkupEntry } from '../../lib/workupMerge'
import WarningIcon from '../shared/WarningIcon'
import WorkupRow from './WorkupRow'
import type { ReviewableReferral } from '../../types'

/**
 * Workup tracking — the core value claim on one screen: approved referrals do
 * not fall through the cracks before the visit. Two strata sorted by risk:
 * AT RISK (visit approaching, tests not back) shouts at the top; ON TRACK sits
 * calm below; fully-complete referrals collapse into a strip at the bottom.
 * Population + merge + stratification live in lib/workupMerge (shared with
 * the detail screen's WorkupList), so status changes restratify live.
 */

function StratumHeader({
  tone,
  label,
  count,
  hint,
}: {
  tone: 'danger' | 'calm'
  label: string
  count: number
  hint: string
}) {
  return (
    <div className="flex items-baseline gap-2">
      <h2
        className={`flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] ${
          tone === 'danger' ? 'text-danger' : 'text-ink'
        }`}
      >
        {tone === 'danger' && <WarningIcon />}
        {label} <span className="font-normal opacity-70">({count})</span>
      </h2>
      <p className="min-w-0 truncate text-[11px] text-muted">{hint}</p>
    </div>
  )
}

export default function WorkupScreen({ onOpen }: { onOpen: (referralId: string) => void }) {
  const { reviews, workupOverrides } = useDashboardStore()
  const [referrals, setReferrals] = useState<ReviewableReferral[] | null>(null)
  const [destination, setDestination] = useState('any')
  const [showComplete, setShowComplete] = useState(false)

  useEffect(() => {
    let cancelled = false
    getReferralSource()
      .listReferrals()
      .then((rows) => {
        if (!cancelled) setReferrals(rows)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* Stratify (store-driven: advancing a status re-runs this memo live). */
  const strata = useMemo(
    () => buildWorkupEntries(referrals ?? [], reviews, workupOverrides),
    [referrals, reviews, workupOverrides],
  )

  const destinations = useMemo(() => {
    const names = new Set<string>()
    for (const entry of [...strata.atRisk, ...strata.onTrack, ...strata.complete]) {
      names.add(entry.destination)
    }
    return [...names].sort()
  }, [strata])

  const matches = (entry: WorkupEntry) => destination === 'any' || entry.destination === destination
  const atRisk = strata.atRisk.filter(matches)
  const onTrack = strata.onTrack.filter(matches)
  const complete = strata.complete.filter(matches)

  if (!referrals) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-2 h-20 animate-pulse rounded-xl bg-line/50" />
        ))}
      </div>
    )
  }

  const total = atRisk.length + onTrack.length + complete.length
  const populationEmpty =
    strata.atRisk.length + strata.onTrack.length + strata.complete.length === 0

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      {/* Filters + count summary */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Destination
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[12px] text-ink"
          >
            <option value="any">Any specialist</option>
            {destinations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={showComplete}
            onChange={(e) => setShowComplete(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-accent-strong)]"
          />
          Show complete
        </label>
        <p className="ml-auto text-[12px] tabular-nums text-muted">
          <span className={atRisk.length > 0 ? 'font-semibold text-danger' : ''}>
            {atRisk.length} at risk
          </span>{' '}
          · {onTrack.length} on track · {complete.length} complete
        </p>
      </div>

      {/* Empty states */}
      {populationEmpty ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted">
          No approved referrals with outstanding workup. Approve referrals in the queue to see them
          here.
        </p>
      ) : total === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted">
          No referrals match the current filters.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {/* AT RISK — unmistakable */}
          {atRisk.length > 0 && (
            <section className="space-y-2">
              <StratumHeader
                tone="danger"
                label="At risk"
                count={atRisk.length}
                hint="Visit approaching with tests not yet back — chase these first"
              />
              {atRisk.map((entry) => (
                <WorkupRow key={entry.referral.payload.referralId} entry={entry} onOpen={onOpen} />
              ))}
            </section>
          )}

          {/* ON TRACK — calm */}
          {onTrack.length > 0 && (
            <section className="space-y-2">
              <StratumHeader
                tone="calm"
                label="On track"
                count={onTrack.length}
                hint="Everything outstanding still has room before the visit"
              />
              {onTrack.map((entry) => (
                <WorkupRow key={entry.referral.payload.referralId} entry={entry} onOpen={onOpen} />
              ))}
            </section>
          )}

          {atRisk.length === 0 && onTrack.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-muted">
              Nothing outstanding — every tracked workup is complete.
            </p>
          )}

          {/* COMPLETE — collapsed strip */}
          {complete.length > 0 && (
            <section className="border-t border-line pt-2">
              <button
                onClick={() => setShowComplete((v) => !v)}
                aria-expanded={showComplete}
                className="flex w-full items-center gap-2 py-1 text-left text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted hover:text-ink"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className={`transition-transform ${showComplete ? 'rotate-90' : ''}`}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                Complete ({complete.length})
              </button>
              {showComplete && (
                <div className="mt-2 space-y-2">
                  {complete.map((entry) => (
                    <WorkupRow
                      key={entry.referral.payload.referralId}
                      entry={entry}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
