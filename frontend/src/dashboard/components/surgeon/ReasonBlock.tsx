import type { ReactNode } from 'react'
import ClampedText from '../shared/ClampedText'
import SignalDot, { type Signal } from '../shared/SignalDot'

/**
 * The "why" half of a brief card, in one fixed shape across all three
 * sections: a small caps label saying WHAT you're reading, an optional
 * one-line punchline, then the prose — clamped, so a card stays the size of a
 * row instead of the size of a paragraph.
 *
 * Sitting on a quiet band fill separates the tree's words from the patient's
 * words above it without adding another coloured rail; the only status colour
 * here is the label itself.
 */

export type ReasonTone = 'red' | 'amber' | 'slate' | 'accent' | 'neutral'

/** The label is always ink — the tone rides in the dot beside it. */
const DOT: Record<ReasonTone, Signal> = {
  red: 'red',
  amber: 'amber',
  slate: 'neutral',
  accent: 'neutral',
  neutral: 'neutral',
}

export default function ReasonBlock({
  label,
  tone = 'neutral',
  head,
  text,
  extra,
}: {
  /** What this block is — or the escalation's own directive when it has one. */
  label: string
  tone?: ReasonTone
  /** The punchline, above the prose: a destination change, an ambiguity. */
  head?: ReactNode
  /** The prose itself — clamped to two lines with an inline expander. */
  text?: string
  /** Anything that must stay visible while the prose is collapsed. */
  extra?: ReactNode
}) {
  return (
    <div className="rounded-nested bg-dash-header px-3 py-2">
      <p className="flex items-center gap-2 text-dash-col uppercase text-dash-ink">
        <SignalDot tone={DOT[tone]} />
        {label}
      </p>
      {head && <div className="mt-1 text-dash-body text-dash-ink">{head}</div>}
      {text && (
        <ClampedText text={text} lines={2} className="mt-1 max-w-prose text-dash-body text-dash-strong" />
      )}
      {extra && <div className="mt-2">{extra}</div>}
    </div>
  )
}
