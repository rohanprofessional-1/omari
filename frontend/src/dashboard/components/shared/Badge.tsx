import type { ReactNode } from 'react'

/**
 * The dashboard's ONE badge idiom: micro text on a very soft status tint.
 * Channel chips, urgency, confidence, missing counts, 'requested', done
 * pills — all the same dimensions and radius so statuses read as quiet
 * hints, not alarms. Tones come from the `dash-` status tokens only.
 */

export type BadgeTone = 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'slate'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-dash-neutral-soft text-dash-muted',
  accent: 'bg-dash-accent-soft text-dash-accent-strong',
  green: 'bg-dash-green-soft text-dash-green',
  amber: 'bg-dash-amber-soft text-dash-amber',
  red: 'bg-dash-red-soft text-dash-red',
  slate: 'bg-dash-slate-soft text-dash-slate',
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
