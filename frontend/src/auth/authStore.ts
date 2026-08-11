import { useSyncExternalStore } from 'react'
import type { Role } from '../types/roles'
import { isRole } from '../types/roles'
import { localStorageWorks } from '../lib/canStore'
import { setRole as setDashboardRole } from '../dashboard/lib/reviewStore'
import { demoUserForRole } from './demoUsers'
import type { AuthSnapshot, User } from './types'
import { login as apiLogin, clearAuthToken } from '../lib/authApi'

/**
 * MOCK AUTH — nothing here is server-side, and none of it is security.
 *
 * Same idiom as the dashboard review store: module-level state, localStorage
 * persistence, a `useSyncExternalStore` binding, and a CACHED snapshot object
 * replaced immutably on every mutation (returning a fresh object per call
 * would loop React).
 *
 * TODO(auth): replace `signIn` with `POST /api/v1/auth/login` returning a JWT;
 * store the token (an httpOnly cookie is preferable to localStorage) and
 * hydrate the User from `GET /api/v1/me`. The User shape already matches
 * docs/tree-generator-technical-architecture.md §2.1 `users(id, clinic_id,
 * email, role, name)` and §7 D4 (FastAPI-native JWT + get_current_user), so
 * the swap is mechanical.
 *
 * ── Single source of role ──────────────────────────────────────────────────
 * The dashboard's review store also holds a `role`, used to sign audit events.
 * Two independent role states would drift, so: AUTH WRITES, THE STORE READS.
 * Every mutation here calls setDashboardRole. Nothing else in the app may call
 * reviewStore.setRole.
 */

const USER_KEY = 'omari:auth:user:v1'

const canStore = localStorageWorks()

function loadUser(): User | null {
  if (!canStore) return null
  
  // If we don't have a JWT token, we shouldn't consider ourselves logged in
  if (!localStorage.getItem('auth_token')) {
    localStorage.removeItem(USER_KEY)
    return null
  }
  
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<User>
    // Reject anything that isn't a usable user — a stale shape must not brick
    // the app into an unguardable state.
    if (!parsed || typeof parsed.id !== 'string' || !isRole(parsed.role)) return null
    return parsed as User
  } catch {
    return null
  }
}

let snapshot: AuthSnapshot = { user: loadUser() }

const listeners = new Set<() => void>()

function notify(): void {
  snapshot = { ...snapshot }
  for (const l of listeners) l()
}

function persist(user: User | null): void {
  if (!canStore) return
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  else localStorage.removeItem(USER_KEY)
}

/** Apply a user everywhere: memory, storage, and the dashboard's audit identity. */
function commit(user: User | null): void {
  snapshot.user = user
  persist(user)
  if (user) setDashboardRole(user.role)
  notify()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(): AuthSnapshot {
  return snapshot
}

export function getUser(): User | null {
  return snapshot.user
}

/**
 * Sign in by email. The password is accepted but never checked — this is a
 * demo. Returns null when no demo account matches.
 * TODO(auth): becomes POST /api/v1/auth/login.
 */
export async function signIn(email: string, password: string = 'mock_password'): Promise<User | null> {
  try {
    const res = await apiLogin(email, password)
    commit(res.user)
    return res.user
  } catch (err) {
    return null
  }
}

export function signOut(): void {
  clearAuthToken()
  commit(null)
}

/**
 * DEMO affordance — jump to the seeded account for another role without
 * signing out. Deliberately distinct from signIn so it is easy to delete
 * alongside demoUsers.ts.
 */
export async function switchDemoRole(role: Role): Promise<User> {
  const user = demoUserForRole(role)
  // Hit the backend login so we get a real token for this role
  const signedIn = await signIn(user.email, 'omari')
  if (!signedIn) throw new Error("Failed to sign in demo role")
  commit(signedIn)
  return signedIn
}

/** React binding. Re-renders on any auth change. */
export function useAuth(): AuthSnapshot & {
  signIn: typeof signIn
  signOut: typeof signOut
  switchDemoRole: typeof switchDemoRole
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  return { ...snap, signIn, signOut, switchDemoRole }
}
