import { useEffect, useState } from 'react'
import type { DeltaDraft } from '../../../lib/deltas/api'
import {
  acceptSummary,
  changeSummary,
  flagSummary,
  tallyLine,
  type CaseChoice,
  type CaseQuestion,
} from '../../../lib/reconcile/questions/cases'
import type { StepProps } from '../../../lib/reconcile/types'

/**
 * Blume — "Check it against real patients", one referral per screen.
 *
 * The conclusion AND its reasoning are the first things on the screen, and
 * they are the loudest things on it. A surgeon should be able to disagree
 * with WHY before ever being asked whether the destination is right — the
 * old workbench hid the derivation until you clicked "wrong", which is
 * exactly backwards.
 *
 * Agreeing writes nothing. Disagreeing writes ONE `retarget_branch` against
 * ONE decision on this referral's own path — the last one by default, because
 * that is the usual culprit — and every other referral is re-checked against
 * the fix by the recompile the shell triggers.
 */

/** Agreements so far, this sitting. Presentation only: losing it costs a
 *  sentence of encouragement, never anything clinical. */
const answered = new Map<string, 'agreed' | 'changed'>()

interface Draft {
  id: string
  choiceId: string
  note: string
  stepIndex: number
  showSteps: boolean
  showFull: boolean
}

export default function CaseStep({ question, busy, recorded, onAccept, onChange, onFlag }: StepProps<CaseQuestion>) {
  const [draft, setDraft] = useState<Draft>(() => fresh(question))
  // The shell keeps this component mounted across referrals, so a new
  // question has to clear the last one's half-written answer.
  if (draft.id !== question.id) setDraft(fresh(question))

  useEffect(() => {
    if (recorded?.status === 'accepted') answered.set(question.id, 'agreed')
    else if (recorded?.status === 'changed') answered.set(question.id, 'changed')
  }, [question.id, recorded?.status])

  if (question.unavailable) {
    return (
      <div className="mt-5">
        <button
          onClick={() => onAccept(acceptSummary(question))}
          disabled={busy}
          className="rounded-lg bg-accent-strong px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40"
        >
          {question.acceptLabel}
        </button>
      </div>
    )
  }

  const decision = question.decisions[draft.stepIndex] ?? question.decisions[question.decisions.length - 1]
  const choice = question.choices.find((c) => c.id === draft.choiceId)
  const correctable = question.decisions.length > 0 && question.choices.length > 0

  const agree = () => {
    answered.set(question.id, 'agreed')
    onAccept(acceptSummary(question))
  }

  const disagree = (picked: CaseChoice) => {
    if (!decision) return
    const note = draft.note.trim()
    const target =
      picked.target.kind === 'escalation' && note
        ? ({ kind: 'escalation', reason: note } as const)
        : picked.target
    const drafts: DeltaDraft[] = [
      {
        payload: { op: 'retarget_branch', branch: decision.branch, target },
        provenance: {
          deviatesFromCpg: true,
          rationale: note,
          ...(question.cpgBasis ? { cpgBasis: question.cpgBasis } : {}),
        },
      },
    ]
    answered.set(question.id, 'changed')
    onChange(drafts, changeSummary(decision, picked), note || undefined)
  }

  // The tally counts the referrals BEFORE this one — "so far" is honest only
  // if the one on screen hasn't been counted yet.
  const others = [...answered.entries()].filter(([id]) => id !== question.id)
  const tally = tallyLine(others.filter(([, v]) => v === 'agreed').length, others.length, question.total)

  return (
    <div className="mt-5">
      {/* The referral, in the referrer's words. */}
      <p className="rounded-lg border border-line bg-bg px-4 py-3 text-[14px] leading-7 text-ink">
        {question.narrative}
      </p>

      {/* The conclusion — the loudest thing on the screen. */}
      <p className="mt-5 text-[13px] text-muted">{question.lead}</p>
      <div className="mt-1.5 rounded-lg border border-line border-l-[3px] border-l-accent-strong bg-sky px-4 py-3.5">
        {question.shape === 'unsaid' ? (
          <p className="text-[19px] font-medium leading-snug text-ink">{question.unsaidSentence}</p>
        ) : (
          <p className="text-[19px] font-medium leading-snug text-ink">
            {question.destination}
            <span className="font-normal text-muted"> — {question.urgency}</span>
          </p>
        )}
        <p className="mt-1.5 text-[14px] leading-6 text-muted">{question.testsLine}</p>
        {question.destinationFull && (
          <div className="mt-2">
            <button
              onClick={() => setDraft({ ...draft, showFull: !draft.showFull })}
              className="text-[12.5px] text-accent underline decoration-line underline-offset-2"
            >
              {draft.showFull ? 'Hide the guideline’s full wording' : 'The guideline’s full wording'}
            </button>
            {draft.showFull && <p className="mt-1.5 text-[13px] leading-6 text-muted">{question.destinationFull}</p>}
          </div>
        )}
      </div>

      {/* …and the reasoning, before anything is asked. */}
      <p className="mt-3 text-[14px] leading-7 text-muted">
        <span className="font-medium text-ink">{question.reasonLead}</span> {question.reason}.
      </p>

      <p className="mt-4 text-[12.5px] text-muted">{tally}</p>

      {/* Agree — one click, and it writes nothing. */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={agree}
          disabled={busy}
          className="rounded-lg bg-accent-strong px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40"
        >
          {question.acceptLabel}
        </button>
      </div>

      {/* Disagree — pick where it should have gone. */}
      {correctable ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px] text-muted">
          <span>{question.rejectLead}</span>
          <select
            value={draft.choiceId}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, choiceId: e.target.value })}
            className="rounded-md border border-line bg-canvas px-2 py-1.5 text-[13.5px] text-ink"
          >
            <option value="">choose…</option>
            {question.choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {question.rejectSuffix && <span>{question.rejectSuffix}</span>}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-[13px] text-muted">
            There's no earlier step here to change — tell us what looks wrong and we'll come back to it.
          </p>
          <input
            value={draft.note}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Why? (optional)"
            className="w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-[13.5px] text-ink placeholder:text-muted/70"
          />
          <button
            onClick={() => onFlag(flagSummary(), draft.note.trim())}
            disabled={busy || !draft.note.trim()}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-muted hover:text-ink disabled:opacity-40"
          >
            Make a note for us
          </button>
        </div>
      )}

      {/* Everything below only exists once they've said "no". */}
      {correctable && choice && decision && (
        <div className="mt-3 rounded-lg border border-line bg-bg px-4 py-3.5">
          <p className="text-[13.5px] leading-6 text-ink">
            We'll fix the step that got it wrong:{' '}
            <span className="text-muted">“{decision.asked}”</span> — {decision.answer}. Everyone whose answer was
            “{decision.group}” goes to {choice.target.kind === 'escalation' ? 'a person to review' : choice.label}{' '}
            instead.
          </p>

          {question.decisions.length > 1 && (
            <div className="mt-2">
              <button
                onClick={() => setDraft({ ...draft, showSteps: !draft.showSteps })}
                className="text-[12.5px] text-accent underline decoration-line underline-offset-2"
              >
                {draft.showSteps ? 'Never mind — keep the last step' : 'A different step got it wrong'}
              </button>
              {draft.showSteps && (
                <div className="mt-2 space-y-1.5">
                  {question.decisions.map((d, i) => (
                    <label key={i} className="flex cursor-pointer items-start gap-2 text-[13px] leading-6 text-ink">
                      <input
                        type="radio"
                        name={`decision-${question.id}`}
                        checked={draft.stepIndex === i}
                        onChange={() => setDraft({ ...draft, stepIndex: i })}
                        className="mt-1.5"
                      />
                      <span>
                        <span className="text-muted">“{d.asked}”</span> — {d.answer} → “{d.group}”
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <input
            value={draft.note}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Why? (optional)"
            className="mt-2.5 w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-[13.5px] text-ink placeholder:text-muted/70"
          />

          <div className="mt-2.5 flex items-center gap-3">
            <button
              onClick={() => disagree(choice)}
              disabled={busy}
              className="rounded-lg bg-accent-strong px-3.5 py-1.5 text-[13.5px] font-semibold text-white disabled:opacity-40"
            >
              Save this change
            </button>
            <button
              onClick={() => setDraft({ ...draft, choiceId: '', showSteps: false })}
              disabled={busy}
              className="text-[13px] text-muted hover:text-ink"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function fresh(question: CaseQuestion): Draft {
  return {
    id: question.id,
    choiceId: '',
    note: '',
    // The LAST decision is the usual culprit — preselected.
    stepIndex: Math.max(question.decisions.length - 1, 0),
    showSteps: false,
    showFull: false,
  }
}
