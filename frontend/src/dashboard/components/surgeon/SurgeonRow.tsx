import { useState, type ReactNode } from 'react'
import type { ReviewableReferral } from '../../types'
import { ageFromDob } from '../../lib/demoClock'

/**
 * Surgeon brief — one calm card. Deliberately NOT the queue row: wider, fewer
 * columns. The flag badge + patient line sit at the top, the section-specific
 * payload reads as body text at a comfortable measure, and a consistent
 * action row closes the card. Clicking the card body opens the full detail.
 * Status color lives ONLY in the 2px left rail and the badge.
 */

export const surgeonBtnPrimary =
  'shrink-0 rounded-dash-ctl bg-dash-accent-strong px-3 py-1 text-dash-micro font-semibold text-white transition-colors hover:bg-dash-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent'
export const surgeonBtnOutline =
  'shrink-0 rounded-dash-ctl border border-dash-line bg-dash-surface px-3 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent'

/** 2px status rail on the card's left edge — status tokens only. */
export type CardRail = 'red' | 'amber' | 'slate' | 'accent'

const RAIL: Record<CardRail, string> = {
  red: 'border-l-dash-red',
  amber: 'border-l-dash-amber',
  slate: 'border-l-dash-slate',
  accent: 'border-l-dash-accent',
}

export default function SurgeonRow({
  referral,
  badge,
  rail,
  payload,
  actions,
  onOpen,
}: {
  referral: ReviewableReferral
  /** Flag-type badge shown at the top of the card (presentation only). */
  badge?: ReactNode
  /** 2px left-rail tone matching the badge (presentation only). */
  rail?: CardRail
  /** Section-specific body (escalation reason / confidence / quote). */
  payload: ReactNode
  /** Inline quick-action buttons. */
  actions: ReactNode
  onOpen: (referralId: string) => void
}) {
  const { patient } = referral.payload
  return (
    <article
      onClick={() => onOpen(referral.payload.referralId)}
      className={`cursor-pointer rounded-dash-card border border-l-2 border-dash-line bg-dash-surface p-4 shadow-dash-card transition-colors hover:bg-dash-bg ${
        rail ? RAIL[rail] : 'border-l-transparent'
      }`}
    >
      {/* Card top: flag badge + patient anchor + reason */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {badge && <span className="shrink-0 self-center">{badge}</span>}
        <span className="truncate text-dash-row text-dash-ink">{patient.name}</span>
        <span className="shrink-0 text-dash-micro tabular-nums text-dash-faint">
          {ageFromDob(patient.dob)}
          {patient.sex}
        </span>
        <span
          className="min-w-0 truncate text-dash-body text-dash-muted"
          title={referral.payload.reasonForReferral}
        >
          {referral.payload.reasonForReferral}
        </span>
      </div>

      {/* Payload — readable ink body at a comfortable measure, never saturated */}
      <div className="mt-2 max-w-prose text-dash-body leading-relaxed text-dash-strong">
        {payload}
      </div>

      {/* Action row — consistent across every card */}
      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {actions}
      </div>
    </article>
  )
}

/**
 * Small inline comment affordance — a popover textarea that appends an audit
 * note without changing review status.
 */
export function CommentButton({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const valid = note.trim().length > 0

  const submit = () => {
    if (!valid) return
    onSubmit(note.trim())
    setNote('')
    setOpen(false)
  }

  return (
    <span className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={surgeonBtnOutline}
      >
        Comment
      </button>
      {open && (
        <span
          className="absolute left-0 top-full z-20 mt-2 block w-64 rounded-dash-card border border-dash-line bg-dash-surface p-2 shadow-xl"
        >
          <textarea
            rows={3}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            }}
            placeholder="Note for the audit trail…"
            className="w-full rounded-dash-ctl border border-dash-line bg-dash-bg px-2 py-1 text-dash-micro text-dash-ink placeholder:text-dash-faint"
          />
          <span className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-dash-ctl px-2 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:text-dash-ink"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!valid}
              className={`${surgeonBtnPrimary} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Save note
            </button>
          </span>
        </span>
      )}
    </span>
  )
}
