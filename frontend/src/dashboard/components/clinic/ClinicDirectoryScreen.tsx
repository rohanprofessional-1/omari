import { useEffect, useMemo, useState } from 'react'
import { getReferralSource } from '../../data/adapter'
import { capacityFor } from '../../data/capacityMock'
import { DEMO_NOW } from '../../lib/demoClock'
import { caseloadFor, loadRoster, type RosterEntry } from '../../lib/roster'
import { useDashboardStore } from '../../lib/reviewStore'
import { useTreeLibrary } from '../../../lib/treeLibrary'
import type { ReviewableReferral } from '../../types'
import SignalDot from '../shared/SignalDot'
import StatChip from '../shared/StatChip'
import { TABLE_CARD, TABLE_HEAD, TABLE_ROW } from '../shared/tableChrome'
import ClinicTreePanel from './ClinicTreePanel'

/** One column template, shared by the header and every row so they can't drift. */
const GRID =
  'grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_minmax(0,1.5fr)] items-center gap-3'

/**
 * Clinic directory — who is in the clinic and what each of them is carrying.
 *
 * Four blocks: a clinic-level stats strip, the specialist list with caseload,
 * a capacity column, and which tree routes to each person.
 *
 * Everything except contact details is derived from data already on the client
 * (the compiled tree + the referral fixtures + the review store), so the screen
 * is fully useful with the backend down.
 */

/** Hours a referral has been waiting, against the pinned demo clock. */
function hoursWaiting(receivedAt: string): number {
  return (DEMO_NOW.getTime() - new Date(receivedAt).getTime()) / 36e5
}

export default function ClinicDirectoryScreen() {
  const { reviews } = useDashboardStore()
  const treeLibrary = useTreeLibrary()
  const { activeTree, loadingList, loadingTree } = treeLibrary
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  const [referrals, setReferrals] = useState<ReviewableReferral[] | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!activeTree && !loadingTree && !loadingList) {
        // Only fetch if we at least resolved the library (even if no tree).
        Promise.all([Promise.resolve([]), getReferralSource().listReferrals()]).then(([r, refs]) => {
            if (cancelled) return
            setRoster(r)
            setReferrals(refs)
          })
        return
    }
    if (!activeTree) return
    
    // The directory is a clinic-wide view — deliberately unscoped.
    Promise.all([loadRoster(activeTree), getReferralSource().listReferrals()]).then(([r, refs]) => {
      if (cancelled) return
      setRoster(r)
      setReferrals(refs)
    })
    return () => {
      cancelled = true
    }
  }, [activeTree, loadingList, loadingTree])

  const stats = useMemo(() => {
    if (!referrals) return null
    let pending = 0
    let escalated = 0
    let decided = 0
    let routed = 0
    let waitTotal = 0
    for (const r of referrals) {
      const status = reviews[r.payload.referralId]?.status ?? 'pending'
      if (status === 'pending') pending += 1
      else decided += 1
      if (status === 'escalated' || r.result.escalated) escalated += 1
      if (r.result.routedTo) routed += 1
      waitTotal += hoursWaiting(r.payload.receivedAt)
    }
    return {
      total: referrals.length,
      pending,
      decided,
      escalated,
      routed,
      avgWaitHours: referrals.length ? Math.round(waitTotal / referrals.length) : 0,
    }
  }, [referrals, reviews])

  if (!roster || !referrals || !stats || loadingList || loadingTree) {
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

  return (
    <div className="min-h-full bg-dash-bg">
      <div className="mx-auto w-full max-w-dash-page px-6 pb-12 pt-4">
        {/* ── Block 1 · Clinic stats ─────────────────────────────────────── */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatChip count={stats.total} label="referrals" />
          <StatChip count={stats.pending} label="awaiting review" tone="amber" />
          <StatChip count={stats.decided} label="decided" tone="green" />
          <StatChip count={stats.escalated} label="escalated" tone="red" />
          <StatChip count={stats.avgWaitHours} label="avg hours waiting" />
          {/* The tree is named once, in the panel at the bottom. */}
          <p className="ml-auto text-dash-micro text-dash-muted">
            {roster.length} routable destinations
          </p>
        </div>

        {/* ── Blocks 2–4 · Specialist, caseload, capacity, routed by ─────── */}
        <div className={TABLE_CARD}>
          <div className={`${GRID} ${TABLE_HEAD}`}>
            {['Specialist', 'Caseload', 'Capacity'].map((h) => (
              <span key={h} className="truncate">
                {h}
              </span>
            ))}
          </div>

          {roster.map((entry) => {
            const load = caseloadFor(entry.name, referrals, reviews)
            const cap = capacityFor(entry.name)
            return (
              <div key={entry.name} className={`${GRID} ${TABLE_ROW}`}>
                {/* Specialist */}
                <div className="min-w-0">
                  <p className="truncate text-dash-row text-dash-ink">{entry.name}</p>
                  <p className="truncate text-dash-micro text-dash-muted">{entry.specialty}</p>
                  {entry.email && (
                    <p className="truncate text-dash-micro text-dash-faint">{entry.email}</p>
                  )}
                </div>

                {/* Caseload */}
                <div className="min-w-0">
                  {load.total === 0 ? (
                    <span className="text-dash-micro text-dash-faint">No referrals yet</span>
                  ) : (
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-dash-body font-semibold tabular-nums text-dash-ink">
                        {load.total}
                        <span className="ml-1 text-dash-micro font-normal text-dash-muted">
                          active
                        </span>
                      </span>
                      {load.pending > 0 && (
                        <span className="flex items-center gap-1.5 text-dash-micro tabular-nums text-dash-ink">
                          <SignalDot tone="amber" />
                          {load.pending} pending
                        </span>
                      )}
                      {load.escalated > 0 && (
                        <span className="flex items-center gap-1.5 text-dash-micro tabular-nums text-dash-ink">
                          <SignalDot tone="red" />
                          {load.escalated} escalated
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Capacity — invented; see data/capacityMock.ts */}
                <div className="min-w-0">
                  <p className="truncate text-dash-micro text-dash-strong">
                    {cap.clinicDays.join(' · ')}
                    <span className="tabular-nums text-dash-muted"> · {cap.slotsPerWeek}/wk</span>
                  </p>
                  <p className="truncate text-dash-micro text-dash-muted">
                    {cap.acceptingNew ? 'Next open ' : 'Booked out to '}
                    {cap.nextAvailableLabel}
                  </p>
                </div>

              </div>
            )
          })}
        </div>

        {/* Every row used to carry a "Routed by" column naming the same tree
            nine times. It is named once, here, with the library behind it. */}
        <ClinicTreePanel destinations={roster.length} routed={stats.routed} library={treeLibrary} />
      </div>
    </div>
  )
}
