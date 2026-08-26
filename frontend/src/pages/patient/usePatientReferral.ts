import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/authStore'
import { useDashboardStore } from '../../dashboard/lib/reviewStore'
import { listForUser } from '../../dashboard/lib/scope'
import { buildWorkupEntries, type WorkupEntry } from '../../dashboard/lib/workupMerge'
import type { ReviewState, ReviewStatus, ReviewableReferral } from '../../dashboard/types'
import type { StatusStage } from '../../components/StatusStepper'
import { useBookings, useTestBookings, type Booking } from './appointmentStore'
import { buildCarePlan, type CarePlan } from './carePlan'
import { buildJourney, type JourneyEvent } from './journey'

/**
 * The signed-in patient's own referral, and where it has got to.
 *
 * Shared by the status and appointments screens so they can never disagree
 * about the stage. Scoped by MRN through the same seam the clinic screens use.
 *
 * NOTE: intake does not yet create a referral — nothing is POSTed when the
 * Runner conversation finishes, and there is no /referrals endpoint. The demo
 * patient is therefore bound by MRN to an existing fixture; see
 * src/auth/demoUsers.ts.
 */

export interface PatientReferral {
  loading: boolean
  referral: ReviewableReferral | null
  status: ReviewStatus
  review: ReviewState | null
  stage: StatusStage
  /** Redirected out of this clinic — never phrased to the patient as "rejected". */
  redirected: boolean
  /** Who has it, phrased for a patient ("Dr. Saltzman's team"). */
  careTeam: string
  /** Workup this patient is personally responsible for. */
  workup: WorkupEntry | null
  booking: Booking | null
  /** The whole shape of the wait: consultation, tests, and progress. */
  plan: CarePlan
  /** Everything that has happened and is still to come, in order. */
  journey: JourneyEvent[]
  infoRequestNote: string | null
}

/* `patientItems` / `outstandingPatientItems` used to live here, filtering the
   workup down to items whose `responsible` was 'patient'. They are gone: who
   the CLINIC books a test through says nothing about whether the patient has
   to attend it, and filtering on it hid the scans that are the whole reason
   the wait is useful. carePlan.ts decides schedulability from the kind of test
   instead. */

export function usePatientReferral(): PatientReferral {
  const { user } = useAuth()
  const { reviews, workupOverrides, audit } = useDashboardStore()
  const bookings = useBookings()
  const testBookings = useTestBookings()
  const [fetched, setFetched] = useState<ReviewableReferral[] | null>(null)

  useEffect(() => {
    let cancelled = false
    listForUser(user).then((rows) => {
      if (!cancelled) setFetched(rows)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  return useMemo(() => {
    const referral = fetched?.[0] ?? null
    const id = referral?.payload.referralId
    const status: ReviewStatus = (id && reviews[id]?.status) || 'pending'
    const booking = (id && bookings[id]) || null

    const entries = referral
      ? buildWorkupEntries([referral], reviews, workupOverrides)
      : null
    const workup =
      entries
        ? [...entries.atRisk, ...entries.onTrack, ...entries.complete][0] ?? null
        : null

    // Patient-facing stage. A referral sent elsewhere is NOT shown as a
    // rejection — it gets its own card, so it never reaches the stepper.
    const redirected = status === 'rejected'
    let stage: StatusStage = 1
    if (status === 'approved' || status === 'corrected') stage = 2
    if (booking) stage = 3

    const destination = workup?.destination ?? referral?.result.routedTo?.specialistName
    const careTeam = destination ? `${destination}’s team` : 'our clinical team'

    // Approval is the gate: it is what releases BOTH the consultation date and
    // the test list. Before it, there is nothing for the patient to schedule.
    const approved = status === 'approved' || status === 'corrected'
    const plan = buildCarePlan({
      referralId: id ?? '',
      approved,
      entry: workup,
      consultation: booking,
      testBookings: (id && testBookings[id]) || {},
    })

    const journey = referral ? buildJourney({ referral, audit, plan, careTeam }) : []

    const infoRequestNote = id
      ? [...audit].reverse().find((e) => e.referralId === id && e.action === 'info_requested')?.note || null
      : null

    return {
      loading: fetched === null,
      referral,
      status,
      review: id ? reviews[id] ?? null : null,
      stage,
      redirected,
      careTeam,
      workup,
      booking,
      plan,
      journey,
      infoRequestNote,
    }
  }, [fetched, reviews, workupOverrides, bookings, testBookings, audit])
}
