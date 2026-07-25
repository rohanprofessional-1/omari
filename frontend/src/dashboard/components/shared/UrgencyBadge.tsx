import Badge, { type BadgeTone } from './Badge'

/** Routing urgency pill. Urgent shouts (quietly); routine whispers. */

type Urgency = 'routine' | 'expedited' | 'urgent'

const TONES: Record<Urgency, BadgeTone> = {
  routine: 'neutral',
  expedited: 'slate',
  urgent: 'amber',
}

const LABELS: Record<Urgency, string> = {
  routine: 'routine',
  expedited: 'expedited',
  urgent: 'URGENT',
}

export default function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <Badge
      tone={TONES[urgency]}
      className={`shrink-0 ${urgency === 'urgent' ? 'font-semibold uppercase tracking-wide' : ''}`}
    >
      {LABELS[urgency]}
    </Badge>
  )
}
