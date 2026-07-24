import { SECTIONS, sectionOffsets, totalTimeLine } from '../../../lib/reconcile/flow'
import type { Step } from '../../../lib/reconcile/types'

/**
 * Blume — the opening screen.
 *
 * Thirty seconds of orientation removes most of the confusion: what has been
 * drafted and from what, what the next half hour is for, and what exists at
 * the end. Above all it says the thing a surgeon most needs to hear before
 * touching anything — nothing goes live until you say so.
 */

export default function Orientation({
  guidelineName,
  steps,
  resuming,
  onStart,
}: {
  guidelineName: string
  steps: Step[]
  /** They've been here before and have answers saved. */
  resuming: boolean
  onStart: () => void
}) {
  const offsets = sectionOffsets(steps)

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <p className="text-[12.5px] font-medium uppercase tracking-[0.08em] text-carolina-deep">
        Setting up your referrals
      </p>
      <h1 className="mt-2 font-serif text-[27px] font-semibold leading-tight text-ink">
        We've drafted a starting point from {guidelineName}.
      </h1>

      <div className="mt-5 space-y-4 text-[15px] leading-8 text-ink">
        <p>
          It already decides where every referral goes — you're not building anything from scratch. Your job
          is to tell us where your clinic differs from it.
        </p>
        <p>
          <strong className="font-semibold">Every question comes pre-answered with what the guideline says.</strong>{' '}
          If the guideline is right, one click moves you on. You only need to stop where something doesn't
          match how you actually work.
        </p>
        <p>
          At the end you'll see a plain list of everything you changed, and you decide whether it goes live.
          Nothing takes effect until you sign off, and anything here can be changed later.
        </p>
      </div>

      <div className="mt-7 rounded-xl border border-line bg-canvas px-5 py-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">What we'll ask about</p>
        <ul className="mt-3 space-y-1.5">
          {SECTIONS.map((section) => {
            const count = offsets.get(section.id)?.count ?? 0
            return (
              <li key={section.id} className="flex items-baseline justify-between gap-4 text-[14px]">
                <span className={count === 0 ? 'text-muted' : 'text-ink'}>{section.label}</span>
                <span className="shrink-0 text-[13px] text-muted">
                  {count === 0 ? 'nothing to decide' : section.preview(count)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="mt-7 flex items-center gap-4">
        <button
          onClick={onStart}
          className="rounded-md bg-accent-strong px-5 py-2.5 text-[15px] font-semibold text-white hover:opacity-90"
        >
          {resuming ? 'Pick up where you left off' : 'Start'}
        </button>
        <span className="text-[13.5px] text-muted">{totalTimeLine(steps.length)}</span>
      </div>
    </div>
  )
}
