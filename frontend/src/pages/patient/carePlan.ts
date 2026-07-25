import { DEMO_NOW } from '../../dashboard/lib/demoClock'
import { isWorkupDone, type WorkupEntry } from '../../dashboard/lib/workupMerge'
import type { DashboardWorkupItem, WorkupStatus } from '../../dashboard/types'
import type { Booking } from './appointmentStore'

/**
 * The patient's care plan — the shape of the wait.
 *
 * The product claim lives in this file. A first consultation with a nerve
 * surgeon is months out; the tests that make that consultation useful (nerve
 * studies, an MRI, an ultrasound) each have their own queue. Left alone,
 * people wait two months, arrive, and are sent away to book an MRI they could
 * have had in week three. So: the moment the referral is APPROVED, the clinic
 * sets the consultation AND releases the test list, and the patient spends the
 * wait working through the list instead of waiting through it.
 *
 * Everything here is patient-facing. The clinician denylist applies — no
 * confidence, no decision path, no escalation reasons, no specialty jargon.
 * Test names come from the tree, but every explanation is written for the
 * person having the test, not the person reading the result.
 *
 * TODO(epic): slot availability is invented. Real openings come from Epic
 * Cadence per resource (scanner, EMG lab, clinic room). The SHAPE that
 * survives the swap: a per-test lead time, a set of offered slots inside the
 * window before the consultation, and a booking per test.
 */

const MS_PER_DAY = 86_400_000

/* ── What kind of thing is this, and what should a patient expect? ───────── */

export type TestKind =
  | 'nerve-study'
  | 'mri'
  | 'ct'
  | 'ultrasound'
  | 'xray'
  | 'labs'
  | 'records'
  | 'other'

interface Modality {
  /** Plain-language name for the kind of visit. */
  kind: string
  /** Where it happens. */
  place: string
  /** How long to set aside. */
  duration: string
  /** What actually happens, in the patient's words. */
  blurb: string
  /** Earliest this can usually be booked — the reason to start now. */
  leadDays: number
  /** Days between offered openings. */
  spacing: number
  /** Something you attend, as opposed to something you bring. */
  bookable: boolean
}

const MODALITIES: Record<TestKind, Modality> = {
  'nerve-study': {
    kind: 'Nerve study (EMG/NCS)',
    place: 'Neurophysiology lab',
    duration: 'About an hour',
    blurb:
      'Small pulses and a fine needle measure how well the nerve is carrying signals. Uncomfortable in places, but quick, and it is the test that shows where the problem actually is.',
    leadDays: 10,
    spacing: 4,
    bookable: true,
  },
  mri: {
    kind: 'MRI scan',
    place: 'Imaging centre',
    duration: '45–60 minutes',
    blurb:
      'You lie still inside a scanner while it takes detailed pictures. It is loud — you get earplugs. No needles unless contrast is needed.',
    leadDays: 14,
    spacing: 5,
    bookable: true,
  },
  ct: {
    kind: 'CT scan',
    place: 'Imaging centre',
    duration: 'About 20 minutes',
    blurb: 'A fast, detailed X-ray scan. You lie on a table that moves through a ring. Quick and painless.',
    leadDays: 10,
    spacing: 4,
    bookable: true,
  },
  ultrasound: {
    kind: 'Ultrasound',
    place: 'Imaging centre',
    duration: 'About 30 minutes',
    blurb:
      'Gel on the skin and a handheld probe — the same kind of scan used in pregnancy. Painless, no radiation, and often bookable sooner than an MRI.',
    leadDays: 5,
    spacing: 3,
    bookable: true,
  },
  xray: {
    kind: 'X-ray',
    place: 'Radiology — walk-in',
    duration: 'About 15 minutes',
    blurb: 'A few quick pictures, standing or lying down. Usually the fastest one on your list to get done.',
    leadDays: 2,
    spacing: 2,
    bookable: true,
  },
  labs: {
    kind: 'Blood test',
    place: 'Any lab draw station',
    duration: 'About 10 minutes',
    blurb: 'A standard blood draw. No appointment needed at most draw stations.',
    leadDays: 1,
    spacing: 2,
    bookable: true,
  },
  records: {
    kind: 'Bring with you',
    place: 'Nothing to book',
    duration: '—',
    blurb:
      'Not an appointment — just something to gather and bring to your visit. Photos of paperwork are fine.',
    leadDays: 0,
    spacing: 0,
    bookable: false,
  },
  other: {
    kind: 'Appointment',
    place: 'The clinic',
    duration: 'About 30 minutes',
    blurb: 'The clinic will explain what to expect when you book.',
    leadDays: 7,
    spacing: 4,
    bookable: true,
  },
}

/** Classify by test name. Order matters — 'needle EMG' must not match 'nerve'. */
export function classifyTest(name: string): TestKind {
  const n = name.toLowerCase()
  if (/\b(bring|records|reports|prior imaging|operative note)/.test(n)) return 'records'
  if (/(emg|ncs|nerve conduction|electromyograph)/.test(n)) return 'nerve-study'
  if (/ultrasound/.test(n)) return 'ultrasound'
  if (/\bmri\b/.test(n)) return 'mri'
  if (/\bct\b/.test(n)) return 'ct'
  if (/(radiograph|x-ray|xray)/.test(n)) return 'xray'
  if (/(labs|bloods|blood test|serology|glucose|a1c)/.test(n)) return 'labs'
  return 'other'
}

/* ── Deterministic pseudo-variety (no Math.random — the demo must be stable) ─ */

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * Parse a date the way the rest of the app displays it. `'2026-09-22'` parses
 * as UTC midnight, which is the previous EVENING in any western timezone — so
 * offering slots "around" it silently produced a date a day early. Date-only
 * strings are therefore built as LOCAL midnight; datetimes are already local.
 */
function parseDay(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
}

function isoAt(day: Date, hour: number): string {
  const d = new Date(day)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

/** Skip weekends — nobody is booking an EMG on a Sunday. */
function nextWeekday(d: Date): Date {
  const out = new Date(d)
  while (out.getDay() === 0 || out.getDay() === 6) out.setDate(out.getDate() + 1)
  return out
}

export interface Slot {
  /** ISO datetime. */
  at: string
  /** '9:00 AM' — already formatted, because a slot is a thing you read. */
  time: string
}

const CLINIC_HOURS = [8, 9, 10, 11, 13, 14, 15, 16]

function formatTime(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`
}

/**
 * Offered openings for one test: `count` weekday slots starting after the
 * modality's lead time, stopping short of the consultation so results are back
 * in time. Stable for a given (seed, test).
 */
export function slotsForTest(seed: string, kind: TestKind, before: string | null, count = 4): Slot[] {
  const { leadDays, spacing } = MODALITIES[kind]
  const cutoff = before ? parseDay(before).getTime() - 3 * MS_PER_DAY : Infinity
  const slots: Slot[] = []
  const cursor = new Date(DEMO_NOW.getTime() + leadDays * MS_PER_DAY)

  for (let i = 0; slots.length < count && i < count * 3; i++) {
    const day = nextWeekday(cursor)
    if (day.getTime() > cutoff) break
    const hour = CLINIC_HOURS[hash(`${seed}|${kind}|${i}`) % CLINIC_HOURS.length]
    slots.push({ at: isoAt(day, hour), time: formatTime(hour) })
    cursor.setTime(day.getTime() + Math.max(spacing, 1) * MS_PER_DAY)
  }
  return slots
}

/**
 * Dates offered for the first consultation, once the referral is approved.
 * Clustered around the clinic's planned visit date — these are the dates the
 * text message asks the patient to choose between.
 */
export function consultationOffers(seed: string, targetDate: string, count = 4): Slot[] {
  const offers: Slot[] = []
  const cursor = parseDay(targetDate)
  for (let i = 0; offers.length < count && i < count * 3; i++) {
    const day = nextWeekday(cursor)
    const hour = CLINIC_HOURS[hash(`${seed}|consult|${i}`) % CLINIC_HOURS.length]
    offers.push({ at: isoAt(day, hour), time: formatTime(hour) })
    cursor.setTime(day.getTime() + 3 * MS_PER_DAY)
  }
  return offers
}

/* ── The plan ────────────────────────────────────────────────────────────── */

export interface PlanTest {
  /** The clinical name, as the clinic knows it. */
  name: string
  kind: TestKind
  modality: Modality
  status: WorkupStatus
  done: boolean
  /** Something you attend, versus something you bring. */
  bookable: boolean
  /** The clinic is arranging this one — nothing for the patient to book. */
  arrangedByClinic: boolean
  /** When the result needs to be back. */
  dueBy: string
  /** The slot this patient chose, if any. */
  booking: Booking | null
  /** Openings we can offer, once they are needed. */
  slots: Slot[]
}

export interface CarePlan {
  /** Approved by the clinic — the gate on everything below. */
  approved: boolean
  /** The chosen consultation, or null while the patient still has to pick. */
  consultation: Booking | null
  /** Dates offered for the consultation (empty until approved). */
  offers: Slot[]
  /** Whole days from today to the consultation, once one is set. */
  daysToConsultation: number | null
  tests: PlanTest[]
  /** Tests that are appointments the patient still has to book. */
  toBook: PlanTest[]
  doneCount: number
  bookedCount: number
  /** Tests, excluding bring-with-you items — the "how prepared am I" figure. */
  total: number
}

export function buildCarePlan({
  referralId,
  approved,
  entry,
  consultation,
  testBookings,
}: {
  referralId: string
  approved: boolean
  entry: WorkupEntry | null
  consultation: Booking | null
  testBookings: Record<string, Booking>
}): CarePlan {
  // The consultation the patient actually holds beats the clinic's projection.
  const targetDate = consultation?.at ?? entry?.visitDate ?? null

  const tests: PlanTest[] = (entry?.items ?? []).map((item: DashboardWorkupItem) => {
    const kind = classifyTest(item.name)
    const modality = MODALITIES[kind]
    const done = isWorkupDone(item.status)
    const booking = testBookings[item.name] ?? null
    return {
      name: item.name,
      kind,
      modality,
      status: item.status,
      done,
      bookable: modality.bookable,
      // 'clinic' and 'referring office' items are chased by staff, not the
      // patient — but the patient still needs to know they exist.
      arrangedByClinic: item.responsible !== 'patient' && !modality.bookable,
      dueBy: item.dueBy,
      booking,
      slots: done || !modality.bookable ? [] : slotsForTest(referralId + item.name, kind, targetDate),
    }
  })

  const countable = tests.filter((t) => t.bookable)
  const daysToConsultation = consultation
    ? Math.max(0, Math.ceil((new Date(consultation.at).getTime() - DEMO_NOW.getTime()) / MS_PER_DAY))
    : null

  return {
    approved,
    consultation,
    offers: approved && entry?.visitDate ? consultationOffers(referralId, entry.visitDate) : [],
    daysToConsultation,
    tests,
    toBook: countable.filter((t) => !t.done && !t.booking),
    doneCount: countable.filter((t) => t.done).length,
    bookedCount: countable.filter((t) => !t.done && t.booking).length,
    total: countable.length,
  }
}

/** 'in 8 weeks' / 'in 12 days' / 'tomorrow' — the shape of the wait. */
export function humanWait(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 14) return `in ${days} days`
  const weeks = Math.round(days / 7)
  if (weeks < 9) return `in ${weeks} weeks`
  return `in about ${Math.round(days / 30)} months`
}
