import { DEMO_NOW, formatDate } from '../lib/demoClock'

/**
 * ⚠️ INVENTED DATA. Every number in this file is made up.
 *
 * Clinic days, weekly slot counts, and next-available dates have no source —
 * not the tree, not the fixtures, not the database. They exist so the clinic
 * directory can show the SHAPE of a capacity column. Nothing clinical depends
 * on them, and no routing decision reads them.
 *
 * Values are derived from a hash of the specialist's name and pinned to
 * DEMO_NOW, so they are stable across reloads and identical for every viewer —
 * a directory whose numbers shuffle on refresh reads as broken.
 *
 * TODO(epic): real availability comes from Epic Cadence provider schedules,
 * joined with the specialists table (docs/tree-generator-technical-architecture.md
 * §2.1). When that lands, delete this file — do not "improve" it.
 */

export interface Capacity {
  clinicDays: string[]
  slotsPerWeek: number
  /** ISO date. */
  nextAvailable: string
  nextAvailableLabel: string
  acceptingNew: boolean
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/** Small deterministic string hash (FNV-1a, 32-bit). */
function hash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function capacityFor(name: string): Capacity {
  const h = hash(name)

  // 2–3 clinic days a week, always in weekday order.
  const dayCount = 2 + (h % 2)
  const offset = (h >> 3) % DAYS.length
  const clinicDays = DAYS.filter((_, i) => (i - offset + DAYS.length) % DAYS.length < dayCount)

  const slotsPerWeek = 8 + ((h >> 5) % 13) // 8–20
  const daysOut = 3 + ((h >> 9) % 26) // 3–28 days
  const next = new Date(DEMO_NOW)
  next.setDate(next.getDate() + daysOut)
  const nextAvailable = next.toISOString().slice(0, 10)

  return {
    clinicDays,
    slotsPerWeek,
    nextAvailable,
    nextAvailableLabel: formatDate(nextAvailable),
    // The long-wait end of the range reads as a closed book.
    acceptingNew: daysOut < 21,
  }
}
