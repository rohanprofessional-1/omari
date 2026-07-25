import { useState } from 'react'
import type { DeltaDraft } from '../../../lib/deltas/api'
import {
  fixLabel,
  fixSummary,
  leaveSummary,
  type SafetyQuestion,
} from '../../../lib/reconcile/questions/safety'
import type { StepProps } from '../../../lib/reconcile/types'

/**
 * Blume — the safety check, the last screen before sign-off.
 *
 * The point of this screen is a feeling, not a list: a surgeon should be able
 * to turn this on without wondering what it will do to the patient nobody
 * thought about. So the clean case — the common one — is written as a finding,
 * not as an empty state, and the only thing left to do is agree with it.
 *
 * When there IS something to fix, every row is already checked and one button
 * fixes all of them at once. The default click is the safe one, and it is the
 * same click whether there are two problems or nine.
 */

export default function SafetyStep({ question, busy, recorded, onAccept, onChange }: StepProps<SafetyQuestion>) {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())

  const gaps = question.gaps
  const included = gaps.filter((g) => !excluded.has(g.id))

  const toggle = (id: string) =>
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const applyFixes = () => {
    const drafts: DeltaDraft[] = included.flatMap((g) => g.drafts)
    if (drafts.length === 0) {
      onAccept(leaveSummary(gaps.length))
      return
    }
    onChange(drafts, fixSummary(included.length))
  }

  return (
    <div className="mt-5">
      {gaps.length === 0 ? (
        <div className="rounded-lg border border-success/40 bg-success-soft px-4 py-3.5">
          <p className="text-[14px] leading-7 text-ink">{question.reassurance}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {gaps.map((gap) => {
            const checked = !excluded.has(gap.id)
            return (
              <li key={gap.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 ${
                    checked ? 'border-accent/40 bg-sky' : 'border-line bg-canvas'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggle(gap.id)}
                    className="mt-[5px] h-[15px] w-[15px] shrink-0 accent-[var(--color-accent-strong)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-6 text-ink">{gap.sentence}</span>
                    <span className="mt-0.5 block text-[13px] leading-6 text-muted">{gap.fix}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      {question.notes.map((note) => (
        <p key={note} className="mt-3 text-[13px] leading-6 text-muted">
          {note}
        </p>
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {gaps.length === 0 ? (
          <button
            onClick={() => onAccept(question.acceptSummary)}
            disabled={busy}
            className="rounded-md border border-accent/50 px-3.5 py-2 text-[14px] font-medium text-accent-strong hover:bg-sky disabled:cursor-not-allowed disabled:opacity-40"
          >
            {question.acceptLabel}
          </button>
        ) : included.length === 0 ? (
          <button
            onClick={applyFixes}
            disabled={busy}
            className="rounded-md border border-accent/50 px-3.5 py-2 text-[14px] font-medium text-accent-strong hover:bg-sky disabled:cursor-not-allowed disabled:opacity-40"
          >
            {fixLabel(0, gaps.length)}
          </button>
        ) : (
          <button
            onClick={applyFixes}
            disabled={busy}
            className="rounded-md bg-accent-strong px-4 py-2 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {fixLabel(included.length, gaps.length)}
          </button>
        )}
        {recorded?.summary && (
          <span className="text-[12.5px] text-muted">You answered this already: {recorded.summary}</span>
        )}
      </div>
    </div>
  )
}
