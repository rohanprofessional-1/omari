import { useEffect, useMemo, useState } from 'react'
import { useDashboardStore } from '../../lib/reviewStore'
import { buildWorkupEntries, type WorkupEntry } from '../../lib/workupMerge'
import WorkupRow from './WorkupRow'
import type { ReviewableReferral } from '../../types'
import { useOpenReferral } from '../../lib/useOpenReferral'
import { useAuth } from '../../../auth/authStore'
import { filterForUser, listForUser } from '../../lib/scope'
import SectionBand, { type BandTone } from '../shared/SectionBand'

/**
 * Workup tracking — the core value claim on one screen: approved referrals do
 * not fall through the cracks before the visit. Two strata sorted by risk:
 * AT RISK (visit approaching, tests not back) leads at the top; ON TRACK sits
 * calm below; fully-complete referrals collapse into a strip at the bottom.
 * Population + merge + stratification live in lib/workupMerge (shared with
 * the detail screen's WorkupList), so status changes restratify live.
 *
 * Each stratum is its OWN card under a pinned band — the same grouping idiom
 * as the queue's tiers and the surgeon's sections, so all three tabs are read
 * the same way. The band names the stratum once; the rows below it stop
 * repeating that name at themselves.
 */

/** Each stratum is its own card, banded like the queue's tiers. */
const STRATUM_CARD =
  'rounded-dash-card border border-dash-line-strong bg-dash-surface shadow-dash-card [&>article:last-child]:border-b-0 [&>article:last-child]:rounded-b-dash-card'

type Stratum = 'at-risk' | 'on-track' | 'complete'

const STRATUM_TONES: Record<Stratum, BandTone> = {
  'at-risk': 'amber',
  'on-track': 'green',
  complete: 'neutral',
}

const STRATUM_LABELS: Record<Stratum, string> = {
  'at-risk': 'At risk',
  'on-track': 'On track',
  complete: 'Complete',
}

/** Stable anchor id so the summary strip can jump straight to a stratum. */
const stratumAnchor = (stratum: Stratum) => `workup-${stratum}`

/**
 * The whole screen in one line, above the fold — and each count jumps to its
 * stratum. These used to be inert chips saying the same numbers the bands
 * already carry; now they are the navigation for a screen that is mostly
 * below the fold.
 */
function StratumSummary({ counts }: { counts: Record<Stratum, number> }) {
  const jump = (stratum: Stratum) =>
    document.getElementById(stratumAnchor(stratum))?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

  const DOTS: Record<Stratum, string> = {
    'at-risk': 'bg-dash-amber',
    'on-track': 'bg-dash-green',
    complete: 'bg-dash-faint',
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(STRATUM_LABELS) as Stratum[]).map((stratum) => (
        <button
          key={stratum}
          type="button"
          disabled={counts[stratum] === 0}
          onClick={() => jump(stratum)}
          title={counts[stratum] === 0 ? undefined : `Jump to ${STRATUM_LABELS[stratum]}`}
          className="inline-flex items-center gap-2 rounded-dash-ctl border border-dash-line-strong bg-dash-surface px-2 py-1 transition-colors enabled:hover:border-dash-faint disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent"
        >
          <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[stratum]}`} />
          <span className="text-dash-micro text-dash-muted">{STRATUM_LABELS[stratum]}</span>
          <span className="text-dash-micro font-semibold tabular-nums text-dash-ink">
            {counts[stratum]}
          </span>
        </button>
      ))}
    </div>
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
      <div className="mx-auto w-full max-w-dash-page px-6 pb-12 pt-4">
        {/* Toolbar — what you're filtering by, and where everything is */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-dash-micro text-dash-muted">
            Destination
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="rounded-dash-ctl border border-dash-line-strong bg-dash-surface px-2 py-1 text-dash-micro text-dash-ink"
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
          <div className="ml-auto">
            <StratumSummary
              counts={{
                'at-risk': atRisk.length,
                'on-track': onTrack.length,
                complete: complete.length,
              }}
            />
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
          <div className="space-y-3">
            {/* AT RISK — calm but unmistakable */}
            {atRisk.length > 0 && (
              <section id={stratumAnchor('at-risk')} className={STRATUM_CARD}>
                <SectionBand
                  tone={STRATUM_TONES['at-risk']}
                  label={STRATUM_LABELS['at-risk']}
                  count={atRisk.length}
                  hint="Visit approaching with tests not yet back — chase these first"
                  stickyTop={0}
                />
                {atRisk.map((entry) => (
                  <WorkupRow key={entry.referral.payload.referralId} entry={entry} onOpen={onOpen} />
                ))}
              </section>
            )}

            {/* ON TRACK — calm */}
            {onTrack.length > 0 && (
              <section id={stratumAnchor('on-track')} className={STRATUM_CARD}>
                <SectionBand
                  tone={STRATUM_TONES['on-track']}
                  label={STRATUM_LABELS['on-track']}
                  count={onTrack.length}
                  hint="Everything outstanding still has room before the visit"
                  stickyTop={0}
                />
                {onTrack.map((entry) => (
                  <WorkupRow key={entry.referral.payload.referralId} entry={entry} onOpen={onOpen} />
                ))}
              </section>
            )}

            {atRisk.length === 0 && onTrack.length === 0 && (
              <p className="px-4 py-6 text-center text-dash-body text-dash-muted">
                Nothing outstanding — every tracked workup is complete.
              </p>
            )}

            {/* COMPLETE — collapsed behind its own band */}
            {complete.length > 0 && (
              <section id={stratumAnchor('complete')} className={STRATUM_CARD}>
                <SectionBand
                  tone={STRATUM_TONES.complete}
                  label={STRATUM_LABELS.complete}
                  count={complete.length}
                  hint="Every test back — nothing left to chase before the visit"
                  open={showComplete}
                  onToggle={() => setShowComplete((v) => !v)}
                  stickyTop={0}
                />
                {showComplete &&
                  complete.map((entry) => (
                    <WorkupRow
                      key={entry.referral.payload.referralId}
                      entry={entry}
                      onOpen={onOpen}
                    />
                  ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
