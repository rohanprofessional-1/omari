/** Routing urgency pill. Urgent shouts; routine whispers. */

type Urgency = 'routine' | 'expedited' | 'urgent'

const STYLES: Record<Urgency, string> = {
  routine: 'border border-line bg-bg text-muted',
  expedited: 'bg-accent/10 text-accent-strong',
  urgent: 'bg-danger/10 font-semibold uppercase tracking-[0.05em] text-danger',
}

const LABELS: Record<Urgency, string> = {
  routine: 'routine',
  expedited: 'expedited',
  urgent: 'URGENT',
}

export default function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${STYLES[urgency]}`}
    >
      {LABELS[urgency]}
    </span>
  )
}
