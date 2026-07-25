import { DEMO_NOW, isAtRisk } from './demoClock'
import type {
  DashboardWorkupItem,
  ReviewState,
  ReviewableReferral,
  WorkupStatus,
} from '../types'

/**
 * Dashboard — shared workup merge + stratification logic.
 *
 * One source of truth for "what is the live state of this referral's workup":
 * the detail screen's WorkupList and the Workup tracking screen both merge
 * store overrides through `mergeWorkupItems`, so a status advanced on either
 * screen recomputes at-risk identically everywhere.
 *
 * DEMO BEHAVIOR — synthetic visit dates: fixtures only pin `visitDate` on some
 * referrals. A referral approved live in the demo without one gets a
 * deterministic projected visit date so it still participates in risk
 * tracking: DEMO_NOW + 10d (routine), + 5d (expedited), + 2d (urgent). Item
 * due dates are clamped to the projected visit (a test can't be due after the
 * visit it's for), and at-risk is recomputed from the clamped date.
 */

const MS_PER_DAY = 86_400_000

/** Demo policy: days from DEMO_NOW to the projected visit, by routing urgency. */
export const SYNTHETIC_VISIT_DAYS: Record<'routine' | 'expedited' | 'urgent', number> = {
  routine: 10,
  expedited: 5,
  urgent: 2,
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Projected visit date for a referral approved without a scheduled visit. */
export function syntheticVisitDate(urgency: 'routine' | 'expedited' | 'urgent' | null): string {
  const days = SYNTHETIC_VISIT_DAYS[urgency ?? 'routine']
  return isoDay(new Date(DEMO_NOW.getTime() + days * MS_PER_DAY))
}

/** A workup item that has come back and needs no further chasing. */
export function isWorkupDone(status: WorkupStatus): boolean {
  return status === 'resulted' || status === 'reviewed'
}

/**
 * Live status overrides (from review actions) win over the fixture state;
 * at-risk is recomputed so a resulted item stops shouting. Items without an
 * override keep their original object identity.
 */
export function mergeWorkupItems(
  items: DashboardWorkupItem[],
  overrides: Record<string, WorkupStatus>,
  visitDate?: string,
): DashboardWorkupItem[] {
  return items.map((item) => {
    const status = overrides[item.name] ?? item.status
    return status === item.status
      ? item
      : { ...item, status, atRisk: isAtRisk({ status, dueBy: item.dueBy }, visitDate) }
  })
}

export interface WorkupEntry {
  referral: ReviewableReferral
  /** Where the patient is actually going (correction-aware). */
  destination: string
  urgency: 'routine' | 'expedited' | 'urgent'
  visitDate: string
  /** True when the visit date is the demo's projected one, not a fixture date. */
  syntheticVisit: boolean
  /** Merged items: store overrides applied, due dates clamped, at-risk live. */
  items: DashboardWorkupItem[]
  /** Items not yet resulted/reviewed. */
  outstanding: number
  atRisk: boolean
  complete: boolean
}

export interface WorkupStrata {
  atRisk: WorkupEntry[]
  onTrack: WorkupEntry[]
  complete: WorkupEntry[]
}

const URGENCIES = new Set(['routine', 'expedited', 'urgent'])

function byVisitThenId(a: WorkupEntry, b: WorkupEntry): number {
  return (
    a.visitDate.localeCompare(b.visitDate) ||
    a.referral.payload.referralId.localeCompare(b.referral.payload.referralId)
  )
}

/**
 * The Workup screen's population and stratification, in one deterministic
 * pass. Population: referrals that are going to be seen (review status
 * 'approved' or 'corrected') with a non-empty required workup. Strata:
 *  - complete: every item resulted/reviewed → collapsed strip
 *  - atRisk:   any merged item at risk      → shouts, top of screen
 *  - onTrack:  the calm remainder
 * Each stratum is sorted soonest visit first (referralId tie-break).
 */
export function buildWorkupEntries(
  referrals: ReviewableReferral[],
  reviews: Record<string, ReviewState>,
  workupOverrides: Record<string, Record<string, WorkupStatus>>,
): WorkupStrata {
  const strata: WorkupStrata = { atRisk: [], onTrack: [], complete: [] }

  for (const referral of referrals) {
    const id = referral.payload.referralId
    const review = reviews[id]
    if (!review || (review.status !== 'approved' && review.status !== 'corrected')) continue
    const { result } = referral
    if (result.requiredWorkup.length === 0) continue

    const correction = review.correction
    const urgency =
      correction?.field === 'urgency' && URGENCIES.has(correction.to)
        ? (correction.to as 'routine' | 'expedited' | 'urgent')
        : result.urgency ?? 'routine'
    const destination =
      correction?.field === 'destination'
        ? correction.to
        : result.routedTo?.specialistName ?? 'Unassigned'

    const syntheticVisit = !result.visitDate
    const visitDate = result.visitDate ?? syntheticVisitDate(urgency)
    const overrides = workupOverrides[id] ?? {}

    const items = result.requiredWorkup.map((item) => {
      const status = overrides[item.name] ?? item.status
      // ISO dates compare lexicographically — clamp dueBy to the projected visit.
      const dueBy = syntheticVisit && item.dueBy > visitDate ? visitDate : item.dueBy
      if (status === item.status && dueBy === item.dueBy) return item
      return { ...item, status, dueBy, atRisk: isAtRisk({ status, dueBy }, visitDate) }
    })

    const outstanding = items.filter((item) => !isWorkupDone(item.status)).length
    const entry: WorkupEntry = {
      referral,
      destination,
      urgency,
      visitDate,
      syntheticVisit,
      items,
      outstanding,
      atRisk: items.some((item) => item.atRisk),
      complete: outstanding === 0,
    }

    if (entry.complete) strata.complete.push(entry)
    else if (entry.atRisk) strata.atRisk.push(entry)
    else strata.onTrack.push(entry)
  }

  strata.atRisk.sort(byVisitThenId)
  strata.onTrack.sort(byVisitThenId)
  strata.complete.sort(byVisitThenId)
  return strata
}
