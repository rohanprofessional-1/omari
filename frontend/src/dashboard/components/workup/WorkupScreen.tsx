import { useEffect, useMemo, useState } from 'react'
import { useDashboardStore } from '../../lib/reviewStore'
import { buildWorkupEntries, type WorkupEntry } from '../../lib/workupMerge'
import WorkupRow from './WorkupRow'
import type { ReviewableReferral } from '../../types'
import { useOpenReferral } from '../../lib/useOpenReferral'
import { useAuth } from '../../../auth/authStore'
import { filterForUser, listForUser } from '../../lib/scope'
import StatChip from '../shared/StatChip'

/**
 * Workup tracking — the core value claim on one screen: approved referrals do
 * not fall through the cracks before the visit. Two strata sorted by risk:
 * AT RISK (visit approaching, tests not back) leads at the top; ON TRACK sits
 * calm below; fully-complete referrals collapse into a strip at the bottom.
 * Population + merge + stratification live in lib/workupMerge (shared with
 * the detail screen's WorkupList), so status changes restratify live.
 */

/** Band-header idiom shared with the queue: dot · label · count · explainer. */
function StratumHeader({
  tone,
  label,
  count,
  hint,
}: {
  tone: 'amber' | 'green'
  label: string
  count: number
  hint: string
}) {
  return (
    <header className="mb-2 flex items-center gap-2">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === 'amber' ? 'bg-dash-amber' : 'bg-dash-green'
        }`}
      />
      <h2 className="text-dash-band uppercase text-dash-strong">{label}</h2>
      <span className="text-dash-band tabular-nums text-dash-faint">{count}</span>
      <p className="hidden min-w-0 truncate text-dash-micro text-dash-faint md:block">{hint}</p>
    </header>
  )
}

export default function WorkupScreen() {
  const onOpen = useOpenReferral()
  const { reviews, workupOverrides } = useDashboardStore()
  const { user } = useAuth()
  const [fetched, setReferrals] = useState<ReviewableReferral[] | null>(null)
  const [destination, setDestination] = useState('any')
  const [showComplete, setShowComplete] = useState(false)

  useEffect(() => {
    let cancelled = false
    listForUser(user).then((rows) => {
      if (!cancelled) setReferrals(rows)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  // A destination CORRECTION can move a referral to or from this surgeon, and
  // the adapter can't see corrections — so narrow here, on every render, rather
  // than refetching each time someone reviews something.
  const referrals = useMemo(
    () => (fetched === null ? null : filterForUser(fetched, reviews, user)),
    [fetched, reviews, user],
  )

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
      <div className="min-h-full bg-dash-bg">
        <div className="mx-auto w-full max-w-dash-page p-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="mb-3 h-24 animate-pulse rounded-dash-card bg-dash-line/60 motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    )
  }

  const total = atRisk.length + onTrack.length + complete.length
  const populationEmpty =
    strata.atRisk.length + strata.onTrack.length + strata.complete.length === 0

  return (
    <div className="min-h-full bg-dash-bg">
      <div className="mx-auto w-full max-w-dash-page p-6">
        {/* Filters + count summary */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-dash-micro text-dash-muted">
            Destination
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="rounded-dash-ctl border border-dash-line bg-dash-surface px-2 py-1 text-dash-micro text-dash-ink"
            >
              <option value="any">Any specialist</option>
              {destinations.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-dash-micro text-dash-muted">
            <input
              type="checkbox"
              checked={showComplete}
              onChange={(e) => setShowComplete(e.target.checked)}
              className="h-4 w-4 accent-dash-accent-strong"
            />
            Show complete
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <StatChip
              count={atRisk.length}
              label="at risk"
              tone={atRisk.length > 0 ? 'amber' : 'neutral'}
            />
            <StatChip count={onTrack.length} label="on track" tone="neutral" />
            <StatChip count={complete.length} label="complete" tone="green" />
          </div>
        </div>

        {/* Empty states */}
        {populationEmpty ? (
          <p className="px-4 py-12 text-center text-dash-body text-dash-muted">
            No approved referrals with outstanding workup. Approve referrals in the queue to see
            them here.
          </p>
        ) : total === 0 ? (
          <p className="px-4 py-12 text-center text-dash-body text-dash-muted">
            No referrals match the current filters.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {/* AT RISK — calm but unmistakable */}
            {atRisk.length > 0 && (
              <section>
                <StratumHeader
                  tone="amber"
                  label="At risk"
                  count={atRisk.length}
                  hint="Visit approaching with tests not yet back — chase these first"
                />
                <div className="space-y-3">
                  {atRisk.map((entry) => (
                    <WorkupRow key={entry.referral.payload.referralId} entry={entry} onOpen={onOpen} />
                  ))}
                </div>
              </section>
            )}

            {/* ON TRACK — calm */}
            {onTrack.length > 0 && (
              <section>
                <StratumHeader
                  tone="green"
                  label="On track"
                  count={onTrack.length}
                  hint="Everything outstanding still has room before the visit"
                />
                <div className="space-y-3">
                  {onTrack.map((entry) => (
                    <WorkupRow key={entry.referral.payload.referralId} entry={entry} onOpen={onOpen} />
                  ))}
                </div>
              </section>
            )}

            {atRisk.length === 0 && onTrack.length === 0 && (
              <p className="px-4 py-6 text-center text-dash-body text-dash-muted">
                Nothing outstanding — every tracked workup is complete.
              </p>
            )}

            {/* COMPLETE — collapsed strip */}
            {complete.length > 0 && (
              <section className="border-t border-dash-line pt-2">
                <button
                  onClick={() => setShowComplete((v) => !v)}
                  aria-expanded={showComplete}
                  className="flex w-full items-center gap-2 py-1 text-left text-dash-band uppercase text-dash-muted transition-colors hover:text-dash-ink"
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
                    className={`transition-transform motion-reduce:transition-none ${showComplete ? 'rotate-90' : ''}`}
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  Complete ({complete.length})
                </button>
                {showComplete && (
                  <div className="mt-2 space-y-3">
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
    </div>
  )
}
