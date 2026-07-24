import type { ConfidenceLevel } from '../../types'
import Badge, { type BadgeTone } from './Badge'

/** Extraction-confidence pill: High / Medium / Low. */

const TONES: Record<ConfidenceLevel, BadgeTone> = {
  high: 'green',
  medium: 'neutral',
  low: 'amber',
}

const LABELS: Record<ConfidenceLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export default function ConfidencePill({ level, title }: { level: ConfidenceLevel; title?: string }) {
  return (
    <Badge tone={TONES[level]} title={title}>
      {LABELS[level]}
    </Badge>
  )
}
