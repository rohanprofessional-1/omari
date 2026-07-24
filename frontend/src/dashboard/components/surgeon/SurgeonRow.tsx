import { useState, type ReactNode } from 'react'
import type { ReviewableReferral } from '../../types'
import { ageFromDob } from '../../lib/demoClock'

/**
 * Surgeon brief — one calm, two-line row. Deliberately NOT the queue row:
 * wider, fewer columns, and the section-specific payload plus two inline
 * quick actions so the surgeon rarely needs the detail screen. Clicking the
 * row body still opens the full detail.
 */

export const surgeonBtnPrimary =
  'shrink-0 rounded-md bg-accent-strong px-2.5 py-1 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90'
export const surgeonBtnOutline =
  'shrink-0 rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] font-medium text-ink transition-colors hover:bg-bg'

export default function SurgeonRow({
  referral,
  payload,
  actions,
  onOpen,
}: {
  referral: ReviewableReferral
  /** Section-specific second line (escalation reason / confidence / quote). */
  payload: ReactNode
  /** Two inline quick-action buttons. */
  actions: ReactNode
  onOpen: (referralId: string) => void
}) {
  const { patient } = referral.payload
  return (
    <div
      onClick={() => onOpen(referral.payload.referralId)}
      className="flex cursor-pointer items-start gap-3 border-b border-line/60 px-4 py-2.5 last:border-b-0 hover:bg-sky/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-snug">
          <span className="font-medium text-ink">{patient.name}</span>{' '}
          <span className="text-muted">
            {ageFromDob(patient.dob)}
            {patient.sex}
          </span>{' '}
          <span className="text-muted" title={referral.payload.reasonForReferral}>
            · {referral.payload.reasonForReferral}
          </span>
        </p>
        <div className="mt-1 text-[12px] leading-snug text-muted">{payload}</div>
      </div>
      <div
        className="flex shrink-0 items-center gap-1.5 pt-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        {actions}
      </div>
    </div>
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
          className="absolute right-0 top-full z-20 mt-1.5 block w-64 rounded-lg border border-line bg-canvas p-2 shadow-xl"
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
            className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-[12px] text-ink placeholder:text-muted/60"
          />
          <span className="mt-1.5 flex items-center justify-end gap-1.5">
            <button
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-[11.5px] font-medium text-muted hover:text-ink"
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
