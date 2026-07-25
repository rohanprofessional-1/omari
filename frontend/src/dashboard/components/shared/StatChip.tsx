/**
 * Quiet stat chip: tabular number + micro label, keyed to the status palette.
 * Shared by the workup strata header and the clinic directory's stats strip.
 */
export default function StatChip({
  count,
  label,
  tone = 'neutral',
}: {
  count: number
  label: string
  tone?: 'amber' | 'neutral' | 'green' | 'red'
}) {
  const number =
    tone === 'amber'
      ? 'text-dash-amber'
      : tone === 'green'
        ? 'text-dash-green'
        : tone === 'red'
          ? 'text-dash-red'
          : 'text-dash-strong'
  return (
    <span className="inline-flex items-baseline gap-1 rounded-dash-ctl border border-dash-line bg-dash-surface px-2 py-1">
      <span className={`text-dash-body font-semibold tabular-nums ${number}`}>{count}</span>
      <span className="text-dash-micro text-dash-muted">{label}</span>
    </span>
  )
}
