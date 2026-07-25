import { useEffect, useMemo, useState } from 'react'
import type { QueueGroup as QueueGroupId, ReviewableReferral, ReviewStatus } from '../../types'
import { DEMO_NOW } from '../../lib/demoClock'
import { QUEUE_GROUP_ORDER, queueGroupFor } from '../../lib/queueStatus'
import { reviewerNameFor, useDashboardStore } from '../../lib/reviewStore'
import Badge, { type BadgeTone } from '../shared/Badge'
import BulkApproveBar from './BulkApproveBar'
import QueueColumnHeader, { RAIL_NONE, ROW_EDGE, ROW_GRID } from './columns'
import QueueFilters, { DEFAULT_FILTERS, type QueueFilterState } from './QueueFilters'
import QueueGroup from './QueueGroup'
import QueueSummary from './QueueSummary'
import ReferralRow, { type RowRail } from './ReferralRow'
import { useOpenReferral } from '../../lib/useOpenReferral'
import { useAuth } from '../../../auth/authStore'
import { filterForUser, listForUser } from '../../lib/scope'

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
  const { user } = useAuth()
  const [fetched, setReferrals] = useState<ReviewableReferral[] | null>(null)
  const [filters, setFilters] = useState<QueueFilterState>(DEFAULT_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [doneOpen, setDoneOpen] = useState(false)
  /** Tiers the user has folded away — everything starts open. */
  const [collapsed, setCollapsed] = useState<Set<QueueGroupId>>(new Set())

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

  const toggleGroup = (group: QueueGroupId) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })

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
  const counts = new Map(QUEUE_GROUP_ORDER.map((g) => [g, (groups.get(g) ?? []).length]))

  return (
    <div className="min-h-full bg-dash-bg">
      <div className="mx-auto w-full max-w-dash-page px-6 pb-12 pt-4">
        {/* Whole queue in one line — counts stay above the fold and jump to a tier */}
        <QueueSummary counts={counts} doneCount={done.length} />

        <QueueFilters referrals={referrals} filters={filters} onChange={setFilters} />

        {nothingPending && (
          <p className="py-8 text-center text-dash-body text-dash-muted">
            {done.length > 0
              ? 'Queue clear — every matching referral has been reviewed.'
              : 'No referrals match the current filters.'}
          </p>
        )}

        {(visibleGroups.length > 0 || done.length > 0) && (
          <div className="space-y-3">
            {/* Named columns, pinned — "expedited", "High" and "17h" all say what they are */}
            <QueueColumnHeader />

            {visibleGroups.map((groupId) => {
              const rows = groups.get(groupId) ?? []
              const isReady = groupId === 'ready'
              return (
                <QueueGroup
                  key={groupId}
                  group={groupId}
                  count={rows.length}
                  open={!collapsed.has(groupId)}
                  onToggle={() => toggleGroup(groupId)}
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

            {/* Completed strip — its own card, collapsed by default */}
            {done.length > 0 && (
              <section className="rounded-dash-card border border-dash-line-strong bg-dash-surface shadow-dash-card [&>div:last-child]:border-b-0">
                <button
                  onClick={() => setDoneOpen((v) => !v)}
                  aria-expanded={doneOpen}
                  className="flex h-9 w-full items-center gap-2 rounded-t-dash-card border-b border-dash-line-strong bg-dash-header px-4 text-left text-dash-col uppercase text-dash-muted transition-colors hover:text-dash-ink"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className={`shrink-0 text-dash-faint transition-transform motion-reduce:transition-none ${doneOpen ? 'rotate-90' : ''}`}
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                  Completed today
                  <span className="rounded-full border border-dash-line-strong bg-dash-surface px-1.5 py-px text-dash-micro font-semibold leading-tight tabular-nums text-dash-strong">
                    {done.length}
                  </span>
                </button>
                {doneOpen &&
                  done.map((r) => {
                    const review = reviews[r.payload.referralId]
                    return (
                      <div
                        key={r.payload.referralId}
                        onClick={() => onOpen(r.payload.referralId)}
                        className={`${ROW_GRID} ${ROW_EDGE} ${RAIL_NONE} h-10 cursor-pointer border-b border-b-dash-line text-dash-micro text-dash-muted transition-colors hover:bg-dash-bg`}
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
                        <span className="col-span-4" />
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
