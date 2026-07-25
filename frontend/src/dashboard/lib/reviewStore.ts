import { useSyncExternalStore } from 'react'
import type { AuditEvent, Correction, ReviewState, ReviewStatus, Role, WorkupStatus } from '../types'
import { isRole } from '../../types/roles'

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
  /** ISO timestamp of the surgeon's last 'Mark caught up' — null = never. */
  surgeonLastVisit: string | null
}

// The surgeon name MUST match a specialist destination in the tree verbatim —
// referral scoping compares it against TreeResult.routedTo.specialistName.
// (It read 'Dr. N. Li' before, which matched nothing.)
const REVIEWER_NAMES: Record<Role, string> = {
  admin: 'M. Okafor (front desk)',
  surgeon: 'Dr. Neill Li',
  patient: 'Patient',
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
  if (!canStore) return 'admin'
  const raw = localStorage.getItem(ROLE_KEY)
  // 'coordinator' was folded into 'admin' — migrate anyone who stored it.
  if (raw === 'coordinator') return 'admin'
  return isRole(raw) ? raw : 'admin'
}

/* ── In-module state, loaded once ─────────────────────────────────────────── */

let snapshot: DashboardSnapshot = {
  reviews: loadJson<Record<string, ReviewState>>(REVIEWS_KEY, {}),
  audit: loadJson<AuditEvent[]>(AUDIT_KEY, []),
  workupOverrides: loadJson<Record<string, Record<string, WorkupStatus>>>(WORKUP_KEY, {}),
  role: loadRole(),
  surgeonLastVisit: canStore ? localStorage.getItem(SURGEON_VISIT_KEY) : null,
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

/**
 * Append a comment to the audit trail WITHOUT changing review status — the
 * surgeon's lightweight "I looked at this" affordance.
 */
export function addComment(referralId: string, note: string, actor: string, role: Role): void {
  const event: AuditEvent = {
    id: newEventId(),
    referralId,
    at: new Date().toISOString(),
    actor,
    role,
    action: 'commented',
    note,
  }
  snapshot = { ...snapshot, audit: [...snapshot.audit, event] }
  persist()
  notify()
}

/**
 * Mark a coordinator correction as seen by the surgeon (endorse flow) — the
 * row leaves the surgeon brief without changing the review status. No-op when
 * the referral has no review state.
 */
export function markSurgeonSeen(referralId: string): void {
  const review = snapshot.reviews[referralId]
  if (!review || review.surgeonSeen) return
  snapshot = {
    ...snapshot,
    reviews: { ...snapshot.reviews, [referralId]: { ...review, surgeonSeen: true } },
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

/**
 * Wipe all demo review state (reviews, audit, workup, surgeon visit).
 *
 * The CURRENT ROLE is deliberately preserved: it is who you are signed in as,
 * not demo data. Resetting it would sign the admin out of their own view mid-demo.
 */
export function resetDemoData(): void {
  const role = snapshot.role
  if (canStore) {
    for (const key of ALL_KEYS) localStorage.removeItem(key)
    localStorage.setItem(ROLE_KEY, role)
  }
  snapshot = {
    reviews: {},
    audit: [],
    workupOverrides: {},
    role,
    surgeonLastVisit: null,
  }
  notify()
}

export function getSurgeonLastVisit(): string | null {
  return snapshot.surgeonLastVisit
}

/** Surgeon clicked 'Mark caught up' — zeroes the since-last-visit counters live. */
export function markSurgeonVisit(): void {
  const at = new Date().toISOString()
  if (canStore) {
    try {
      localStorage.setItem(SURGEON_VISIT_KEY, at)
    } catch {
      /* storage unavailable — state stays in memory */
    }
  }
  snapshot = { ...snapshot, surgeonLastVisit: at }
  notify()
}

/* ── React binding ────────────────────────────────────────────────────────── */

export function useDashboardStore() {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  return {
    reviews: snap.reviews,
    audit: snap.audit,
    workupOverrides: snap.workupOverrides,
    role: snap.role,
    surgeonLastVisit: snap.surgeonLastVisit,
    applyAction,
    reopenReview,
    addComment,
    markSurgeonSeen,
    markSurgeonVisit,
    setRole,
    setWorkupStatus,
    resetDemoData,
  }
}
