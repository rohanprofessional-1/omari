import { Link } from 'react-router-dom'
import { DEMO_NOW, formatDate } from '../../dashboard/lib/demoClock'
import { book, cancelBooking } from './appointmentStore'
import { outstandingPatientItems, usePatientReferral } from './usePatientReferral'

/**
 * Appointments — book the visit and any scans or labs that go with it.
 *
 * TODO(epic): the slots below are invented. Real availability comes from Epic
 * Cadence through the backend, and booking is an Epic appointment write rather
 * than a localStorage key. The SHAPE is the part that survives the swap: a
 * small set of offered slots, gated on the patient's outstanding workup.
 *
 * Slots are derived from the same visit date the clinic's workup screen uses,
 * so the two views can never disagree about when this person is coming in.
 *
 * Patient-facing: main design tokens, and the same denylist as MyReferralScreen
 * applies — no confidence, no decision path, no specialty jargon.
 */

const CARD = 'rounded-2xl border border-line bg-canvas p-5 shadow-[0_1px_3px_rgba(24,20,16,0.07)]'

/** Three offered times around the projected visit date. Deterministic. */
function slotsFor(visitDate: string): { at: string; label: string }[] {
  const base = new Date(visitDate)
  // Never offer a slot in the past relative to the pinned demo clock.
  if (base.getTime() < DEMO_NOW.getTime()) base.setTime(DEMO_NOW.getTime())
  const offsets = [
    { days: 0, hour: 9, label: 'Morning' },
    { days: 0, hour: 14, label: 'Afternoon' },
    { days: 2, hour: 10, label: 'Morning' },
  ]
  return offsets.map(({ days, hour, label }) => {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return { at: d.toISOString(), label: `${label} · ${hour > 12 ? hour - 12 : hour}:00` }
  })
}

export default function AppointmentsScreen() {
  const { loading, referral, stage, redirected, careTeam, workup, booking } = usePatientReferral()

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <div className="h-40 animate-pulse rounded-2xl bg-line/50 motion-reduce:animate-none" />
      </div>
    )
  }

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="font-display text-lg font-semibold text-ink">Appointments</h1>
      <p className="mt-1 text-[13px] text-muted">
        Your visit, and any scans or labs that need to happen first.
      </p>
      {children}
    </div>
  )

  // Nothing to book against.
  if (!referral || redirected) {
    return (
      <Frame>
        <div className={`${CARD} mt-5`}>
          <p className="text-[13px] text-muted">
            {redirected
              ? 'Your referral was sent to a different service — they’ll be in touch about scheduling.'
              : 'Once you have a referral, you’ll be able to book here.'}
          </p>
        </div>
      </Frame>
    )
  }

  // Not confirmed yet — booking would be premature.
  if (stage < 2) {
    return (
      <Frame>
        <div className={`${CARD} mt-5`}>
          <p className="text-sm font-semibold text-ink">Not quite yet</p>
          <p className="mt-1.5 text-[13px] text-muted">
            {careTeam} is still reviewing your referral. As soon as it’s confirmed, you’ll be able
            to pick a time here.
          </p>
          <Link
            to="/patient/status"
            className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline"
          >
            Check your referral status
          </Link>
        </div>
      </Frame>
    )
  }

  const outstanding = outstandingPatientItems(workup)

  // The gate — and the whole point of the product. Booking a visit before the
  // tests are back is how people end up making the trip twice.
  if (outstanding.length > 0) {
    return (
      <Frame>
        <div className={`${CARD} mt-5`}>
          <p className="text-sm font-semibold text-ink">A couple of things first</p>
          <p className="mt-1.5 text-[13px] text-muted">
            So your visit is actually useful, {careTeam} needs these back before you come in:
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {outstanding.map((item) => (
              <li
                key={item.name}
                className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] text-ink"
              >
                {item.name}
                <span className="block text-[11px] text-muted">
                  Due by {formatDate(item.dueBy)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted">
            We’ll open booking as soon as these are done. The clinic can help arrange them — call if
            you’re not sure where to go.
          </p>
        </div>
      </Frame>
    )
  }

  const id = referral.payload.referralId
  const slots = workup ? slotsFor(workup.visitDate) : []

  return (
    <Frame>
      {booking ? (
        <div className={`${CARD} mt-5`}>
          <p className="text-sm font-semibold text-ink">You’re booked</p>
          <p className="mt-1.5 text-[13px] text-ink">
            {formatDate(booking.at)} · {booking.label}
          </p>
          <p className="mt-1 text-[13px] text-muted">with {careTeam}</p>
          <button
            onClick={() => cancelBooking(id)}
            className="mt-4 rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
          >
            Choose a different time
          </button>
        </div>
      ) : (
        <div className={`${CARD} mt-5`}>
          <p className="text-sm font-semibold text-ink">Pick a time</p>
          <p className="mt-1.5 text-[13px] text-muted">
            These are the next openings with {careTeam}.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {slots.map((slot) => (
              <li key={slot.at}>
                <button
                  onClick={() => book(id, slot)}
                  className="flex w-full items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2.5 text-left transition-colors hover:border-accent-strong/50 hover:bg-sky"
                >
                  <span className="text-[13px] font-medium text-ink">{formatDate(slot.at)}</span>
                  <span className="text-[13px] text-muted">{slot.label}</span>
                  <span className="ml-auto text-[12px] font-medium text-accent">Book</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-6 text-[11px] text-muted">
        Need a different day than these? Call the clinic and we’ll find one.
      </p>
    </Frame>
  )
}
