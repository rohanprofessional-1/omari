import { useSyncExternalStore } from 'react'

/**
 * Which slot the patient picked, per referral.
 *
 * Same module-singleton + useSyncExternalStore idiom as the dashboard review
 * store, including the cached-snapshot rule (a fresh object per call loops React).
 *
 * TODO(epic): booking is an Epic appointment write, not a localStorage key.
 * Real availability comes from Epic Cadence via the backend. The SHAPE here —
 * a chosen slot per referral, gated on outstanding patient workup — is the part
 * that survives the swap.
 */

const KEY = 'omari:patient:appointment:v1'

export interface Booking {
  /** ISO datetime of the chosen slot. */
  at: string
  /** What the visit is for, as shown to the patient. */
  label: string
}

export type Bookings = Record<string, Booking>

const canStore = typeof localStorage !== 'undefined'

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
  snapshot = { ...snapshot, [referralId]: booking }
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
