import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/authStore'
import { applyAction } from '../../dashboard/lib/reviewStore'
import { formatDate, formatDateShort } from '../../dashboard/lib/demoClock'
import { humanWait, type PlanTest } from './carePlan'
import { isBehindUs, type JourneyEvent } from './journey'
import { usePatientReferral } from './usePatientReferral'

/**
 * "My referral" — one column, read top to bottom, in order of urgency:
 *
 *   1. DO THIS NEXT — the handful of things only the patient can do.
 *   2. THE JOURNEY  — dated proof that the rest is moving without them.
 *   3. THE LIST     — everything, finished and unfinished.
 *
 * The order is the whole design. A patient opening this page is asking "is
 * there anything I'm supposed to be doing?", and any layout that answers that
 * third answers it too late. So the actions are lifted out of the checklist
 * and given the top of the page with their own buttons; the checklist below
 * still holds them, because "what's left" and "what do I do right now" are
 * different questions and only one of them fits in a banner.
 *
 * ⚠️ DENYLIST. Patient-facing language only. This screen must NEVER show:
 *   result.confidence / confidenceReason   — how sure the model was
 *   result.pathTaken                       — the decision path
 *   missingVariables[].clinicalPrompt      — clinician phrasing
 *   escalationReason / escalationCategory  — why a human was pulled in
 *   routedTo.specialty                     — say "Dr. Saltzman's team" instead
 *   the word "rejected"                    — a redirect is not a rejection
 * If a future change needs one of these, the answer is a new patient-safe
 * field, not a re-use of the clinician one.
 */

const CARD = 'rounded-xl border border-line bg-canvas p-5 shadow-subtle'

interface Action {
  title: string
  why: string
  cta: string
}

/* ── 1 · Do this next ────────────────────────────────────────────────────── */

function ActionPanel({ actions }: { actions: Action[] }) {
  return (
    <section className="rounded-xl border border-accent-strong/20 bg-sky p-5">
      <h2 className="text-caption uppercase text-accent-strong">Do this next</h2>
      <ol className="mt-3 divide-y divide-accent-strong/10">
        {actions.map((action, i) => (
          <li key={action.title} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <span
              aria-hidden
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-strong text-[11px] font-semibold text-white"
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink">{action.title}</span>
              <span className="block text-[13px] leading-snug text-muted">{action.why}</span>
            </span>
            <button
              onClick={() => alert('Appointment scheduling coming soon')}
              className="shrink-0 rounded-md bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#27508f]"
            >
              {action.cta}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Nothing to act on — said plainly, so silence never reads as a broken page. */
function CalmPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className={CARD}>
      <h2 className="text-caption uppercase text-muted">Do this next</h2>
      <p className="mt-2 text-[15px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
    </section>
  )
}

function MissingInfoPanel({
  referralId,
  reason,
}: {
  referralId: string
  reason: string
}) {
  const { user } = useAuth()
  const [info, setInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = () => {
    if (!info.trim() || !user) return
    setSubmitting(true)
    // Send it back to pending with the provided info as a note
    applyAction(referralId, 'pending', {
      actor: user.name,
      role: user.role,
      note: info,
    })
    // UI will optimistically update based on usePatientReferral
  }

  return (
    <section className="rounded-xl border border-danger/30 bg-[#fdf5f5] p-5 shadow-sm">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-danger/90">
        Missing Information Needed
      </h2>
      <p className="mt-2 text-[15px] font-semibold text-ink">
        The clinic requested more details before they can proceed.
      </p>
      {reason && (
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink/80 italic border-l-2 border-danger/30 pl-3">
          "{reason}"
        </p>
      )}
      <div className="mt-4">
        <textarea
          value={info}
          onChange={(e) => setInfo(e.target.value)}
          placeholder="Type your answer here..."
          className="w-full resize-y rounded-md border border-line bg-white p-3 text-[14px] text-ink shadow-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          rows={3}
          disabled={submitting}
        />
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={!info.trim() || submitting}
            className="rounded-md bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Send details'}
          </button>
        </div>
      </div>
    </section>
  )
}

/* ── 2 · The journey ─────────────────────────────────────────────────────── */

function JourneyRail({ events }: { events: JourneyEvent[] }) {
  return (
    <ol>
      {events.map((event, i) => {
        const happened = event.state === 'past' || isBehindUs(event.at)
        const last = i === events.length - 1
        return (
          <li
            key={`${event.at}-${event.title}`}
            className="grid grid-cols-[58px_12px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0"
          >
            <span className="pt-px text-right text-[12px] tabular-nums text-muted">
              {formatDateShort(event.at)}
            </span>
            <span className="relative flex justify-center">
              {!last && <span aria-hidden className="absolute top-3.5 h-full w-px bg-line" />}
              <span
                aria-hidden
                className={`relative mt-1 h-[11px] w-[11px] rounded-full border-2 ${
                  happened ? 'border-accent bg-accent' : 'border-line bg-canvas'
                }`}
              />
            </span>
            <span className="min-w-0 pb-1">
              <span className="block text-[13px] font-medium leading-snug text-ink">
                {event.title}
              </span>
              {event.detail && (
                <span className="block text-[12px] leading-snug text-muted">{event.detail}</span>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/* ── 3 · The list ────────────────────────────────────────────────────────── */

function Tick({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
        done ? 'border-success-light bg-success-light text-white' : 'border-line bg-canvas'
      }`}
    >
      {done ? '✓' : ''}
    </span>
  )
}

function TaskRow({ test }: { test: PlanTest }) {
  const trailing = test.done
    ? 'Result in'
    : !test.bookable
      ? 'Bring it with you'
      : test.booking
        ? `Booked · ${formatDate(test.booking.at)}`
        : null

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Tick done={test.done} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13.5px] ${test.done ? 'text-muted' : 'font-medium text-ink'}`}>
          {test.bookable ? test.modality.kind : test.name}
        </span>
        {test.bookable && <span className="block text-[12px] text-muted">{test.name}</span>}
        {!test.done && test.bookable && !test.booking && (
          <span className="block text-[12px] text-muted">Needed by {formatDate(test.dueBy)}</span>
        )}
      </span>
      {trailing ? (
        <span className="shrink-0 pt-0.5 text-[12px] text-muted">{trailing}</span>
      ) : (
        <Link
          to="/patient/appointments"
          className="shrink-0 pt-0.5 text-[12px] font-medium text-accent hover:underline"
        >
          Book a time →
        </Link>
      )}
    </li>
  )
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

export default function MyReferralScreen() {
  const { loading, referral, redirected, careTeam, plan, journey, status, review } = usePatientReferral()

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="h-40 animate-pulse rounded-xl bg-line/50 motion-reduce:animate-none" />
      </div>
    )
  }

  if (!referral) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
        <h1 className="text-heading-sm text-ink">No referral yet</h1>
        <p className="mt-2 text-[13px] text-muted">
          Once you’ve told us what’s going on, your referral will show up here.
        </p>
        <Link
          to="/patient/intake"
          className="mt-4 inline-block rounded-md bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#27508f]"
        >
          Start intake
        </Link>
      </div>
    )
  }

  if (redirected) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <h1 className="text-heading-sm text-ink">Your referral</h1>
        <div className={`${CARD} mt-5`}>
          <p className="text-[15px] font-semibold text-ink">Sent to a different service</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            After reviewing what you shared, our team thought another service is a better fit for
            what’s going on. They’ll be in touch about where to go next — you don’t need to do
            anything right now.
          </p>
        </div>
      </div>
    )
  }

  const { approved, consultation, daysToConsultation, tests, toBook, doneCount, total } = plan
  const left = tests.filter((t) => !t.done)
  const finished = tests.filter((t) => t.done)

  // The actionable set, most urgent first: the date, then whatever is unbooked
  // and soonest needed. Only things the PATIENT can move appear here.
  const actions: Action[] = []
  if (approved && !consultation) {
    actions.push({
      title: 'Pick your consultation date',
      why: `We texted you the next openings with ${careTeam} — choose one and we’ll confirm it.`,
      cta: 'Choose a date',
    })
  }
  for (const test of [...toBook].sort((a, b) => a.dueBy.localeCompare(b.dueBy))) {
    actions.push({
      title: `Book your ${test.modality.kind.toLowerCase()}`,
      why: `These book up about ${test.modality.leadDays} days ahead, and the result is needed by ${formatDate(test.dueBy)}.`,
      cta: 'Find a time',
    })
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <h1 className="text-heading-sm text-ink">Your referral</h1>
        {consultation && (
          <p className="ml-auto text-[13px] text-muted">
            Consultation{' '}
            <span className="font-semibold text-ink">{formatDate(consultation.at)}</span> ·{' '}
            {humanWait(daysToConsultation ?? 0)}
          </p>
        )}
      </div>
      <p className="mt-1 text-[13px] text-muted">
        We’ll keep this up to date as things move — you don’t need to chase anyone.
      </p>

      <div className="mt-5 space-y-4">
        {/* 1 · What only you can do */}
        {status === 'info_requested' ? (
          <MissingInfoPanel
            referralId={referral.payload.referralId}
            reason={review?.correction?.reason || 'Please provide additional details regarding your referral.'}
          />
        ) : actions.length > 0 ? (
          <ActionPanel actions={actions.slice(0, 3)} />
        ) : !approved ? (
          <CalmPanel
            title="Nothing needed from you yet"
            body={`${careTeam} is reading through what you shared — it usually takes a day or two. As soon as they approve it we’ll text you to pick your consultation date, and your test list will appear below.`}
          />
        ) : left.length === 0 ? (
          <CalmPanel
            title="You’re all set"
            body="Everything is back and your visit is booked. Turn up and your care team will have what they need to make a plan."
          />
        ) : (
          <CalmPanel
            title="Nothing to book right now"
            body="Everything is either booked or already back. We’ll text you if anything changes."
          />
        )}

        {actions.length > 3 && (
          <p className="text-[12px] text-muted">
            +{actions.length - 3} more in your list below.
          </p>
        )}

        {/* 2 · Proof it is moving */}
        <section className={CARD}>
          <h2 className="text-caption uppercase text-muted">Your referral, start to finish</h2>
          <div className="mt-4">
            <JourneyRail events={journey} />
          </div>
          {!approved && (
            <p className="mt-4 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
              Your consultation and tests will be added here the moment your referral is approved.
            </p>
          )}
        </section>

        {/* 3 · Everything, finished and unfinished */}
        {approved && tests.length > 0 && (
          <section className={CARD}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-[15px] font-semibold text-ink">
                Appointments &amp; tests
              </h2>
              <p className="ml-auto text-[13px] tabular-nums text-muted">
                <span className="font-semibold text-ink">{doneCount}</span> of {total} done
              </p>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {left.length === 0
                ? 'Everything is back. Your consultation can go straight to the plan.'
                : 'Getting these done before your visit is what turns the wait into progress — with results in hand you leave with a plan, not another list.'}
            </p>

            {left.length > 0 && (
              <>
                <p className="mt-4 text-caption uppercase text-muted">Still to do</p>
                <ul className="divide-y divide-line">
                  {left.map((test) => (
                    <TaskRow key={test.name} test={test} />
                  ))}
                </ul>
              </>
            )}

            {finished.length > 0 && (
              <>
                <p className="mt-4 text-caption uppercase text-muted">Finished</p>
                <ul className="divide-y divide-line">
                  {finished.map((test) => (
                    <TaskRow key={test.name} test={test} />
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-muted">
        Questions about any of this? Call the clinic — we’d rather you ask than wonder.
      </p>
    </div>
  )
}
