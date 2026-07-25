import { DEMO_NOW } from '../../dashboard/lib/demoClock'
import type { AuditEvent, ReviewableReferral } from '../../dashboard/types'
import type { CarePlan } from './carePlan'

/**
 * The whole referral as one chronology — what has happened, and what is
 * coming.
 *
 * A patient waiting two months has no way to tell a slow process from a
 * stalled one. A dated record answers that without anyone having to phone the
 * clinic: every step that has happened carries the day it happened, and every
 * step still ahead carries the day it will.
 *
 * ⚠️ The audit trail is a CLINICIAN artefact. Only the event TYPE and its
 * timestamp cross over — never `actor`, never `note`, never the reason. The one
 * exception is a workup status change, whose note is the test name the patient
 * already sees on their own checklist. Escalations, comments and views are
 * dropped entirely: "a human was pulled in because…" is not the patient's
 * business, and a redirect is handled by its own screen, not this timeline.
 */

export interface JourneyEvent {
  /** ISO date/datetime this happened or will happen. */
  at: string
  title: string
  detail?: string
  /** Behind us, or still ahead. Drives the dot, not the sort. */
  state: 'past' | 'future'
  /**
   * Narrative rank, and the reason this list is not simply sorted by date.
   * Three different clocks feed it: fixture dates (pinned demo clock), live
   * review actions (wall clock), and the patient's own bookings. Sorting a
   * mixed set by timestamp puts "you chose your date" before "approved" — a
   * story that cannot have happened. Rank first, timestamp only within a rank.
   */
  rank: number
}

const RANK = {
  submitted: 0,
  arrivedWithReferral: 1,
  clinicAction: 2,
  patientChoice: 3,
} as const

/** Parse `"<item> → <status>"` back into its two halves. */
function parseWorkupNote(note: string | undefined): { item: string; status: string } | null {
  if (!note) return null
  const [item, status] = note.split('→').map((s) => s.trim())
  return item && status ? { item, status } : null
}

export function buildJourney({
  referral,
  audit,
  plan,
  careTeam,
}: {
  referral: ReviewableReferral
  audit: AuditEvent[]
  plan: CarePlan
  careTeam: string
}): JourneyEvent[] {
  const id = referral.payload.referralId
  const past: JourneyEvent[] = [
    {
      at: referral.payload.receivedAt,
      title: 'Referral submitted',
      detail: 'You told us what was going on.',
      state: 'past',
      rank: RANK.submitted,
    },
  ]

  // Anything already in the audit trail has, by definition, happened — the
  // demo clock and live review actions run on different clocks, so classifying
  // by date here would file a just-now approval under "coming up".
  for (const event of audit) {
    if (event.referralId !== id) continue
    if (event.action === 'approved' || event.action === 'corrected') {
      past.push({
        at: event.at,
        title: `Approved by ${careTeam}`,
        detail: 'Your consultation dates and test list were released.',
        state: 'past',
        rank: RANK.clinicAction,
      })
    } else if (event.action === 'info_requested') {
      past.push({
        at: event.at,
        title: 'The clinic asked for more detail',
        detail: 'Someone will have been in touch to fill a gap.',
        state: 'past',
        rank: RANK.clinicAction,
      })
    } else if (event.action === 'workup_status_changed') {
      const parsed = parseWorkupNote(event.note)
      if (!parsed) continue
      if (parsed.status === 'resulted' || parsed.status === 'reviewed') {
        past.push({
          at: event.at,
          title: `${parsed.item} — result in`,
          state: 'past',
          rank: RANK.clinicAction,
        })
      } else if (parsed.status === 'scheduled' || parsed.status === 'ordered') {
        past.push({
          at: event.at,
          title: `${parsed.item} — ${parsed.status}`,
          state: 'past',
          rank: RANK.clinicAction,
        })
      }
    }
  }

  // Results that arrived before the demo began have no audit event to date
  // them, so they are recorded without pretending to know when.
  for (const test of plan.tests) {
    if (!test.done) continue
    const alreadyLogged = past.some((e) => e.title.startsWith(test.name))
    if (!alreadyLogged) {
      // No audit event to date it, and `dueBy` is a DEADLINE, not a result date
      // — dating it that way filed finished tests in the future. A result that
      // predates the demo came in with the referral, so say exactly that.
      past.push({
        at: referral.payload.receivedAt,
        title: `${test.name} — result in`,
        detail: 'Came in with your referral.',
        state: 'past',
        rank: RANK.arrivedWithReferral,
      })
    }
  }

  if (plan.consultation?.bookedAt) {
    past.push({
      at: plan.consultation.bookedAt,
      title: 'You chose your consultation date',
      state: 'past',
      rank: RANK.patientChoice,
    })
  }

  const ahead: JourneyEvent[] = []
  for (const test of plan.tests) {
    if (!test.booking || test.done) continue
    ahead.push({
      at: test.booking.at,
      title: test.modality.kind,
      detail: `${test.booking.label} · ${test.modality.place}`,
      state: 'future',
      rank: RANK.patientChoice,
    })
  }
  if (plan.consultation) {
    ahead.push({
      at: plan.consultation.at,
      title: 'Your consultation',
      detail: `${plan.consultation.label} with ${careTeam}`,
      state: 'future',
      rank: RANK.patientChoice,
    })
  }

  const byRankThenTime = (a: JourneyEvent, b: JourneyEvent) =>
    a.rank - b.rank || a.at.localeCompare(b.at)
  // What is ahead is genuinely in one clock (appointment dates), so it sorts by
  // time alone. What is behind spans three, so it sorts by narrative rank.
  return [...past.sort(byRankThenTime), ...ahead.sort((a, b) => a.at.localeCompare(b.at))]
}

/** Whether a scheduled thing has already come and gone, per the demo clock. */
export function isBehindUs(at: string): boolean {
  return new Date(at).getTime() < DEMO_NOW.getTime()
}
