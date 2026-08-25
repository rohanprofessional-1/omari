import { useSyncExternalStore } from 'react'
import { localStorageWorks } from '../../lib/canStore'

/**
 * What the patient has booked: the consultation, and each test before it.
 *
 * Same module-singleton + useSyncExternalStore idiom as the dashboard review
 * store, including the cached-snapshot rule (a fresh object per call loops React).
 *
 * Two stores, because they are two different things. The CONSULTATION is one
 * appointment per referral, set once the clinic approves. The TESTS are many
 * appointments per referral, booked into the wait before it — that is the
 * whole point of the product, so they get first-class state rather than being
 * squeezed into the consultation's shape.
 *
 * TODO(epic): both are Epic appointment writes, not localStorage keys. Real
 * availability comes from Epic Cadence per resource (clinic room, scanner, EMG
 * lab). The SHAPE here — a chosen slot per referral, plus a chosen slot per
 * test — is the part that survives the swap.
 */

/** Use the real wall clock for booking timestamps. */
function stampedNow(): string {
  return new Date().toISOString()
}

const KEY = 'omari:patient:appointment:v1'
const TEST_KEY = 'omari:patient:testAppointments:v1'

export interface Booking {
  /** ISO datetime of the chosen slot. */
  at: string
  /** What the visit is for, as shown to the patient. */
  label: string
  /** When the patient picked it — the journey timeline dates the choice.
   *  Optional: bookings made before this field existed simply have no date. */
  bookedAt?: string
}

export type Bookings = Record<string, Booking>
/** referralId → test name → the slot the patient picked. */
export type TestBookings = Record<string, Record<string, Booking>>

const canStore = localStorageWorks()

function load(): Bookings {
  if (!canStore) return {}
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Bookings) : {}
  } catch {
    return {}
  }
}

let snapshot: Bookings = load()
const listeners = new Set<() => void>()

function notify(): void {
  if (canStore) {
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot))
    } catch {
      /* storage full / unavailable — keep the booking in memory */
    }
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Bookings {
  return snapshot
}

export function book(referralId: string, booking: Booking): void {
  snapshot = { ...snapshot, [referralId]: { bookedAt: stampedNow(), ...booking } }
  notify()
}

export function cancelBooking(referralId: string): void {
  const next = { ...snapshot }
  delete next[referralId]
  snapshot = next
  notify()
}

export function useBookings(): Bookings {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/* ── Test appointments — the ones booked into the wait ────────────────────── */

function loadTests(): TestBookings {
  if (!canStore) return {}
  try {
    const raw = localStorage.getItem(TEST_KEY)
    return raw ? (JSON.parse(raw) as TestBookings) : {}
  } catch {
    return {}
  }
}

let testSnapshot: TestBookings = loadTests()
const testListeners = new Set<() => void>()

function notifyTests(): void {
  if (canStore) {
    try {
      localStorage.setItem(TEST_KEY, JSON.stringify(testSnapshot))
    } catch {
      /* storage full / unavailable — keep the bookings in memory */
    }
  }
  for (const l of testListeners) l()
}

function subscribeTests(listener: () => void): () => void {
  testListeners.add(listener)
  return () => testListeners.delete(listener)
}

function getTestSnapshot(): TestBookings {
  return testSnapshot
}

export function bookTest(referralId: string, testName: string, booking: Booking): void {
  testSnapshot = {
    ...testSnapshot,
    [referralId]: {
      ...(testSnapshot[referralId] ?? {}),
      [testName]: { bookedAt: stampedNow(), ...booking },
    },
  }
  notifyTests()
}

export function cancelTest(referralId: string, testName: string): void {
  const forReferral = { ...(testSnapshot[referralId] ?? {}) }
  delete forReferral[testName]
  testSnapshot = { ...testSnapshot, [referralId]: forReferral }
  notifyTests()
}

export function useTestBookings(): TestBookings {
  return useSyncExternalStore(subscribeTests, getTestSnapshot)
}
