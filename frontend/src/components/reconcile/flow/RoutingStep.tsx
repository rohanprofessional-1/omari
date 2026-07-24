import { useState } from 'react'
import type { Urgency } from '../../../types/tree'
import {
  assignmentDrafts,
  assignmentSummary,
  bindAllDrafts,
  bindAllSummary,
  oneAtATimeSummary,
  ROUTING_COPY,
  SEND_TO_PERSON,
  URGENCY_CHOICES,
  type RoutingAssignment,
  type RoutingDestination,
  type RoutingQuestion,
} from '../../../lib/reconcile/questions/routing'
import type { StepProps } from '../../../lib/reconcile/types'

/**
 * Blume — "Who sees what": the controls under the question.
 *
 * This is the screen that decides which surgeon a referral lands on, so it is
 * built to be answered rather than operated: a handful of rows, each already
 * carrying a defensible answer, one button that saves them all together.
 *
 * Two things it will not do. It will not put a name in a picker that the
 * guideline's own area of care doesn't support — an unassigned destination is
 * an honest state and says so out loud. And it will not show a surgeon a
 * seventeen-word guideline sentence as a row title; the short form leads, the
 * guideline's exact words are one click away, unaltered, with the sentence
 * they came from.
 */

interface RowState {
  specialistId: string
  urgency: Urgency
}

interface Local {
  id: string
  rows: Record<string, RowState>
  open: Record<string, boolean>
}

function initial(question: RoutingQuestion): Local {
  const rows: Record<string, RowState> = {}
  for (const d of question.destinations) {
    rows[d.node.id] = { specialistId: d.suggestedId, urgency: d.urgency }
  }
  return { id: question.id, rows, open: {} }
}

export default function RoutingStep({ question, busy, recorded, onAccept, onChange }: StepProps<RoutingQuestion>) {
  const [local, setLocal] = useState<Local>(() => initial(question))

  // The shell reuses this component across every screen in the section, so the
  // answers have to follow the question, not the mount.
  if (local.id !== question.id) setLocal(initial(question))
  const state = local.id === question.id ? local : initial(question)

  const answered = recorded?.status === 'changed' || recorded?.status === 'accepted'

  /* ---------------- The one-surgeon shortcut ---------------- */

  if (question.mode === 'all') {
    const candidate = question.candidate
    if (!candidate) return null
    return (
      <div className="mt-5">
        {answered && <p className="mb-3 text-[12.5px] text-muted">{ROUTING_COPY.answeredAlready}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={busy}
            onClick={() => {
              const drafts = bindAllDrafts(question.destinations, candidate)
              const summary = bindAllSummary(question.destinations, candidate)
              if (drafts.length === 0) onAccept(summary)
              else onChange(drafts, summary)
            }}
            className="rounded-md bg-accent-strong px-3.5 py-2 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✓ Yes, all to {candidate.name}
          </button>
          <button
            disabled={busy}
            onClick={() => onAccept(oneAtATimeSummary())}
            className="rounded-md border border-accent/50 px-3.5 py-2 text-[14px] font-medium text-accent-strong hover:bg-sky disabled:opacity-40"
          >
            {ROUTING_COPY.oneAtATime}
          </button>
        </div>
      </div>
    )
  }

  /* ---------------- One screen of destinations ---------------- */

  const rowOf = (d: RoutingDestination): RowState =>
    state.rows[d.node.id] ?? { specialistId: d.suggestedId, urgency: d.urgency }

  const setRow = (d: RoutingDestination, patch: Partial<RowState>) =>
    setLocal((prev) => {
      const before = prev.rows[d.node.id] ?? { specialistId: d.suggestedId, urgency: d.urgency }
      return { ...prev, rows: { ...prev.rows, [d.node.id]: { ...before, ...patch } } }
    })

  const toggleOpen = (d: RoutingDestination) =>
    setLocal((prev) => ({ ...prev, open: { ...prev.open, [d.node.id]: !prev.open[d.node.id] } }))

  const save = () => {
    const assignments: RoutingAssignment[] = question.destinations.map((d) => ({
      destination: d,
      ...rowOf(d),
    }))
    const drafts = assignmentDrafts(assignments, question.roster)
    const summary = assignmentSummary(assignments, question.roster)
    if (drafts.length === 0) onAccept(summary)
    else onChange(drafts, summary)
  }

  return (
    <div className="mt-5">
      {answered && <p className="mb-3 text-[12.5px] text-muted">{ROUTING_COPY.answeredAlready}</p>}

      <ul className="divide-y divide-line border-y border-line">
        {question.destinations.map((d) => {
          const row = rowOf(d)
          const open = state.open[d.node.id] === true
          const hasWording = d.fullText !== '' || d.clinicalBasis !== ''
          return (
            <li key={d.node.id} className="py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium leading-snug text-ink">{d.title}</p>
                  {hasWording && (
                    <button
                      onClick={() => toggleOpen(d)}
                      aria-expanded={open}
                      className="mt-1 text-[12.5px] text-accent underline decoration-line underline-offset-2 hover:text-accent-strong"
                    >
                      {open ? ROUTING_COPY.hideWording : ROUTING_COPY.showWording}
                    </button>
                  )}
                  {open && (
                    <div className="mt-1.5 rounded-md border border-line bg-bg px-3 py-2">
                      {d.fullText && (
                        <p className="text-[12.5px] leading-6 text-ink">“{d.fullText}”</p>
                      )}
                      {d.clinicalBasis && (
                        <p className={`text-[12.5px] leading-6 text-muted${d.fullText ? ' mt-1.5' : ''}`}>
                          {ROUTING_COPY.fromGuideline} “{d.clinicalBasis}”
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <select
                  aria-label={`${ROUTING_COPY.whoLabel} — ${d.title}`}
                  disabled={busy}
                  value={row.specialistId}
                  onChange={(e) => setRow(d, { specialistId: e.target.value })}
                  className="w-[15rem] max-w-full shrink-0 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13.5px] text-ink"
                >
                  <option value="">{ROUTING_COPY.noOne}</option>
                  {question.roster.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                      {person.specialty ? ` — ${person.specialty}` : ''}
                    </option>
                  ))}
                  <option value={SEND_TO_PERSON}>{ROUTING_COPY.sendToPerson}</option>
                </select>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-muted">{ROUTING_COPY.howSoonLabel}</span>
                {URGENCY_CHOICES.map((choice) => {
                  const on = row.urgency === choice.value
                  return (
                    <button
                      key={choice.value}
                      disabled={busy}
                      aria-pressed={on}
                      onClick={() => setRow(d, { urgency: choice.value })}
                      className={`rounded-full border px-2.5 py-1 text-[12.5px] ${
                        on
                          ? 'border-accent/60 bg-sky font-medium text-accent-strong'
                          : 'border-line text-muted hover:text-ink'
                      } disabled:opacity-40`}
                    >
                      {choice.label}
                    </button>
                  )
                })}
              </div>

              {row.specialistId === '' && (
                <p className="mt-2 text-[12.5px] leading-6 text-muted">{ROUTING_COPY.noOneNote}</p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-4">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-accent-strong px-3.5 py-2 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ROUTING_COPY.save}
        </button>
      </div>
    </div>
  )
}
