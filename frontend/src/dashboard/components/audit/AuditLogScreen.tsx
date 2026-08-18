import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAuditLogs, type AuditLogEntry, type AuditLogParams } from '../../../lib/auditApi'

/* ── Constants ───────────────────────────────────────────────────────────── */

const PAGE_SIZE = 50

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'patient.created', label: 'Patient created' },
  { value: 'patient.updated', label: 'Patient updated' },
  { value: 'patient.viewed', label: 'Patient viewed' },
  { value: 'patient.deleted', label: 'Patient deleted' },
  { value: 'referral.created', label: 'Referral created' },
  { value: 'referral.status_changed', label: 'Referral status changed' },
  { value: 'conversation.started', label: 'Conversation started' },
  { value: 'conversation.routed', label: 'Conversation routed' },
  { value: 'conversation.escalated', label: 'Conversation escalated' },
]

/* ── Action badge tones ──────────────────────────────────────────────────── */

type BadgeTone = 'green' | 'amber' | 'red' | 'accent' | 'neutral'

const ACTION_TONE: Record<string, BadgeTone> = {
  'patient.created': 'green',
  'patient.updated': 'amber',
  'patient.viewed': 'neutral',
  'patient.deleted': 'red',
  'referral.created': 'green',
  'referral.status_changed': 'amber',
  'conversation.started': 'accent',
  'conversation.routed': 'accent',
  'conversation.escalated': 'red',
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: 'bg-dash-green-soft text-dash-ink',
  amber: 'bg-dash-amber-soft text-dash-ink',
  red: 'bg-dash-red-soft text-dash-ink',
  accent: 'bg-dash-accent-soft text-dash-accent',
  neutral: 'bg-dash-neutral-soft text-dash-ink',
}

/* ── Component ───────────────────────────────────────────────────────────── */

export default function AuditLogScreen() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [patientSearch, setPatientSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [offset, setOffset] = useState(0)

  // Expanded rows
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Debounced patient search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(patientSearch), 350)
    return () => clearTimeout(t)
  }, [patientSearch])

  // Reset offset when filters change
  useEffect(() => setOffset(0), [debouncedSearch, actionFilter])

  // Fetch
  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: AuditLogParams = { limit: PAGE_SIZE, offset }
      if (debouncedSearch.trim()) params.patient_name = debouncedSearch.trim()
      if (actionFilter) params.action = actionFilter
      const res = await fetchAuditLogs(params)
      setEntries(res.items)
      setTotal(res.total)
    } catch (e: any) {
      setError(e.message || 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [offset, debouncedSearch, actionFilter])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="border-b border-dash-line-strong bg-dash-surface">
        <div className="mx-auto flex w-full max-w-dash-page flex-wrap items-center gap-3 px-6 py-3">
          <h1 className="min-w-0 truncate text-dash-title text-dash-ink">Audit Log</h1>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-dash-bg">
        <div className="mx-auto w-full max-w-dash-page px-6 pb-12 pt-4">

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {/* Patient search */}
            <div className="relative flex-1" style={{ minWidth: 200, maxWidth: 340 }}>
              <SearchIcon />
              <input
                id="audit-patient-search"
                type="text"
                placeholder="Search by patient name…"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                className="h-9 w-full rounded-dash-ctl border border-dash-line-strong bg-dash-surface pl-9 pr-3 text-dash-body text-dash-ink placeholder:text-dash-muted outline-none transition-colors focus:border-dash-accent"
              />
            </div>

            {/* Action filter */}
            <select
              id="audit-action-filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="h-9 rounded-dash-ctl border border-dash-line-strong bg-dash-surface px-3 text-dash-body text-dash-ink outline-none transition-colors focus:border-dash-accent"
            >
              {ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* Count chip */}
            <span className="ml-auto rounded-full border border-dash-line-strong bg-dash-surface px-2.5 py-0.5 text-dash-micro font-semibold tabular-nums text-dash-strong">
              {total.toLocaleString()} event{total !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-dash-ctl border border-dash-red/30 bg-dash-red-soft px-4 py-2 text-dash-body text-dash-ink">
              {error}
            </div>
          )}

          {/* Table card */}
          <section className="rounded-dash-card border border-dash-line-strong bg-dash-surface shadow-dash-card">
            {/* Column headers */}
            <div className="grid grid-cols-[140px_1fr_170px_140px_1fr] items-center gap-2 border-b border-dash-line-strong bg-dash-header px-4 py-2 text-dash-col uppercase text-dash-muted">
              <span>Timestamp</span>
              <span>Patient</span>
              <span>Action</span>
              <span>Actor</span>
              <span>Detail</span>
            </div>

            {/* Loading skeleton */}
            {loading && entries.length === 0 && (
              <div className="space-y-px">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-11 animate-pulse border-b border-dash-line bg-dash-surface" />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loading && entries.length === 0 && (
              <div className="py-16 text-center">
                <EmptyIcon />
                <p className="mt-3 text-dash-body text-dash-muted">
                  No audit events match the current filters.
                </p>
              </div>
            )}

            {/* Rows */}
            {entries.map((entry) => {
              const isExpanded = expandedId === entry.id
              return (
                <div key={entry.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className={`grid w-full grid-cols-[140px_1fr_170px_140px_1fr] items-center gap-2 border-b border-dash-line px-4 py-2.5 text-left text-dash-body transition-colors hover:bg-dash-bg ${
                      isExpanded ? 'bg-dash-accent-soft/40' : ''
                    }`}
                  >
                    {/* Timestamp */}
                    <span className="tabular-nums text-dash-micro text-dash-muted">
                      {formatTimestamp(entry.timestamp)}
                    </span>

                    {/* Patient */}
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-dash-strong">
                        {entry.patient_name || '—'}
                      </span>
                      {entry.patient_mrn && (
                        <span className="ml-1.5 rounded bg-dash-bg px-1 py-px text-dash-micro text-dash-muted">
                          {entry.patient_mrn}
                        </span>
                      )}
                    </span>

                    {/* Action badge */}
                    <span>
                      <ActionBadge action={entry.action} />
                    </span>

                    {/* Actor */}
                    <span className="min-w-0 truncate text-dash-micro text-dash-muted">
                      {entry.actor_label === 'system' ? (
                        <span className="rounded bg-dash-neutral-soft px-1.5 py-px text-dash-micro font-medium text-dash-muted">
                          System
                        </span>
                      ) : (
                        entry.actor_label
                      )}
                    </span>

                    {/* Detail preview */}
                    <span className="min-w-0 truncate text-dash-micro text-dash-muted">
                      {detailPreview(entry)}
                    </span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="omari-msg border-b border-dash-line bg-dash-bg/60 px-4 py-3">
                      <DetailPanel entry={entry} />
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <PaginationButton
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                label="← Prev"
              />
              <span className="px-2 text-dash-micro tabular-nums text-dash-muted">
                Page {currentPage} of {totalPages}
              </span>
              <PaginationButton
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                label="Next →"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

function ActionBadge({ action }: { action: string }) {
  const tone = ACTION_TONE[action] ?? 'neutral'
  const label = action.replace('.', ' · ')
  return (
    <span
      className={`inline-block rounded-dash-ctl px-2 py-0.5 text-dash-micro font-medium ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  )
}

function DetailPanel({ entry }: { entry: AuditLogEntry }) {
  const detail = entry.detail
  const hasChanges = detail?.changes && typeof detail.changes === 'object'

  return (
    <div className="space-y-2 text-dash-body">
      {/* Metadata row */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-dash-micro text-dash-muted">
        <span>
          <span className="font-medium text-dash-strong">Event ID:</span> {entry.id.slice(0, 8)}…
        </span>
        <span>
          <span className="font-medium text-dash-strong">Resource:</span> {entry.resource_type} / {entry.resource_id.slice(0, 8)}…
        </span>
        {entry.ip_address && (
          <span>
            <span className="font-medium text-dash-strong">IP:</span> {entry.ip_address}
          </span>
        )}
        <span>
          <span className="font-medium text-dash-strong">Time:</span>{' '}
          {new Date(entry.timestamp).toLocaleString()}
        </span>
      </div>

      {/* Field-level diff for updates */}
      {hasChanges && (
        <div className="rounded-dash-ctl border border-dash-line bg-dash-surface p-3">
          <p className="mb-2 text-dash-col uppercase text-dash-muted">Field changes</p>
          <div className="space-y-1.5">
            {Object.entries(detail!.changes as Record<string, { old: any; new: any }>).map(
              ([field, { old: oldVal, new: newVal }]) => (
                <div key={field} className="flex items-baseline gap-2 text-dash-micro">
                  <span className="min-w-[100px] font-medium text-dash-strong">{field}</span>
                  <span className="rounded bg-dash-red-soft px-1.5 py-px text-dash-ink line-through">
                    {formatValue(oldVal)}
                  </span>
                  <span className="text-dash-muted">→</span>
                  <span className="rounded bg-dash-green-soft px-1.5 py-px text-dash-ink">
                    {formatValue(newVal)}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* Generic detail JSON (for non-update actions) */}
      {detail && !hasChanges && Object.keys(detail).length > 0 && (
        <div className="rounded-dash-ctl border border-dash-line bg-dash-surface p-3">
          <p className="mb-2 text-dash-col uppercase text-dash-muted">Event detail</p>
          <pre className="overflow-x-auto text-dash-micro text-dash-muted">
            {JSON.stringify(detail, null, 2)}
          </pre>
        </div>
      )}

      {/* No detail */}
      {(!detail || Object.keys(detail).length === 0) && (
        <p className="text-dash-micro text-dash-muted italic">No additional detail recorded.</p>
      )}
    </div>
  )
}

function PaginationButton({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-dash-ctl border px-3 py-1 text-dash-micro font-medium transition-colors ${
        disabled
          ? 'cursor-not-allowed border-dash-line bg-dash-bg text-dash-muted'
          : 'border-dash-line-strong bg-dash-surface text-dash-ink hover:bg-dash-bg'
      }`}
    >
      {label}
    </button>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
}

function formatValue(v: any): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

function detailPreview(entry: AuditLogEntry): string {
  if (!entry.detail) return ''
  const d = entry.detail
  if (d.changes) {
    const fields = Object.keys(d.changes)
    if (fields.length === 1) return `${fields[0]} changed`
    return `${fields.length} fields changed`
  }
  if (d.display_id) return `Ref ${d.display_id}`
  if (d.tree_id) return `Tree ${d.tree_id.slice(0, 8)}…`
  if (d.specialist_id) return `Specialist ${d.specialist_id.slice(0, 8)}…`
  if (d.created) return 'Record created'
  return ''
}

/* ── Icons ───────────────────────────────────────────────────────────────── */

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dash-muted"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function EmptyIcon() {
  return (
    <svg
      className="mx-auto text-dash-muted"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}
