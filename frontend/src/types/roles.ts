/**
 * Omari — who is using the app.
 *
 * Three roles, one per view:
 *   admin    — the clinic. Works the referral queue, runs the directory, and
 *              owns every tree-authoring tool. Absorbs what used to be the
 *              separate 'coordinator' role: the front desk and the clinic
 *              administrator are one person in this product.
 *   surgeon  — a specialist. Sees only referrals routed to them, the
 *              exceptions that need their call, and their own workup.
 *   patient  — intake, their own referral's progress, and their appointments.
 *
 * This is the ONLY role vocabulary in the frontend; src/dashboard/types.ts
 * re-exports it so the referral layer and the auth layer can never drift.
 *
 * TODO(auth): the server has no roles yet. When the `users` table lands
 * (docs/tree-generator-technical-architecture.md §2.1) this union must match
 * its `role` column, and the server — not the client — becomes the authority.
 */
export type Role = 'admin' | 'surgeon' | 'patient'

/** Every role, in nav order. Useful for demo switchers and exhaustive maps. */
export const ROLES: readonly Role[] = ['admin', 'surgeon', 'patient'] as const

/** Narrow an untrusted string (localStorage, a URL, an API) to a Role. */
export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'surgeon' || value === 'patient'
}
