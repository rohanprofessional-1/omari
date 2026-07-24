import { useState } from 'react'
import { describePlainDelta } from '../../../lib/reconcile/describePlain'
import type { Delta, DeltaResult } from '../../../lib/deltas/schema'
import type { SessionProgress } from '../../../lib/reconcile/session'
import type { Step } from '../../../lib/reconcile/types'
import { plural } from '../../../lib/reconcile/plainLabel'

/**
 * Blume — the closing screen.
 *
 * Everything the clinic changed, in sentences a surgeon would say out loud —
 * not a diff. This list is also the governance record that gets signed and
 * stored, so the artifact the surgeon reads and the artifact the clinic keeps
 * are the same thing. That is what makes signing off feel like authorship
 * rather than like clicking a button on someone else's work.
 */

export default function ReviewSignOff({
  steps,
  progress,
  deltas,
  results,
  busy,
  onRevisit,
  onSignOff,
}: {
  steps: Step[]
  progress: SessionProgress
  deltas: Delta[]
  results: DeltaResult[]
  busy: boolean
  onRevisit: (stepIndex: number) => void
  onSignOff: (signedBy: string) => void
}) {
  const [signedBy, setSignedBy] = useState('')

  const answered = steps.map((step, index) => ({ index, answer: progress.answers[step.question.id] }))
  const changed = answered.filter((a) => a.answer?.status === 'changed')
  const flagged = answered.filter((a) => a.answer?.status === 'flagged')
  const skipped = answered.filter((a) => a.answer?.status === 'skipped')
  const unanswered = answered.filter((a) => !a.answer)

  // Changes made outside the interview (Sprout) have no recorded sentence of
  // their own, so they are rendered from the change itself.
  const freeform = deltas.filter((d) => d.provenance.sessionStage === 'freeform')

  const resultOf = new Map(results.map((r) => [r.deltaId, r]))
  const stale = deltas.filter((d) => (resultOf.get(d.id)?.status ?? '').startsWith('stale'))

  const nothingChanged = changed.length === 0 && flagged.length === 0 && freeform.length === 0
  const outstanding = [...skipped, ...unanswered].sort((a, b) => a.index - b.index)

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-9">
      <h1 className="font-serif text-[25px] font-semibold leading-tight text-ink">Here's what you changed</h1>

      {nothingChanged ? (
        <p className="mt-4 text-[15px] leading-8 text-ink">
          You kept the guideline exactly as written. That's a complete answer — it was already a good fit for
          how your clinic works.
        </p>
      ) : (
        <ul className="mt-5 space-y-2.5">
          {changed.map(({ index, answer }) => (
            <li key={`c${index}`} className="flex gap-3 text-[15px] leading-7 text-ink">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-strong" />
              <span>{answer?.summary}</span>
            </li>
          ))}
          {freeform.map((d) => (
            <li key={d.id} className="flex gap-3 text-[15px] leading-7 text-ink">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-strong" />
              <span>{describePlainDelta(d)}</span>
            </li>
          ))}
          {flagged.map(({ index, answer }) => (
            <li key={`f${index}`} className="flex gap-3 text-[15px] leading-7 text-muted">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
              <span>{answer?.summary}</span>
            </li>
          ))}
        </ul>
      )}

      {outstanding.length > 0 && (
        <div className="mt-6 rounded-xl border border-line bg-canvas px-5 py-4">
          <p className="text-[14px] leading-7 text-ink">
            <strong className="font-semibold">
              You left {plural(outstanding.length, 'question')} unanswered.
            </strong>{' '}
            They're using the guideline's answer, which is safe.
          </p>
          <button
            onClick={() => onRevisit(outstanding[0].index)}
            className="mt-2 text-[13.5px] font-medium text-accent-strong hover:underline"
          >
            Go back to the first one →
          </button>
        </div>
      )}

      {stale.length > 0 && (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger/5 px-5 py-4">
          <p className="text-[14px] leading-7 text-danger">
            <strong className="font-semibold">The guideline was updated while you were working.</strong>{' '}
            {plural(stale.length, 'answer')} of yours {stale.length === 1 ? 'needs' : 'need'} a quick second
            look before you can sign off — open “Your changes” to see them.
          </p>
        </div>
      )}

      <div className="mt-7 border-t border-line pt-5">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">What happens next</p>
        <p className="mt-2.5 text-[14.5px] leading-8 text-ink">
          When you sign off, new referrals start being handled this way. Every referral will still show its
          reasoning to whoever reviews it, and you can change any of this later. We keep a signed, dated
          record of exactly this page.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-[14.5px] text-ink placeholder:text-muted/60"
          placeholder="Your name"
          value={signedBy}
          onChange={(e) => setSignedBy(e.target.value)}
        />
        <button
          onClick={() => onSignOff(signedBy.trim())}
          disabled={busy || !signedBy.trim() || stale.length > 0}
          title={stale.length > 0 ? 'Take another look at the flagged answers first' : undefined}
          className="rounded-md bg-accent-strong px-5 py-2.5 text-[14.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sign off and turn this on
        </button>
      </div>
    </div>
  )
}
