import { Link } from 'react-router-dom'
import StatusStepper from '../../components/StatusStepper'
import { daysUntil, formatDate } from '../../dashboard/lib/demoClock'
import { outstandingPatientItems, patientItems, usePatientReferral } from './usePatientReferral'

/**
 * "My referral" — where the patient's referral has got to, and what they
 * personally still need to do.
 *
 * ⚠️ DENYLIST. This screen renders patient-facing language only. It must NEVER
 * show, in any form:
 *   result.confidence / confidenceReason   — how sure the model was
 *   result.pathTaken                       — the decision path
 *   missingVariables[].clinicalPrompt      — clinician phrasing
 *   escalationReason / escalationCategory  — why a human was pulled in
 *   routedTo.specialty                     — say "Dr. Saltzman's team" instead
 *   the word "rejected"                    — a redirect is not a rejection
 * If a future change needs one of these, the answer is a new patient-safe
 * field, not a re-use of the clinician one.
 *
 * Main design tokens, not the dash- set: this belongs to the patient product,
 * the same warm-paper world as the intake conversation. Only the DATA comes
 * from the referral layer.
 */

const CARD = 'rounded-2xl border border-line bg-canvas p-5 shadow-[0_1px_3px_rgba(24,20,16,0.07)]'

export default function MyReferralScreen() {
  const { loading, referral, stage, redirected, careTeam, workup, booking } = usePatientReferral()

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <div className="h-40 animate-pulse rounded-2xl bg-line/50 motion-reduce:animate-none" />
      </div>
    )
  }

  if (!referral) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
        <h1 className="font-display text-lg font-semibold text-ink">No referral yet</h1>
        <p className="mt-2 text-[13px] text-muted">
          Once you’ve told us what’s going on, your referral will show up here.
        </p>
        <Link
          to="/patient/intake"
          className="mt-4 inline-block rounded-md bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#24489c]"
        >
          Start intake
        </Link>
      </div>
    )
  }

  const mine = patientItems(workup)
  const outstanding = outstandingPatientItems(workup)

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="font-display text-lg font-semibold text-ink">Your referral</h1>
      <p className="mt-1 text-[13px] text-muted">
        We’ll keep this up to date as things move — you don’t need to chase anyone.
      </p>

      {/* ── Status ─────────────────────────────────────────────────────── */}
      <div className={`${CARD} mt-5`}>
        {redirected ? (
          // A referral sent elsewhere is a redirect, not a rejection. No stepper.
          <>
            <p className="text-sm font-semibold text-ink">Sent to a different service</p>
            <p className="mt-1.5 text-[13px] text-muted">
              After reviewing what you shared, our team thought another service is a better fit for
              what’s going on. They’ll be in touch about where to go next — you don’t need to do
              anything right now.
            </p>
          </>
        ) : (
          <>
            <StatusStepper reviewerLabel={careTeam} current={stage} />
            <p className="mt-4 text-[13px] text-muted">
              {stage === 1 && 'A clinician is reviewing what you shared. This usually takes a day or two.'}
              {stage === 2 &&
                'Your referral has been confirmed. Next step is booking your visit and any tests.'}
              {stage === 3 &&
                booking &&
                `You're booked for ${formatDate(booking.at)} — ${booking.label}.`}
            </p>
          </>
        )}
      </div>

      {/* ── What the patient still needs to do ─────────────────────────── */}
      {!redirected && mine.length > 0 && (
        <div className={`${CARD} mt-4`}>
          <p className="text-sm font-semibold text-ink">
            {outstanding.length === 0 ? 'Everything’s done' : 'Before your visit'}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {outstanding.length === 0
              ? 'Nothing outstanding on your side — thank you.'
              : 'These are the things we need from you. Everything else is handled by the clinic.'}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {mine.map((item) => {
              const done = item.status === 'resulted' || item.status === 'reviewed'
              const days = daysUntil(item.dueBy)
              return (
                <li
                  key={item.name}
                  className="flex items-start gap-3 rounded-lg border border-line bg-bg px-3 py-2"
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-bold ${
                      done
                        ? 'border-success bg-success text-white'
                        : 'border-line bg-canvas text-muted'
                    }`}
                  >
                    {done ? '✓' : ''}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[13px] ${done ? 'text-muted line-through' : 'text-ink'}`}>
                      {item.name}
                    </span>
                    {!done && (
                      <span className="block text-[11px] text-muted">
                        {days <= 0
                          ? 'Due now'
                          : `Due by ${formatDate(item.dueBy)} · ${days} day${days === 1 ? '' : 's'}`}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ── Next action ────────────────────────────────────────────────── */}
      {!redirected && stage >= 2 && (
        <Link
          to="/patient/appointments"
          className="mt-4 inline-block rounded-md bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#24489c]"
        >
          {booking ? 'View or change your appointment' : 'Book your appointment'}
        </Link>
      )}

      <p className="mt-6 text-[11px] text-muted">
        Questions about any of this? Call the clinic — we’d rather you ask than wonder.
      </p>
    </div>
  )
}
