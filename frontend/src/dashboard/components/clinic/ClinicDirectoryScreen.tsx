import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getReferralSource } from '../../data/adapter'
import { capacityFor } from '../../data/capacityMock'
import { DEMO_NOW } from '../../lib/demoClock'
import { DEPLOYED_TREE_LABEL, caseloadFor, loadRoster, type RosterEntry } from '../../lib/roster'
import { useDashboardStore } from '../../lib/reviewStore'
import type { ReviewableReferral } from '../../types'
import StatChip from '../shared/StatChip'

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
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  const [referrals, setReferrals] = useState<ReviewableReferral[] | null>(null)

  useEffect(() => {
    let cancelled = false
    // The directory is a clinic-wide view — deliberately unscoped.
    Promise.all([loadRoster(), getReferralSource().listReferrals()]).then(([r, refs]) => {
      if (cancelled) return
      setRoster(r)
      setReferrals(refs)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    if (!referrals) return null
    let pending = 0
    let escalated = 0
    let decided = 0
    let waitTotal = 0
    for (const r of referrals) {
      const status = reviews[r.payload.referralId]?.status ?? 'pending'
      if (status === 'pending') pending += 1
      else decided += 1
      if (status === 'escalated' || r.result.escalated) escalated += 1
      waitTotal += hoursWaiting(r.payload.receivedAt)
    }
    return {
      total: referrals.length,
      pending,
      decided,
      escalated,
      avgWaitHours: referrals.length ? Math.round(waitTotal / referrals.length) : 0,
    }
  }, [referrals, reviews])

  if (!roster || !referrals || !stats) {
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

  const treeName = DEPLOYED_TREE_LABEL

  return (
    <div className="min-h-full bg-dash-bg">
      <div className="mx-auto w-full max-w-dash-page p-6">
        {/* ── Block 1 · Clinic stats ─────────────────────────────────────── */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <StatChip count={stats.total} label="referrals" />
          <StatChip count={stats.pending} label="awaiting review" tone="amber" />
          <StatChip count={stats.decided} label="decided" tone="green" />
          <StatChip count={stats.escalated} label="escalated" tone="red" />
          <StatChip count={stats.avgWaitHours} label="avg hours waiting" />
          <p className="ml-auto text-dash-micro text-dash-faint">
            {roster.length} routable destinations in {treeName}
          </p>
        </div>

        {/* ── Blocks 2–4 · Specialist, caseload, capacity, routed by ─────── */}
        <div className="overflow-hidden rounded-dash-card border border-dash-line bg-dash-surface shadow-dash-card">
          <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_minmax(0,1.2fr)] items-center gap-3 border-b border-dash-line px-4 py-2">
            {['Specialist', 'Caseload', 'Capacity', 'Routed by'].map((h) => (
              <span key={h} className="text-dash-band uppercase text-dash-strong">
                {h}
              </span>
            ))}
          </div>

          {roster.map((entry) => {
            const load = caseloadFor(entry.name, referrals, reviews)
            const cap = capacityFor(entry.name)
            return (
              <div
                key={entry.name}
                className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_minmax(0,1.2fr)] items-center gap-3 border-b border-dash-line px-4 py-3 last:border-b-0"
              >
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
                        <span className="text-dash-micro tabular-nums text-dash-amber">
                          {load.pending} pending
                        </span>
                      )}
                      {load.escalated > 0 && (
                        <span className="text-dash-micro tabular-nums text-dash-red">
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
                    <span className="text-dash-muted"> · {cap.slotsPerWeek}/wk</span>
                  </p>
                  <p className="truncate text-dash-micro text-dash-muted">
                    {cap.acceptingNew ? 'Next open ' : 'Booked out to '}
                    {cap.nextAvailableLabel}
                  </p>
                </div>

                {/* Routed by */}
                <div className="min-w-0">
                  <Link
                    to="/admin/trees"
                    className="truncate text-dash-micro text-dash-accent hover:underline"
                  >
                    {treeName}
                  </Link>
                </div>
              </div>
            )
          })}
        </div>

        <p className="mt-3 text-dash-micro text-dash-faint">
          Caseload counts follow corrected destinations. Capacity is placeholder data — real
          availability comes from the scheduling system.
        </p>
      </div>
    </div>
  )
}
