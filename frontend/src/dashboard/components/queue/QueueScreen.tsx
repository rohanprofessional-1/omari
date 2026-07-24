import { useEffect, useMemo, useState } from 'react'
import type { QueueGroup as QueueGroupId, ReviewableReferral, ReviewStatus } from '../../types'
import { getReferralSource } from '../../data/adapter'
import { DEMO_NOW } from '../../lib/demoClock'
import { QUEUE_GROUP_ORDER, queueGroupFor } from '../../lib/queueStatus'
import { reviewerNameFor, useDashboardStore } from '../../lib/reviewStore'
import BulkApproveBar from './BulkApproveBar'
import QueueFilters, { DEFAULT_FILTERS, type QueueFilterState } from './QueueFilters'
import QueueGroup from './QueueGroup'
import ReferralRow, { ROW_GRID } from './ReferralRow'

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

const DONE_PILL: Partial<Record<ReviewStatus, string>> = {
  approved: 'bg-success-soft text-success-deep',
  corrected: 'bg-accent/10 text-accent-strong',
  rejected: 'bg-danger/10 text-danger',
  escalated: 'bg-danger/10 text-danger',
  info_requested: 'bg-accent/10 text-accent-strong',
}

export default function QueueScreen({ onOpen }: { onOpen: (referralId: string) => void }) {
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
      <div className="px-4 py-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="mb-2 h-10 animate-pulse rounded-lg bg-line/50" />
        ))}
      </div>
    )
  }

  const visibleGroups = QUEUE_GROUP_ORDER.filter((g) => (groups.get(g) ?? []).length > 0)
  const nothingPending = visibleGroups.length === 0

  return (
    <div className="flex flex-col">
      <QueueFilters referrals={referrals} filters={filters} onChange={setFilters} />

      {nothingPending && (
        <p className="px-4 py-8 text-center text-[13px] text-muted">
          {done.length > 0
            ? 'Queue clear — every matching referral has been reviewed.'
            : 'No referrals match the current filters.'}
        </p>
      )}

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
                selectable={isReady}
                selected={liveSelected.has(r.payload.referralId)}
                onToggle={toggle}
                onOpen={onOpen}
              />
            ))}
          </QueueGroup>
        )
      })}

      {/* Completed strip — collapsed by default */}
      {done.length > 0 && (
        <section className="mt-2 border-t border-line">
          <button
            onClick={() => setDoneOpen((v) => !v)}
            aria-expanded={doneOpen}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted hover:text-ink"
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
                  className={`${ROW_GRID} h-9 cursor-pointer border-b border-line/60 px-4 text-[12px] text-muted hover:bg-sky/50`}
                >
                  <span />
                  <span className="truncate text-ink">{r.payload.patient.name}</span>
                  <span>
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                        DONE_PILL[review?.status ?? 'pending'] ?? 'bg-bg text-muted'
                      }`}
                    >
                      {(review?.status ?? '—').replace('_', ' ')}
                    </span>
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
  )
}
