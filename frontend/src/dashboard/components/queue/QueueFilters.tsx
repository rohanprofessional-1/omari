import { useMemo } from 'react'
import type { QueueGroup, ReviewableReferral, SourceChannel } from '../../types'
import { QUEUE_GROUP_LABELS, QUEUE_GROUP_ORDER } from '../../lib/queueStatus'

/**
 * Compact filter row for the queue: destination, group/status, channel,
 * referral age, and a free-text search on patient/provider name.
 */

export type AgeFilter = 'any' | 'lt24h' | '1to3d' | 'gt3d'

export interface QueueFilterState {
  destination: string // 'any' | specialist name | 'out_of_scope' | 'escalated'
  group: QueueGroup | 'done' | 'any'
  channel: SourceChannel | 'any'
  age: AgeFilter
  search: string
}

export const DEFAULT_FILTERS: QueueFilterState = {
  destination: 'any',
  group: 'any',
  channel: 'any',
  age: 'any',
  search: '',
}

const SELECT =
  'rounded-dash-ctl border border-dash-line-strong bg-dash-surface px-2 py-1.5 text-dash-micro text-dash-strong transition-colors hover:border-dash-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent'

export default function QueueFilters({
  referrals,
  filters,
  onChange,
}: {
  referrals: ReviewableReferral[]
  filters: QueueFilterState
  onChange: (next: QueueFilterState) => void
}) {
  const destinations = useMemo(() => {
    const names = new Set<string>()
    for (const r of referrals) {
      if (r.result.routedTo) names.add(r.result.routedTo.specialistName)
    }
    return [...names].sort()
  }, [referrals])

  const set = <K extends keyof QueueFilterState>(key: K, value: QueueFilterState[K]) =>
    onChange({ ...filters, [key]: value })

  const active =
    filters.destination !== 'any' ||
    filters.group !== 'any' ||
    filters.channel !== 'any' ||
    filters.age !== 'any' ||
    filters.search.trim() !== ''

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <select
        value={filters.destination}
        onChange={(e) => set('destination', e.target.value)}
        aria-label="Filter by destination"
        className={SELECT}
      >
        <option value="any">Destination: any</option>
        {destinations.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value="out_of_scope">Out of scope</option>
        <option value="escalated">Escalated</option>
      </select>

      <select
        value={filters.group}
        onChange={(e) => set('group', e.target.value as QueueFilterState['group'])}
        aria-label="Filter by status"
        className={SELECT}
      >
        <option value="any">Status: any</option>
        {QUEUE_GROUP_ORDER.map((g) => (
          <option key={g} value={g}>
            {QUEUE_GROUP_LABELS[g]}
          </option>
        ))}
        <option value="done">Completed</option>
      </select>

      <select
        value={filters.channel}
        onChange={(e) => set('channel', e.target.value as QueueFilterState['channel'])}
        aria-label="Filter by channel"
        className={SELECT}
      >
        <option value="any">Channel: any</option>
        <option value="epic">Epic</option>
        <option value="fax">Fax</option>
        <option value="phone">Phone</option>
      </select>

      <select
        value={filters.age}
        onChange={(e) => set('age', e.target.value as AgeFilter)}
        aria-label="Filter by referral age"
        className={SELECT}
      >
        <option value="any">Age: any</option>
        <option value="lt24h">&lt;24h</option>
        <option value="1to3d">1–3d</option>
        <option value="gt3d">&gt;3d</option>
      </select>

      <input
        type="search"
        value={filters.search}
        onChange={(e) => set('search', e.target.value)}
        placeholder="Search patient or provider…"
        aria-label="Search patient or provider name"
        className="min-w-48 flex-1 rounded-dash-ctl border border-dash-line-strong bg-dash-surface px-2 py-1.5 text-dash-micro text-dash-ink transition-colors placeholder:text-dash-faint hover:border-dash-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent md:max-w-64"
      />

      {active && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="rounded-dash-ctl px-2 py-1.5 text-dash-micro font-medium text-dash-accent transition-colors hover:text-dash-accent-strong"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
