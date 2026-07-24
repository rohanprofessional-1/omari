import { useSyncExternalStore } from 'react'
import type { AuditEvent, Correction, ReviewState, ReviewStatus, Role, WorkupStatus } from '../types'

/**
 * Dashboard — review store. localStorage-backed, module-level state with a
 * `useSyncExternalStore` React binding.
 *
 * Referral DATA is pinned to the demo clock; review ACTIONS are live — audit
 * timestamps use the real wall clock so the trail reads honestly in a demo.
 *
 * `getSnapshot` must return a CACHED object reference, replaced immutably on
 * every mutation — returning a fresh object each call would loop React.
 */

const REVIEWS_KEY = 'omari:dashboard:reviews:v1'
const AUDIT_KEY = 'omari:dashboard:audit:v1'
const WORKUP_KEY = 'omari:dashboard:workup:v1'
const ROLE_KEY = 'omari:dashboard:role'
const SURGEON_VISIT_KEY = 'omari:dashboard:surgeonLastVisit'

const ALL_KEYS = [REVIEWS_KEY, AUDIT_KEY, WORKUP_KEY, ROLE_KEY, SURGEON_VISIT_KEY]

export interface DashboardSnapshot {
  reviews: Record<string, ReviewState>
  audit: AuditEvent[]
  workupOverrides: Record<string, Record<string, WorkupStatus>>
  role: Role
}

const REVIEWER_NAMES: Record<Role, string> = {
  coordinator: 'M. Okafor (coordinator)',
  surgeon: 'Dr. N. Li',
  admin: 'Admin',
}

/** Display name a role signs reviews with. */
export function reviewerNameFor(role: Role): string {
  return REVIEWER_NAMES[role]
}

const canStore = typeof localStorage !== 'undefined'

function loadJson<T>(key: string, fallback: T): T {
  if (!canStore) return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function loadRole(): Role {
  if (!canStore) return 'coordinator'
  const raw = localStorage.getItem(ROLE_KEY)
  return raw === 'surgeon' || raw === 'admin' || raw === 'coordinator' ? raw : 'coordinator'
}

/* ── In-module state, loaded once ─────────────────────────────────────────── */

let snapshot: DashboardSnapshot = {
  reviews: loadJson<Record<string, ReviewState>>(REVIEWS_KEY, {}),
  audit: loadJson<AuditEvent[]>(AUDIT_KEY, []),
  workupOverrides: loadJson<Record<string, Record<string, WorkupStatus>>>(WORKUP_KEY, {}),
  role: loadRole(),
}

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): DashboardSnapshot {
  return snapshot
}

function persist() {
  if (!canStore) return
  try {
    localStorage.setItem(REVIEWS_KEY, JSON.stringify(snapshot.reviews))
    localStorage.setItem(AUDIT_KEY, JSON.stringify(snapshot.audit))
    localStorage.setItem(WORKUP_KEY, JSON.stringify(snapshot.workupOverrides))
    localStorage.setItem(ROLE_KEY, snapshot.role)
  } catch {
    /* storage full / unavailable — demo state stays in memory */
  }
}

let eventCounter = 0
function newEventId(): string {
  eventCounter += 1
  return `evt-${Date.now()}-${eventCounter}`
}

/* ── Actions (module-level → referentially stable) ────────────────────────── */

/** Record a review decision AND its audit event atomically. */
export function applyAction(
  referralId: string,
  action: ReviewStatus,
  opts: { actor: string; role: Role; correction?: Correction; note?: string },
): void {
  const at = new Date().toISOString()
  const review: ReviewState = {
    referralId,
    status: action,
    reviewer: opts.actor,
    reviewedAt: at,
    correction: opts.correction,
  }
  const event: AuditEvent = {
    id: newEventId(),
    referralId,
    at,
    actor: opts.actor,
    role: opts.role,
    action,
    correction: opts.correction,
    note: opts.note,
  }
  snapshot = {
    ...snapshot,
    reviews: { ...snapshot.reviews, [referralId]: review },
    audit: [...snapshot.audit, event],
  }
  persist()
  notify()
}

/** Return a reviewed referral to the pending queue; audited. */
export function reopenReview(referralId: string, actor: string, role: Role): void {
  const at = new Date().toISOString()
  const review: ReviewState = { referralId, status: 'pending' }
  const event: AuditEvent = {
    id: newEventId(),
    referralId,
    at,
    actor,
    role,
    action: 'pending',
    note: 'Reopened for review',
  }
  snapshot = {
    ...snapshot,
    reviews: { ...snapshot.reviews, [referralId]: review },
    audit: [...snapshot.audit, event],
  }
  persist()
  notify()
}

export function setRole(role: Role): void {
  if (role === snapshot.role) return
  snapshot = { ...snapshot, role }
  persist()
  notify()
}

/** Coordinator/surgeon marks a workup item's progress; audited. */
export function setWorkupStatus(
  referralId: string,
  itemName: string,
  status: WorkupStatus,
  actor: string,
  role: Role,
): void {
  const at = new Date().toISOString()
  const event: AuditEvent = {
    id: newEventId(),
    referralId,
    at,
    actor,
    role,
    action: 'workup_status_changed',
    note: `${itemName} → ${status}`,
  }
  snapshot = {
    ...snapshot,
    workupOverrides: {
      ...snapshot.workupOverrides,
      [referralId]: { ...snapshot.workupOverrides[referralId], [itemName]: status },
    },
    audit: [...snapshot.audit, event],
  }
  persist()
  notify()
}

/** Wipe all demo review state (reviews, audit, workup, role, surgeon visit). */
export function resetDemoData(): void {
  if (canStore) {
    for (const key of ALL_KEYS) localStorage.removeItem(key)
  }
  snapshot = { reviews: {}, audit: [], workupOverrides: {}, role: 'coordinator' }
  notify()
}

export function getSurgeonLastVisit(): string | null {
  return canStore ? localStorage.getItem(SURGEON_VISIT_KEY) : null
}

export function markSurgeonVisit(): void {
  if (canStore) localStorage.setItem(SURGEON_VISIT_KEY, new Date().toISOString())
}

/* ── React binding ────────────────────────────────────────────────────────── */

export function useDashboardStore() {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  return {
    reviews: snap.reviews,
    audit: snap.audit,
    workupOverrides: snap.workupOverrides,
    role: snap.role,
    applyAction,
    reopenReview,
    setRole,
    setWorkupStatus,
    resetDemoData,
  }
}
