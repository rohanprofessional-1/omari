import { Fragment, useState } from 'react'
import {
  boundsFromCuts,
  cutoffDrafts,
  cutsPhrase,
  groupPreview,
  rangeWords,
  type Bounds,
  type CutoffQuestion,
} from '../../../lib/reconcile/questions/cutoffs'
import { formatNumber } from '../../../lib/reconcile/plainLabel'
import type { StepProps } from '../../../lib/reconcile/types'

/**
 * Blume — "Your cutoffs", one question per screen.
 *
 * The shell has already asked the question above this component. All that is
 * left is the answer, and the first answer offered is always the guideline's,
 * spelled out in the guideline's own words so keeping it is one click and
 * needs no arithmetic.
 *
 * Two things the old workbench did are deliberately gone. There is no
 * "this differs from the guideline" checkbox — a different number IS a
 * deviation, so the only question worth asking is why. And a wording
 * question never shows a number field, because the guideline never gave a
 * number and inventing one is not a setting a surgeon should be nudged into.
 */

const KEEP =
  'rounded-md border border-accent/50 px-3.5 py-2 text-[14px] font-medium text-accent-strong hover:bg-sky disabled:opacity-40'
const ALT =
  'rounded-md border border-line px-3.5 py-2 text-[14px] font-medium text-muted hover:text-ink disabled:opacity-40'
const SAVE =
  'rounded-md bg-accent-strong px-3.5 py-2 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-40'
const NUM = 'w-[4.5rem] rounded-md border border-line bg-bg px-2 py-1.5 text-center text-[14px] text-ink'
const LINE =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-[14px] text-ink placeholder:text-muted/60'

export default function CutoffStep(props: StepProps<CutoffQuestion>) {
  // Consecutive cutoff screens render the SAME component, so half-typed
  // numbers would follow a surgeon from one question to the next without
  // this. Remounting per question is the only way that can't leak.
  return <Body key={props.question.id} {...props} />
}

function Body(props: StepProps<CutoffQuestion>) {
  const { question } = props
  return (
    <div className="mt-5">
      {question.shape === 'wording' ? <Wording {...props} /> : question.shape === 'span' ? <Span {...props} /> : <Boundaries {...props} />}
      <p className="mt-4 text-[12.5px] leading-relaxed text-muted">{question.footer}</p>
      {props.recorded?.summary && (
        <p className="mt-1.5 text-[12.5px] text-muted">Last time: {props.recorded.summary}</p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Why — asked only when their number differs, never as a checkbox            */
/* -------------------------------------------------------------------------- */

function Why({ prompt, value, onValue }: { prompt: string; value: string; onValue: (v: string) => void }) {
  return (
    <div className="mt-3">
      <label className="block text-[13.5px] leading-relaxed text-ink">{prompt}</label>
      <input
        className={`mt-1.5 ${LINE}`}
        placeholder="One line — it goes in your sign-off record"
        value={value}
        onChange={(e) => onValue(e.target.value)}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* boundaries — one decision, several cut points                              */
/* -------------------------------------------------------------------------- */

function Boundaries({ question, busy, onAccept, onChange }: StepProps<CutoffQuestion>) {
  const [mine, setMine] = useState(false)
  const [fields, setFields] = useState<string[]>(() => question.cutPoints.map(formatNumber))
  const [why, setWhy] = useState('')

  const parsed = fields.map((f) => {
    const text = f.trim()
    if (text === '') return null
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  })
  const complete = parsed.every((p) => p !== null)
  // The preview never goes blank while they type: an unreadable field falls
  // back to the guideline's own number.
  const values = parsed.map((p, i) => (p === null ? question.cutPoints[i] : p))
  const ordered = values.every((v, i) => i === 0 || v > values[i - 1])
  const changed = values.some((v, i) => v !== question.cutPoints[i])
  const before = cutsPhrase(question.cutPoints, question.unit)
  const after = cutsPhrase(values, question.unit)

  const save = () => {
    onChange(
      cutoffDrafts(question, boundsFromCuts(values)),
      `Patients are now split at ${after} instead of ${before}.`,
      why.trim(),
    )
  }

  if (!mine) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button className={KEEP} disabled={busy} onClick={() => onAccept(question.keepSummary)}>
          {question.keepLabel}
        </button>
        <button className={ALT} disabled={busy} onClick={() => setMine(true)}>
          Use my numbers
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
        <span>Split at</span>
        {fields.map((f, i) => (
          <Fragment key={i}>
            {i > 0 && <span className={i === fields.length - 1 ? '' : '-ml-1.5'}>{i === fields.length - 1 ? 'and' : ','}</span>}
            <input
              className={NUM}
              inputMode="decimal"
              value={f}
              aria-label={`Cut point ${i + 1}`}
              onChange={(e) => setFields((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
            />
          </Fragment>
        ))}
        {question.unit && <span>{question.unit}</span>}
      </div>

      <p className="mt-2 text-[13px] text-muted">That gives you: {groupPreview(values, question.unit)}</p>

      {!complete && <p className="mt-1.5 text-[13px] text-danger">Fill in every number.</p>}
      {complete && !ordered && <p className="mt-1.5 text-[13px] text-danger">Put these in order, lowest first.</p>}

      {complete && ordered && changed ? (
        <Why prompt={`Your clinic splits at ${after} instead of ${before}. Why?`} value={why} onValue={setWhy} />
      ) : (
        <p className="mt-3 text-[13px] text-muted">Change a number to save, or keep the guideline's.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className={SAVE} disabled={busy || !complete || !ordered || !changed || !why.trim()} onClick={save}>
          Save my numbers
        </button>
        <button className="text-[13px] text-muted hover:text-ink" onClick={() => setMine(false)}>
          never mind
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* span — one accepted range                                                  */
/* -------------------------------------------------------------------------- */

function readBound(text: string): { value?: number; bad: boolean } {
  const t = text.trim()
  if (t === '') return { bad: false }
  const n = Number(t)
  return Number.isFinite(n) ? { value: n, bad: false } : { bad: true }
}

function Span({ question, busy, onAccept, onChange }: StepProps<CutoffQuestion>) {
  const [mine, setMine] = useState(false)
  const [low, setLow] = useState(question.span.min !== undefined ? formatNumber(question.span.min) : '')
  const [high, setHigh] = useState(question.span.max !== undefined ? formatNumber(question.span.max) : '')
  const [why, setWhy] = useState('')

  const lo = readBound(low)
  const hi = readBound(high)
  const next: Bounds = {
    ...(lo.value !== undefined ? { min: lo.value } : {}),
    ...(hi.value !== undefined ? { max: hi.value } : {}),
  }
  const readable = !lo.bad && !hi.bad
  const anyBound = lo.value !== undefined || hi.value !== undefined
  const inOrder = lo.value === undefined || hi.value === undefined || lo.value < hi.value
  const changed = next.min !== question.span.min || next.max !== question.span.max
  const before = rangeWords(question.span, question.unit)
  const after = rangeWords(next, question.unit)
  const ok = readable && anyBound && inOrder && changed

  const save = () => {
    onChange(cutoffDrafts(question, [next]), `You now see ${after} instead of ${before}.`, why.trim())
  }

  if (!mine) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button className={KEEP} disabled={busy} onClick={() => onAccept(question.keepSummary)}>
          {question.keepLabel}
        </button>
        <button className={ALT} disabled={busy} onClick={() => setMine(true)}>
          Use mine
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
        <span>From</span>
        <input className={NUM} inputMode="decimal" aria-label="Lowest" value={low} onChange={(e) => setLow(e.target.value)} />
        <span>to</span>
        <input className={NUM} inputMode="decimal" aria-label="Highest" value={high} onChange={(e) => setHigh(e.target.value)} />
        {question.unit && <span>{question.unit}</span>}
        <span className="text-[12.5px] text-muted">leave one blank for no limit</span>
      </div>

      {!readable && <p className="mt-2 text-[13px] text-danger">Numbers only, please.</p>}
      {readable && !anyBound && <p className="mt-2 text-[13px] text-danger">Fill in at least one of them.</p>}
      {readable && anyBound && !inOrder && (
        <p className="mt-2 text-[13px] text-danger">The first number needs to be lower than the second.</p>
      )}

      {ok ? (
        <Why prompt={`Your clinic sees ${after} instead of ${before}. Why?`} value={why} onValue={setWhy} />
      ) : (
        readable &&
        anyBound &&
        inOrder && <p className="mt-3 text-[13px] text-muted">Change a number to save, or keep the guideline's.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className={SAVE} disabled={busy || !ok || !why.trim()} onClick={save}>
          Save mine
        </button>
        <button className="text-[13px] text-muted hover:text-ink" onClick={() => setMine(false)}>
          never mind
        </button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* wording — no number was ever given, so no number is ever asked for         */
/* -------------------------------------------------------------------------- */

function Wording({ question, busy, onAccept, onFlag }: StepProps<CutoffQuestion>) {
  const [disagree, setDisagree] = useState(false)
  const [instead, setInstead] = useState('')

  if (!disagree) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button className={KEEP} disabled={busy} onClick={() => onAccept(question.keepSummary)}>
          {question.keepLabel}
        </button>
        <button className={ALT} disabled={busy} onClick={() => setDisagree(true)}>
          No — that doesn't work here
        </button>
      </div>
    )
  }

  return (
    <div>
      <label className="block text-[13.5px] text-ink">What would you split them on instead?</label>
      <input
        className={`mt-1.5 ${LINE}`}
        placeholder="In your own words"
        value={instead}
        onChange={(e) => setInstead(e.target.value)}
      />
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
        Nothing changes right now. This needs a conversation rather than a setting, so we'll list it at the end and
        keep the guideline's answer in the meantime.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className={SAVE}
          disabled={busy || !instead.trim()}
          onClick={() =>
            onFlag(
              `Flagged "${question.phrase}" — it doesn't fit how this clinic splits these patients.`,
              instead.trim(),
            )
          }
        >
          Flag it for me
        </button>
        <button className="text-[13px] text-muted hover:text-ink" onClick={() => setDisagree(false)}>
          never mind
        </button>
      </div>
    </div>
  )
}
