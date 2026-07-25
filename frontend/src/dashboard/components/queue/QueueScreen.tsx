import { useEffect, useMemo, useState } from 'react'
import type { QueueGroup as QueueGroupId, ReviewableReferral, ReviewStatus } from '../../types'
import { getReferralSource } from '../../data/adapter'
import { DEMO_NOW } from '../../lib/demoClock'
import { QUEUE_GROUP_ORDER, queueGroupFor } from '../../lib/queueStatus'
import { reviewerNameFor, useDashboardStore } from '../../lib/reviewStore'
import Badge, { type BadgeTone } from '../shared/Badge'
import BulkApproveBar from './BulkApproveBar'
import QueueFilters, { DEFAULT_FILTERS, type QueueFilterState } from './QueueFilters'
import QueueGroup from './QueueGroup'
import ReferralRow, { ROW_GRID, type RowRail } from './ReferralRow'
import { useOpenReferral } from '../../lib/useOpenReferral'

/**
 * The coordinator's worklist: every referral in exactly one group, ordered by
 * what to do next. Ready rows bulk-approve; everything else opens the detail.
 */

const MS_PER_HOUR = 3_600_000

function matchesFilters(r: ReviewableReferral, group: QueueGroupId | 'done', f: QueueFilterState): boolean {
  if (f.destination !== 'any') {
    if (f.destination === 'out_of_scope') {
      if (r.result.inScope) return false
    } else if (f.destination === 'escalated') {
      if (!r.result.escalated) return false
    } else if (r.result.routedTo?.specialistName !== f.destination) {
      return false
    }
  }
  if (f.group !== 'any' && group !== f.group) return false
  if (f.channel !== 'any' && r.payload.channel !== f.channel) return false
  if (f.age !== 'any') {
    const hours = (DEMO_NOW.getTime() - new Date(r.payload.receivedAt).getTime()) / MS_PER_HOUR
    if (f.age === 'lt24h' && hours >= 24) return false
    if (f.age === '1to3d' && (hours < 24 || hours > 72)) return false
    if (f.age === 'gt3d' && hours <= 72) return false
  }
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase()
    const hit =
      r.payload.patient.name.toLowerCase().includes(q) ||
      r.payload.referredBy.provider.toLowerCase().includes(q)
    if (!hit) return false
  }
  return true
}

const DONE_TONE: Partial<Record<ReviewStatus, BadgeTone>> = {
  approved: 'green',
  corrected: 'accent',
  rejected: 'red',
  escalated: 'red',
  info_requested: 'accent',
}

/** Quiet 2px left rail on attention tiers only (Phase 5). */
const GROUP_RAIL: Partial<Record<QueueGroupId, RowRail>> = {
  needs_info: 'amber',
  needs_judgment: 'amber',
  escalated: 'red',
}

export default function QueueScreen() {
  const onOpen = useOpenReferral()
  const { reviews, role, applyAction } = useDashboardStore()
  const [referrals, setReferrals] = useState<ReviewableReferral[] | null>(null)
  const [filters, setFilters] = useState<QueueFilterState>(DEFAULT_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [doneOpen, setDoneOpen] = useState(false)

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

  /* Group + filter. Every referral lands in exactly one group (or 'done'). */
  const { groups, done } = useMemo(() => {
    const groups = new Map<QueueGroupId, ReviewableReferral[]>()
    const done: ReviewableReferral[] = []
    for (const r of referrals ?? []) {
      const group = queueGroupFor(r.result, reviews[r.payload.referralId])
      if (!matchesFilters(r, group, filters)) continue
      if (group === 'done') done.push(r)
      else groups.set(group, [...(groups.get(group) ?? []), r])
    }
    return { groups, done }
  }, [referrals, reviews, filters])

  const readyIds = useMemo(
    () => (groups.get('ready') ?? []).map((r) => r.payload.referralId),
    [groups],
  )

  /* Selection only ever holds CURRENT ready rows (approval moves rows out). */
  const liveSelected = useMemo(
    () => new Set(readyIds.filter((id) => selected.has(id))),
    [readyIds, selected],
  )

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelected(liveSelected.size === readyIds.length ? new Set() : new Set(readyIds))

  const approveSelected = () => {
    const actor = reviewerNameFor(role)
    for (const id of liveSelected) applyAction(id, 'approved', { actor, role })
    setSelected(new Set())
  }

  if (!referrals) {
    return (
      <div className="min-h-full bg-dash-bg">
        <div className="mx-auto w-full max-w-dash-page p-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="mb-2 h-12 animate-pulse rounded-dash-card bg-dash-line/60" />
          ))}
        </div>
      </div>
    )
  }

  const visibleGroups = QUEUE_GROUP_ORDER.filter((g) => (groups.get(g) ?? []).length > 0)
  const nothingPending = visibleGroups.length === 0

  return (
    <div className="min-h-full bg-dash-bg">
      <div className="mx-auto w-full max-w-dash-page p-6">
        <QueueFilters referrals={referrals} filters={filters} onChange={setFilters} />

        {nothingPending && (
          <p className="py-8 text-center text-dash-body text-dash-muted">
            {done.length > 0
              ? 'Queue clear — every matching referral has been reviewed.'
              : 'No referrals match the current filters.'}
          </p>
        )}

        {(visibleGroups.length > 0 || done.length > 0) && (
          <div className="rounded-dash-card border border-dash-line bg-dash-surface shadow-dash-card">
            {visibleGroups.map((groupId) => {
              const rows = groups.get(groupId) ?? []
              const isReady = groupId === 'ready'
              return (
                <QueueGroup
                  key={groupId}
                  group={groupId}
                  count={rows.length}
                  headerControls={
                    isReady ? (
                      <BulkApproveBar
                        readyCount={readyIds.length}
                        selectedCount={liveSelected.size}
                        onToggleAll={toggleAll}
                        onApprove={approveSelected}
                      />
                    ) : undefined
                  }
                >
                  {rows.map((r) => (
                    <ReferralRow
                      key={r.payload.referralId}
                      referral={r}
                      review={reviews[r.payload.referralId]}
                      selectable={isReady}
                      selected={liveSelected.has(r.payload.referralId)}
                      rail={GROUP_RAIL[groupId]}
                      onToggle={toggle}
                      onOpen={onOpen}
                    />
                  ))}
                </QueueGroup>
              )
            })}

            {/* Completed strip — collapsed by default */}
            {done.length > 0 && (
              <section>
                <button
                  onClick={() => setDoneOpen((v) => !v)}
                  aria-expanded={doneOpen}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-dash-band uppercase text-dash-muted transition-colors hover:text-dash-ink"
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
                    className={`transition-transform ${doneOpen ? 'rotate-90' : ''}`}
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  Completed today ({done.length})
                </button>
                {doneOpen &&
                  done.map((r) => {
                    const review = reviews[r.payload.referralId]
                    return (
                      <div
                        key={r.payload.referralId}
                        onClick={() => onOpen(r.payload.referralId)}
                        className={`${ROW_GRID} h-10 cursor-pointer border-t border-l-2 border-t-dash-line border-l-transparent px-4 text-dash-micro text-dash-muted transition-colors hover:bg-dash-bg`}
                      >
                        <span />
                        <span className="truncate font-medium text-dash-strong">
                          {r.payload.patient.name}
                        </span>
                        <span>
                          <Badge tone={DONE_TONE[review?.status ?? 'pending'] ?? 'neutral'}>
                            {(review?.status ?? '—').replace('_', ' ')}
                          </Badge>
                        </span>
                        <span className="truncate">{review?.reviewer}</span>
                        <span className="truncate">
                          {review?.correction
                            ? `${review.correction.field}: ${review.correction.from} → ${review.correction.to}`
                            : r.result.routedTo
                              ? `→ ${r.result.routedTo.specialistName}`
                              : ''}
                        </span>
                        <span className="col-span-3" />
                        <span className="text-right tabular-nums">
                          {review?.reviewedAt
                            ? new Date(review.reviewedAt).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                              })
                            : ''}
                        </span>
                      </div>
                    )
                  })}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
