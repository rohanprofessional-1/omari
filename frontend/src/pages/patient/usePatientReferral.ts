import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/authStore'
import { useDashboardStore } from '../../dashboard/lib/reviewStore'
import { listForUser } from '../../dashboard/lib/scope'
import { buildWorkupEntries, type WorkupEntry } from '../../dashboard/lib/workupMerge'
import type { ReviewStatus, ReviewableReferral } from '../../dashboard/types'
import type { StatusStage } from '../../components/StatusStepper'
import { useBookings, type Booking } from './appointmentStore'

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
  stage: StatusStage
  /** Redirected out of this clinic — never phrased to the patient as "rejected". */
  redirected: boolean
  /** Who has it, phrased for a patient ("Dr. Saltzman's team"). */
  careTeam: string
  /** Workup this patient is personally responsible for. */
  workup: WorkupEntry | null
  booking: Booking | null
}

/** Only tasks the PATIENT owns; clinic and referring-office items aren't theirs. */
export function patientItems(entry: WorkupEntry | null) {
  return entry ? entry.items.filter((i) => i.responsible === 'patient') : []
}

/** Patient-owned items still outstanding — the gate on booking a visit. */
export function outstandingPatientItems(entry: WorkupEntry | null) {
  return patientItems(entry).filter((i) => i.status !== 'resulted' && i.status !== 'reviewed')
}

export function usePatientReferral(): PatientReferral {
  const { user } = useAuth()
  const { reviews, workupOverrides } = useDashboardStore()
  const bookings = useBookings()
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

    return {
      loading: fetched === null,
      referral,
      status,
      stage,
      redirected,
      careTeam,
      workup,
      booking,
    }
  }, [fetched, reviews, workupOverrides, bookings])
}
