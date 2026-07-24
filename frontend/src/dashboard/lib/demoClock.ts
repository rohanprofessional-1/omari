import type { WorkupStatus } from '../types'

/**
 * Dashboard — pinned demo clock.
 *
 * Every date computation in the dashboard flows through DEMO_NOW so fixtures,
 * derivations, and tests are deterministic regardless of when they run.
 */

export const DEMO_NOW = new Date('2026-07-24T09:00:00')

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Whole years between a date of birth and DEMO_NOW. */
export function ageFromDob(dob: string): number {
  const birth = new Date(dob)
  let age = DEMO_NOW.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    DEMO_NOW.getMonth() < birth.getMonth() ||
    (DEMO_NOW.getMonth() === birth.getMonth() && DEMO_NOW.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}

/** Human waiting-time since receipt: '3d', '6h', '<1h'. */
export function waitingSince(receivedAt: string): string {
  const diff = DEMO_NOW.getTime() - new Date(receivedAt).getTime()
  if (diff < MS_PER_HOUR) return '<1h'
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}h`
  return `${Math.floor(diff / MS_PER_DAY)}d`
}

/** Days from DEMO_NOW until `iso` (negative when past). */
export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - DEMO_NOW.getTime()) / MS_PER_DAY)
}

/** Short human date: 'Jul 24, 2026'. Uses UTC fields so ISO dates ('2026-07-24')
 *  render the same regardless of the host timezone. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  // Date-only ISO strings parse as UTC midnight; datetimes parse as local.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const month = dateOnly ? d.getUTCMonth() : d.getMonth()
  const day = dateOnly ? d.getUTCDate() : d.getDate()
  const year = dateOnly ? d.getUTCFullYear() : d.getFullYear()
  return `${MONTHS[month]} ${day}, ${year}`
}

/**
 * A workup item is at risk when it has not come back (not resulted/reviewed)
 * AND its due date is within 7 days of DEMO_NOW or already past.
 */
export function isAtRisk(
  item: { status: WorkupStatus; dueBy: string },
  _visitDate?: string,
): boolean {
  if (item.status === 'resulted' || item.status === 'reviewed') return false
  return daysUntil(item.dueBy) <= 7
}
