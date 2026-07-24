import type { ConfidenceLevel } from '../../types'

/** Extraction-confidence pill: High / Medium / Low. */

const STYLES: Record<ConfidenceLevel, string> = {
  high: 'bg-success-soft text-success-deep',
  medium: 'bg-accent/10 text-accent-strong',
  low: 'bg-danger/10 text-danger',
}

const LABELS: Record<ConfidenceLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export default function ConfidencePill({ level, title }: { level: ConfidenceLevel; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex rounded px-1.5 py-0.5 text-[10.5px] font-medium ${STYLES[level]}`}
    >
      {LABELS[level]}
    </span>
  )
}
