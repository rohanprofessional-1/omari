import { Fragment } from 'react'

/**
 * Honest, simple referral-status stages: Submitted → In review → Confirmed →
 * Scheduled. Each is a REAL workflow step — "In review" means a human confirms
 * on the doctor dashboard — with later stages greyed as upcoming.
 *
 * Patient-facing, main design tokens. Shared by the Runner's outcome cards, the
 * presentation-mode orb view, and the patient's "My referral" screen; it lives
 * here rather than in Runner.tsx so none of those has to import the clinician
 * module to render a status bar.
 */

/** 0 Submitted · 1 In review · 2 Confirmed · 3 Scheduled. */
export type StatusStage = 0 | 1 | 2 | 3

const STAGE_LABELS = ['Submitted', 'In review', 'Confirmed', 'Scheduled'] as const

/** Caption under the bar, phrased for whichever stage is active. */
const CAPTIONS: Record<StatusStage, string> = {
  0: 'Just submitted to',
  1: 'Currently in review by',
  2: 'Confirmed by',
  3: 'Scheduled with',
}

export default function StatusStepper({
  reviewerLabel,
  tone = 'accent',
  current = 1,
}: {
  reviewerLabel: string
  tone?: 'accent' | 'amber' | 'green'
  /** Which stage the referral is at. Defaults to "In review". */
  current?: StatusStage
}) {
  const stages = STAGE_LABELS.map((label, i) => ({
    label,
    state: i < current ? ('done' as const) : i === current ? ('current' as const) : ('upcoming' as const),
  }))

  // Full static class strings (Tailwind can't see constructed class names).
  const t =
    tone === 'amber'
      ? {
          dotDone: 'bg-nodeesc border-nodeesc text-white',
          dotCurrent: 'bg-canvas border-nodeesc text-nodeesc ring-4 ring-nodeesc/15',
          connector: 'bg-nodeesc',
        }
      : tone === 'green'
        ? {
            dotDone: 'bg-success border-success text-white',
            dotCurrent: 'bg-canvas border-success text-success ring-4 ring-success/15',
            connector: 'bg-success',
          }
        : {
            dotDone: 'bg-accent border-accent text-white',
            dotCurrent: 'bg-canvas border-accent text-accent ring-4 ring-accent/15',
            connector: 'bg-accent',
          }

  const dotClass = (state: 'done' | 'current' | 'upcoming') => {
    const base =
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold'
    if (state === 'done') return `${base} ${t.dotDone}`
    if (state === 'current') return `${base} ${t.dotCurrent}`
    return `${base} bg-canvas border-line text-muted`
  }

  return (
    <div>
      <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        Referral status
      </p>
      {/* dots + connectors */}
      <div className="flex items-center">
        {stages.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span
                className={`h-0.5 flex-1 ${stages[i - 1].state === 'done' ? t.connector : 'bg-line'}`}
              />
            )}
            <span className={dotClass(s.state)}>{s.state === 'done' ? '✓' : i + 1}</span>
          </Fragment>
        ))}
      </div>
      {/* labels */}
      <div className="mt-1.5 flex">
        {stages.map((s, i) => (
          <span
            key={i}
            className={`flex-1 text-center text-[10px] leading-tight ${
              s.state === 'upcoming' ? 'text-muted' : 'font-medium text-ink'
            }`}
          >
            {s.label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-center text-[11px] text-muted">
        {CAPTIONS[current]} <span className="font-medium text-ink">{reviewerLabel}</span>.
      </p>
    </div>
  )
}
