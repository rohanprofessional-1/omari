import type { ReactNode } from 'react'

/**
 * The dashboard's ONE badge idiom: a capsule of micro text.
 *
 * Two families, and the split is the whole colour rule of the system:
 *  • SIGNAL (red / amber / green) — a SOLID traffic-light fill with INK text.
 *    The colour lives in the fill because that is the only place these chromas
 *    are legible: #febc2e as 12px text on white is ~1.7:1, but #0a0a0a on a
 *    #febc2e capsule is ~10:1.
 *  • QUIET (neutral / accent / slate) — a soft gray fill with ink-soft text.
 *    Nothing that isn't a signal earns colour.
 *
 * Channel chips, urgency, confidence, missing counts, 'requested', done pills
 * all share these dimensions and radius, so a status reads as a status
 * wherever it appears.
 */

export type BadgeTone = 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'slate'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-dash-neutral-soft text-dash-strong',
  accent: 'bg-dash-accent-soft text-dash-strong',
  slate: 'bg-dash-slate-soft text-dash-strong',
  green: 'bg-dash-green text-dash-ink',
  amber: 'bg-dash-amber text-dash-ink',
  red: 'bg-dash-red text-dash-ink',
}

export default function Badge({
  tone = 'neutral',
  title,
  className = '',
  children,
}: {
  tone?: BadgeTone
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-dash-ctl px-2 py-1 text-dash-micro leading-none font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
