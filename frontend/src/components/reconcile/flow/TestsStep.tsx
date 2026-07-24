import { useState } from 'react'
import {
  resolveTests,
  type TestDecision,
  type TestsQuestion,
} from '../../../lib/reconcile/questions/tests'
import type { StepProps } from '../../../lib/reconcile/types'

/**
 * Blume — "Tests before the visit", the controls only.
 *
 * The shell has already asked the question, said what the guideline says and
 * what it costs a patient to get this wrong. What's left is the list — and the
 * one rule this screen exists to enforce: it is NEVER empty. Either the
 * guideline named tests, or we've proposed the standard ones and said out loud
 * that the proposal is ours. Both are a decision a surgeon can make in one
 * click; neither is a blank canvas with an "add" button on it.
 */

const SAFE_BUTTON =
  'rounded-md border border-accent/50 px-3.5 py-2 text-[14px] font-medium text-accent-strong hover:bg-sky disabled:opacity-40'
const QUIET_LINK = 'text-[12.5px] text-muted underline decoration-line underline-offset-2 hover:text-ink'
const FIELD =
  'rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink placeholder:text-muted/60'

function initial(question: TestsQuestion): TestDecision[] {
  return question.items.map((item) => ({ ...item, kept: true }))
}

export default function TestsStep({ question, busy, recorded, onAccept, onChange, onFlag }: StepProps<TestsQuestion>) {
  const [rows, setRows] = useState<TestDecision[]>(() => initial(question))
  const [shownFor, setShownFor] = useState(question.id)
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftReason, setDraftReason] = useState('')

  // One component instance renders every group in this section, so the answer
  // to the last group must not become the starting point for the next one.
  if (shownFor !== question.id) {
    setShownFor(question.id)
    setRows(initial(question))
    setExpanded(false)
    setAdding(false)
    setDraftName('')
    setDraftReason('')
  }

  const set = (index: number, patch: Partial<TestDecision>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const submit = () => {
    const outcome = resolveTests(question, rows)
    if (outcome.action === 'change') onChange(outcome.drafts, outcome.summary, outcome.note)
    else if (outcome.action === 'flag') onFlag(outcome.summary, outcome.note ?? '')
    else onAccept(outcome.summary)
  }

  const addRow = () => {
    const name = draftName.trim()
    if (!name) return
    setRows((prev) => [
      ...prev,
      {
        name,
        reason: draftReason.trim() || 'Your clinic wants this before the visit.',
        source: 'suggested',
        kept: true,
      },
    ])
    setDraftName('')
    setDraftReason('')
    setAdding(false)
  }

  const nothingToShow = rows.length === 0

  return (
    <div className="mt-5">
      {/* Which patients this is about */}
      <p className="text-[14px] font-medium leading-snug text-ink">{question.groupLine}</p>
      {question.fullText.length > 0 && (
        <div className="mt-1">
          <button onClick={() => setExpanded((e) => !e)} className={QUIET_LINK}>
            {expanded ? 'Hide the guideline’s wording' : 'The guideline’s wording'}
          </button>
          {expanded && (
            <ul className="mt-1.5 space-y-1 border-l-2 border-line pl-3">
              {question.fullText.map((text) => (
                <li key={text} className="text-[12.5px] leading-6 text-muted">
                  {text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {recorded?.summary && (
        <p className="mt-2 text-[12.5px] italic text-muted">You said: {recorded.summary}</p>
      )}

      {nothingToShow ? (
        <p className="mt-4 text-[14px] leading-7 text-ink">Nothing needs doing before this visit.</p>
      ) : (
        <>
          {question.suggested && (
            <p className="mt-4 text-[12.5px] font-medium uppercase tracking-wide text-muted">
              Suggested — the guideline didn’t specify any
            </p>
          )}
          <ul className={`${question.suggested ? 'mt-2' : 'mt-4'} divide-y divide-line rounded-lg border border-line`}>
            {rows.map((row, i) => (
              <li key={`${row.name}-${i}`} className={`px-3.5 py-3 ${row.kept ? '' : 'bg-bg'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className={`text-[14px] leading-snug ${
                        row.kept ? 'font-medium text-ink' : 'text-muted line-through'
                      }`}
                    >
                      {row.name}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-6 text-muted">{row.reason}</p>
                    {row.protocol && <p className="text-[12.5px] leading-6 text-muted">{row.protocol}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => set(i, { kept: true })}
                      disabled={busy}
                      className={`rounded-md px-2.5 py-1 text-[13px] font-medium ${
                        row.kept ? 'bg-sky text-accent-strong' : 'text-muted hover:text-ink'
                      }`}
                    >
                      Keep
                    </button>
                    <button
                      onClick={() => set(i, { kept: false, unavailable: false })}
                      disabled={busy}
                      className={`rounded-md px-2.5 py-1 text-[13px] font-medium ${
                        row.kept ? 'text-muted hover:text-danger' : 'bg-bg text-danger'
                      }`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {row.kept &&
                  (row.unavailable ? (
                    <p className="mt-1.5 text-[12.5px] text-muted">
                      We’ll keep it on the list and flag it in your record.
                    </p>
                  ) : (
                    <button onClick={() => set(i, { unavailable: true })} disabled={busy} className={`${QUIET_LINK} mt-1.5`}>
                      We can’t get this here
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </>
      )}

      {adding && (
        <div className="mt-3 space-y-2 rounded-md border border-line bg-bg p-3">
          <div className="flex flex-wrap gap-2">
            <input
              className={`${FIELD} w-56`}
              placeholder="What should be done first?"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
            <input
              className={`${FIELD} flex-1`}
              placeholder="Why (one line)"
              value={draftReason}
              onChange={(e) => setDraftReason(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={addRow} disabled={busy || !draftName.trim()} className={SAFE_BUTTON}>
              Add it
            </button>
            <button onClick={() => setAdding(false)} className="text-[13px] text-muted hover:text-ink">
              cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-4">
        <button onClick={submit} disabled={busy} className={SAFE_BUTTON}>
          {nothingToShow ? '✓ That’s right' : '✓ Order these'}
        </button>
        {!adding && (
          <button onClick={() => setAdding(true)} disabled={busy} className={QUIET_LINK}>
            Add something
          </button>
        )}
      </div>
    </div>
  )
}
