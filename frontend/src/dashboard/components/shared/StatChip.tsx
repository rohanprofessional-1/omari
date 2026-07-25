import SignalDot, { type Signal } from './SignalDot'

/**
 * Quiet stat chip: a signal dot, a tabular number, and a micro label.
 *
 * The number used to be tinted; in the traffic-light palette that made it
 * unreadable, so the count is ink and the dot carries the state. Shared by the
 * clinic directory's stats strip and anywhere else a bare count needs a state.
 */
export default function StatChip({
  count,
  label,
  tone = 'neutral',
}: {
  count: number
  label: string
  tone?: Signal
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-dash-ctl border border-dash-line-strong bg-dash-surface px-3 py-1">
      <SignalDot tone={tone} title={label} />
      <span className="text-dash-body font-semibold tabular-nums text-dash-ink">{count}</span>
      <span className="text-dash-micro text-dash-muted">{label}</span>
    </span>
  )
}
