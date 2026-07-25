import { useState, type ReactNode } from 'react'
import type { ReviewableReferral } from '../../types'
import { ageFromDob } from '../../lib/demoClock'

/**
 * Surgeon brief — one calm row inside its section card, read in three fixed
 * beats so every row answers the same questions in the same places:
 *
 *   1. WHO, WHAT KIND, WHERE TO — and the actions, all on ONE scan line.
 *      Buttons sit at the right of that line rather than under the prose, so a
 *      row is a row's worth of height whatever the tree wrote.
 *   2. The referral in the referrer's words — one truncated line.
 *   3. WHY it stopped — the section payload, in its own labelled block.
 *
 * Deliberately NOT the queue row: wider, fewer columns. Clicking the body
 * opens the full detail. Status color lives ONLY in the 2px left rail, the
 * badge, and the payload block's label.
 *
 * The row carries no border/shadow of its own — the section card owns the
 * boundary, so where a group starts and ends is never ambiguous.
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
  meta,
  payload,
  actions,
  onOpen,
}: {
  referral: ReviewableReferral
  /** Flag-type badge that opens the scan line (presentation only). */
  badge?: ReactNode
  /** 2px left-rail tone matching the badge (presentation only). */
  rail?: CardRail
  /** Where this referral is headed — trailing meta on the scan line. */
  meta?: ReactNode
  /** Section-specific body (escalation reason / confidence / quote). */
  payload: ReactNode
  /** Inline quick-action buttons. */
  actions: ReactNode
  onOpen: (referralId: string) => void
}) {
  const { patient, reasonForReferral } = referral.payload
  return (
    <article
      onClick={() => onOpen(referral.payload.referralId)}
      className={`group cursor-pointer border-b border-l-2 border-b-dash-line px-4 py-3 transition-colors hover:bg-dash-bg ${
        rail ? RAIL[rail] : 'border-l-transparent'
      }`}
    >
      {/* Beat 1 — the scan line. Badge · patient · destination | actions. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {badge && <span className="shrink-0">{badge}</span>}
          <span className="truncate text-dash-row text-dash-ink transition-colors group-hover:text-dash-accent">
            {patient.name}
          </span>
          <span className="shrink-0 text-dash-micro tabular-nums text-dash-faint">
            {ageFromDob(patient.dob)}
            {patient.sex}
          </span>
          {meta && <span className="min-w-0 truncate">{meta}</span>}
        </div>

        {/* Same two controls, same place, every row — clicks stay off the card */}
        <div
          className="flex shrink-0 items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      </div>

      {/* Beat 2 — the referral in the referrer's own words, one line. */}
      <p className="mt-1 truncate text-dash-body text-dash-muted" title={reasonForReferral}>
        {reasonForReferral}
      </p>

      {/* Beat 3 — why it stopped. */}
      <div className="mt-2">{payload}</div>
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
