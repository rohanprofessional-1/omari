import { useState } from 'react'
import type { DeltaDraft } from '../../../lib/deltas/api'
import type { ScopeGroup, ScopeQuestion } from '../../../lib/reconcile/questions/scope'
import type { StepProps } from '../../../lib/reconcile/types'

/**
 * Blume — "What you treat", the first screen after the opening one.
 *
 * Two shapes, one contract. When the guideline really does cover several
 * kinds of patient, this is a checklist with everything already ticked: the
 * one-click answer is "we handle all of these" and it writes nothing.
 * Unchecking is the only thing that writes, and what it writes never deletes
 * anything — those patients go to a person instead of being routed.
 *
 * When the guideline covers ONE narrow population (the common case for an
 * appropriateness table), a checklist of one is not a question. So we confirm
 * the population instead, and the "we see more than that" answer deliberately
 * changes NOTHING automatically — widening what a clinic treats is a clinical
 * judgement no software should infer. It goes to a person.
 */

const SAFE_BUTTON =
  'rounded-md border border-accent/50 px-3.5 py-2 text-[14px] font-medium text-accent-strong hover:bg-sky disabled:opacity-40'
const ACTION_BUTTON =
  'rounded-md bg-accent-strong px-3.5 py-2 text-[14px] font-medium text-white hover:opacity-90 disabled:opacity-40'
const TEXT_INPUT =
  'mt-1.5 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13.5px] text-ink placeholder:text-muted/60'

export default function ScopeStep({ question, busy, recorded, onAccept, onChange, onFlag }: StepProps<ScopeQuestion>) {
  return (
    <>
      {question.mode === 'confirm' ? (
        <ConfirmCovers question={question} busy={busy} onAccept={onAccept} onFlag={onFlag} />
      ) : (
        <Checklist question={question} busy={busy} onAccept={onAccept} onChange={onChange} />
      )}
      {recorded?.summary && <p className="mt-3 text-[12.5px] text-muted">Last time you said: {recorded.summary}</p>}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Two or more real choices                                                   */
/* -------------------------------------------------------------------------- */

function Checklist({
  question,
  busy,
  onAccept,
  onChange,
}: {
  question: ScopeQuestion
  busy: boolean
  onAccept: StepProps<ScopeQuestion>['onAccept']
  onChange: StepProps<ScopeQuestion>['onChange']
}) {
  const [off, setOff] = useState<Set<string>>(new Set())
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (setter: typeof setOff) => (id: string) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const total = question.groups.length
  const dropped = question.groups.filter((g) => off.has(g.id))
  const kept = total - dropped.length

  const submit = () => {
    if (dropped.length === 0) {
      onAccept(`You handle all ${total} of these.`)
      return
    }
    const drafts: DeltaDraft[] = dropped.map((g) => ({
      payload: {
        op: 'set_scope',
        branch: g.anchor,
        reason: reasons[g.id]?.trim() || 'Not treated at this clinic',
      },
    }))
    const note = dropped
      .map((g) => reasons[g.id]?.trim())
      .filter((r): r is string => Boolean(r))
      .join('; ')
    onChange(
      drafts,
      `You handle ${kept} of ${total} — the other ${dropped.length} will go to a person to review.`,
      note || undefined,
    )
  }

  return (
    <>
      <ul className="mt-5 space-y-2">
        {question.groups.map((group) => (
          <Row
            key={group.id}
            group={group}
            unchecked={off.has(group.id)}
            expanded={open.has(group.id)}
            busy={busy}
            reason={reasons[group.id] ?? ''}
            onToggle={() => toggle(setOff)(group.id)}
            onExpand={() => toggle(setOpen)(group.id)}
            onReason={(value) => setReasons((r) => ({ ...r, [group.id]: value }))}
          />
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button onClick={submit} disabled={busy} className={dropped.length === 0 ? SAFE_BUTTON : ACTION_BUTTON}>
          {dropped.length === 0 ? '✓ We handle all of these' : 'Save and continue'}
        </button>
        {dropped.length > 0 && (
          <span className="text-[13px] text-muted">
            {dropped.length === 1 ? 'One kind of referral' : `${dropped.length} kinds of referral`} will go to a person
            to review.
          </span>
        )}
      </div>
    </>
  )
}

function Row({
  group,
  unchecked,
  expanded,
  busy,
  reason,
  onToggle,
  onExpand,
  onReason,
}: {
  group: ScopeGroup
  unchecked: boolean
  expanded: boolean
  busy: boolean
  reason: string
  onToggle: () => void
  onExpand: () => void
  onReason: (value: string) => void
}) {
  return (
    <li className={`rounded-lg border px-4 py-3 ${unchecked ? 'border-line/60 bg-bg' : 'border-line bg-canvas'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={!unchecked}
          disabled={busy}
          onChange={onToggle}
          className="mt-[3px] h-[15px] w-[15px] shrink-0 accent-accent-strong"
          aria-label={group.label}
        />
        <div className="min-w-0 flex-1">
          <button
            onClick={onToggle}
            disabled={busy}
            className={`block text-left text-[14px] leading-6 ${
              unchecked ? 'text-muted line-through' : 'font-medium text-ink'
            }`}
          >
            {group.label}
          </button>
          <button
            onClick={onExpand}
            className="mt-0.5 text-[12.5px] text-accent underline decoration-line underline-offset-2 hover:text-accent-strong"
          >
            {expanded ? 'Hide details' : 'What this covers'}
          </button>
          {expanded && (
            <div className="mt-2 rounded-md bg-bg px-3 py-2.5">
              {group.examples.length > 0 && (
                <>
                  <p className="text-[12.5px] font-medium text-ink">Patients who…</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] leading-6 text-muted">
                    {group.examples.map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className={`text-[12.5px] leading-6 text-muted ${group.examples.length > 0 ? 'mt-2' : ''}`}>
                The guideline says: “{group.guidelineWording}”
              </p>
            </div>
          )}
        </div>
      </div>

      {unchecked && (
        <div className="mt-2.5 pl-[27px]">
          <label className="block text-[12.5px] text-muted" htmlFor={`why-${group.id}`}>
            Why not? (optional)
          </label>
          <input
            id={`why-${group.id}`}
            value={reason}
            disabled={busy}
            onChange={(e) => onReason(e.target.value)}
            placeholder="e.g. we don't see patients under 18"
            className={TEXT_INPUT}
          />
        </div>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* One narrow population — confirm it, or tell a person                       */
/* -------------------------------------------------------------------------- */

function ConfirmCovers({
  question,
  busy,
  onAccept,
  onFlag,
}: {
  question: ScopeQuestion
  busy: boolean
  onAccept: StepProps<ScopeQuestion>['onAccept']
  onFlag: StepProps<ScopeQuestion>['onFlag']
}) {
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          onClick={() => onAccept(`That's right — you only see ${question.covers}.`)}
          disabled={busy}
          className={SAFE_BUTTON}
        >
          ✓ That's right for us
        </button>
        <button
          onClick={() => setAsking(true)}
          disabled={busy}
          className="text-[13.5px] text-muted underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-40"
        >
          We also see other patients →
        </button>
      </div>

      {asking && (
        <div className="mt-4 rounded-lg border border-line bg-bg px-4 py-3">
          <label className="block text-[13px] text-ink" htmlFor="also-see">
            What else do you see? We'll flag it for follow-up.
          </label>
          <input
            id="also-see"
            autoFocus
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. we also see teenagers with sports injuries"
            className={TEXT_INPUT}
          />
          <button
            onClick={() => onFlag('You also see other patients — flagged for follow-up.', note.trim())}
            disabled={busy || note.trim().length === 0}
            className={`mt-3 ${ACTION_BUTTON}`}
          >
            Flag it and continue
          </button>
        </div>
      )}
    </>
  )
}
