import type { WorkupStatus } from '../types'

/**
 * Dashboard — clock utilities.
 *
 * Previously pinned to DEMO_NOW for deterministic demo rendering. Now uses
 * the real wall clock so dates, waiting times, and at-risk indicators reflect
 * actual reality.
 *
 * All date computation in the dashboard flows through these utilities.
 */

/** The current time. Previously pinned to '2026-07-24T09:00:00' for demos. */
export const DEMO_NOW = new Date()

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Whole years between a date of birth and now. */
export function ageFromDob(dob: string): number {
  const birth = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age
}

/** Human waiting-time since receipt: '3d', '6h', '<1h'. */
export function waitingSince(receivedAt: string): string {
  const diff = Date.now() - new Date(receivedAt).getTime()
  if (diff < MS_PER_HOUR) return '<1h'
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)}h`
  return `${Math.floor(diff / MS_PER_DAY)}d`
}

/** Days from now until `iso` (negative when past). */
export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / MS_PER_DAY)
}

/** Month/day/year of an ISO date. Date-only strings ('2026-07-24') parse as UTC
 *  midnight and datetimes as local, so the field set has to follow the form. */
function dateParts(iso: string): { month: number; day: number; year: number } {
  const d = new Date(iso)
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  return {
    month: dateOnly ? d.getUTCMonth() : d.getMonth(),
    day: dateOnly ? d.getUTCDate() : d.getDate(),
    year: dateOnly ? d.getUTCFullYear() : d.getFullYear(),
  }
}

/** Short human date: 'Jul 24, 2026'. Uses UTC fields so ISO dates ('2026-07-24')
 *  render the same regardless of the host timezone. */
export function formatDate(iso: string): string {
  const { month, day, year } = dateParts(iso)
  return `${MONTHS[month]} ${day}, ${year}`
}

/**
 * Compact date, no year: 'Jul 24'. For dense rows where the relative distance
 * ('in 2d') is the point and the calendar date is only there to confirm it —
 * the full date always stays available in the cell's title.
 */
export function formatDateShort(iso: string): string {
  const { month, day } = dateParts(iso)
  return `${MONTHS[month]} ${day}`
}

/**
 * A workup item is at risk when it has not come back (not resulted/reviewed)
 * AND its due date is within 7 days of now or already past.
 */
export function isAtRisk(
  item: { status: WorkupStatus; dueBy: string },
  _visitDate?: string,
): boolean {
  if (item.status === 'resulted' || item.status === 'reviewed') return false
  return daysUntil(item.dueBy) <= 7
}
