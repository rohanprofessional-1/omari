import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate } from '../../dashboard/lib/demoClock'
import { book, bookTest, cancelBooking, cancelTest } from './appointmentStore'
import { humanWait, type PlanTest, type Slot } from './carePlan'
import { usePatientReferral } from './usePatientReferral'

/**
 * Appointments — the consultation, and every test that should happen before it.
 *
 * This screen exists because of one failure mode: a patient waits two months
 * for a nerve consultation, arrives, and is sent away to book an MRI that
 * takes another six weeks. The wait is not the problem — the wait is the
 * OPPORTUNITY, and it is only usable if the patient can see the tests and book
 * them the day the referral is approved.
 *
 * So the page is one vertical sequence in real time order: your consultation
 * at the top (the deadline everything else is measured against), then each
 * test, each with its own openings, each bookable independently. A test is
 * never blocked on another test.
 *
 * TODO(epic): openings are invented — see carePlan.ts. Real availability is
 * per-resource in Epic Cadence, and booking is an appointment write.
 *
 * Patient-facing: the same denylist as MyReferralScreen applies.
 */

const CARD = 'rounded-xl border border-line bg-canvas p-5 shadow-subtle'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="text-heading-sm text-ink">Appointments</h1>
      <p className="mt-1 text-[13px] text-muted">
        Your consultation, and the tests to get done before it.
      </p>
      {children}
    </div>
  )
}

/** A row of offered openings — the same control for a consult or a scan. */
function SlotList({ slots, onPick }: { slots: Slot[]; onPick: (slot: Slot) => void }) {
  if (slots.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-muted">
        Nothing bookable online right now — call the clinic and we’ll find you a time.
      </p>
    )
  }
  return (
    <ul className="mt-3 space-y-2">
      {slots.map((slot) => (
        <li key={slot.at}>
          <button
            onClick={() => onPick(slot)}
            className="flex w-full items-center gap-3 rounded-md border border-line bg-bg px-3 py-2.5 text-left transition-colors hover:border-accent-strong/50 hover:bg-sky"
          >
            <span className="text-[13px] font-medium text-ink">{formatDate(slot.at)}</span>
            <span className="text-[13px] text-muted">{slot.time}</span>
            <span className="ml-auto text-[12px] font-medium text-accent">Book</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** One test: what it is, where it stands, and how to get it booked. */
function TestCard({
  test,
  referralId,
  consultationAt,
}: {
  test: PlanTest
  referralId: string
  consultationAt: string | null
}) {
  const [picking, setPicking] = useState(false)

  const state = test.done ? 'done' : test.booking ? 'booked' : 'to-book'
  const dot =
    state === 'done' ? 'bg-success-light' : state === 'booked' ? 'bg-accent' : 'bg-line'

  return (
    <div className={CARD}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">{test.modality.kind}</p>
          <p className="mt-0.5 text-[12px] text-muted">{test.name}</p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
            state === 'done'
              ? 'bg-success-soft text-ink'
              : state === 'booked'
                ? 'bg-sky text-accent-strong'
                : 'bg-bg text-muted'
          }`}
        >
          {state === 'done' ? 'Result in' : state === 'booked' ? 'Booked' : 'To book'}
        </span>
      </div>

      {state === 'done' ? (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          This one is already back — {test.modality.kind.toLowerCase()} results are with{' '}
          your care team. Nothing for you to do.
        </p>
      ) : (
        <>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">{test.modality.blurb}</p>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
            <div className="flex gap-1.5">
              <dt className="text-muted">Where</dt>
              <dd className="font-medium text-ink">{test.modality.place}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">How long</dt>
              <dd className="font-medium text-ink">{test.modality.duration}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Needed by</dt>
              <dd className="font-medium text-ink">{formatDate(test.dueBy)}</dd>
            </div>
          </dl>

          {test.booking ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <p className="text-[13px] text-ink">
                <span className="font-semibold">{formatDate(test.booking.at)}</span> ·{' '}
                {test.booking.label}
              </p>
              <button
                onClick={() => cancelTest(referralId, test.name)}
                className="ml-auto rounded-md border border-line bg-canvas px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
              >
                Change time
              </button>
            </div>
          ) : picking ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-[13px] font-medium text-ink">
                Openings before your consultation
              </p>
              <SlotList
                slots={test.slots}
                onPick={(slot) => {
                  bookTest(referralId, test.name, { at: slot.at, label: slot.time })
                  setPicking(false)
                }}
              />
              <button
                onClick={() => setPicking(false)}
                className="mt-2 text-[12px] font-medium text-muted hover:text-ink"
              >
                Not now
              </button>
            </div>
          ) : (
            <div className="mt-4 border-t border-line pt-4">
              <button
                onClick={() => setPicking(true)}
                className="rounded-md bg-accent-strong px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#27508f]"
              >
                Find a time
              </button>
              <p className="mt-2 text-[11px] text-muted">
                {consultationAt
                  ? `Book it now — these fill up, and the result needs to be back before ${formatDate(consultationAt)}.`
                  : 'Book it now — these fill up.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function AppointmentsScreen() {
  const { loading, referral, redirected, careTeam, plan } = usePatientReferral()

  if (loading) {
    return (
      <Frame>
        <div className="mt-5 h-40 animate-pulse rounded-xl bg-line/50 motion-reduce:animate-none" />
      </Frame>
    )
  }

  // Nothing to book against.
  if (!referral || redirected) {
    return (
      <Frame>
        <div className={`${CARD} mt-5`}>
          <p className="text-[13px] leading-relaxed text-muted">
            {redirected
              ? 'Your referral was sent to a different service — they’ll be in touch about scheduling.'
              : 'Once you have a referral, you’ll be able to book here.'}
          </p>
        </div>
      </Frame>
    )
  }

  const id = referral.payload.referralId
  const { approved, consultation, offers, daysToConsultation, tests, doneCount, total } = plan

  // Approval is the gate. Before it there is no date and no test list — saying
  // so plainly beats an empty scheduler.
  if (!approved) {
    return (
      <Frame>
        <div className={`${CARD} mt-5`}>
          <p className="text-[15px] font-semibold text-ink">Nothing to book yet</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            {careTeam} is still reviewing your referral. The moment it’s approved we’ll text you to
            pick your consultation date, and the tests to get done beforehand will show up here.
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

  const bookable = tests.filter((t) => t.bookable)

  return (
    <Frame>
      {/* ── 1 · The consultation — the deadline everything else runs to ──── */}
      <div className={`${CARD} mt-5`}>
        <p className="text-caption uppercase text-muted">Your consultation</p>

        {consultation ? (
          <>
            <p className="mt-1 text-[19px] font-semibold text-ink">
              {formatDate(consultation.at)}
            </p>
            <p className="mt-0.5 text-[13px] text-muted">
              {consultation.label} with {careTeam} ·{' '}
              <span className="font-medium text-ink">{humanWait(daysToConsultation ?? 0)}</span>
            </p>
            <button
              onClick={() => cancelBooking(id)}
              className="mt-4 rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
            >
              Choose a different date
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-[15px] font-semibold text-ink">Pick your date</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              Your referral is approved, so these are the next openings with {careTeam}. Pick one
              and we’ll confirm by text. The wait is real — but it’s also when we get your tests
              done, so you arrive ready.
            </p>
            <SlotList
              slots={offers}
              onPick={(slot) => book(id, { at: slot.at, label: slot.time })}
            />
          </>
        )}
      </div>

      {/* ── 2 · The tests that go in front of it ─────────────────────────── */}
      {bookable.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-[15px] font-semibold text-ink">Before your consultation</h2>
            <p className="ml-auto text-[13px] tabular-nums text-muted">
              <span className="font-semibold text-ink">{doneCount}</span> of {total} done
            </p>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {consultation
              ? `You have ${humanWait(daysToConsultation ?? 0).replace(/^in /, '')} — enough time for all of these if you book them now.`
              : 'You can book these now, before your consultation date is even set.'}
          </p>

          <div className="mt-4 space-y-3">
            {bookable.map((test) => (
              <TestCard
                key={test.name}
                test={test}
                referralId={id}
                consultationAt={consultation?.at ?? null}
              />
            ))}
          </div>
        </>
      )}

      {/* ── 3 · Not appointments, just things to bring ───────────────────── */}
      {tests.some((t) => !t.bookable) && (
        <div className={`${CARD} mt-6`}>
          <p className="text-[15px] font-semibold text-ink">Bring to your visit</p>
          <ul className="mt-3 space-y-2">
            {tests
              .filter((t) => !t.bookable)
              .map((t) => (
                <li key={t.name} className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                  <span className="text-[13px] leading-relaxed text-ink">{t.name}</span>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted">
            Photos on your phone are fine — we just need to be able to read them.
          </p>
        </div>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-muted">
        Need a different day, or somewhere closer to home? Call the clinic and we’ll sort it out.
      </p>
    </Frame>
  )
}
