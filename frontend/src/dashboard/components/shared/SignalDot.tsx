/**
 * A solid traffic-light disc — the system's ONLY way to attach colour to a
 * line of text.
 *
 * Status used to be carried by tinting the words themselves. That cannot
 * survive the signal palette: #febc2e as 12px text on white is ~1.7:1, and
 * #ff5f57 is ~2.9:1 — both unreadable. So the words stay #0a0a0a and the
 * colour moves into a 6px fill beside them, where full chroma is exactly what
 * you want. Same information, legible at any size.
 *
 * Pair it with weight (font-semibold) when the row also needs to shout.
 */

export type Signal = 'red' | 'amber' | 'green' | 'neutral'

const FILL: Record<Signal, string> = {
  red: 'bg-dash-red',
  amber: 'bg-dash-amber',
  green: 'bg-dash-green',
  neutral: 'bg-dash-line-strong',
}

export default function SignalDot({
  tone,
  title,
  className = '',
}: {
  tone: Signal
  /** Why this is lit — the dot is decorative, so the reason belongs here. */
  title?: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      title={title}
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${FILL[tone]} ${className}`}
    />
  )
}
