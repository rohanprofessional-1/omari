import type { Role } from '../types/roles'

/**
 * Omari — top-level navigation, per role.
 *
 * One row of sections in the app bar, driven entirely by who is signed in.
 * The referral section carries its own second level of sub-tabs (see
 * src/dashboard/layouts/ReferralsLayout.tsx); nothing else needs two levels,
 * so there is no generic mechanism here on purpose.
 *
 * Hiding a section is UX, not security — RequireRole guards the routes, and
 * the server will guard the data (docs/tree-generator-technical-architecture.md §7).
 */

export interface NavItem {
  /** Absolute route path. */
  to: string
  label: string
}

export const SECTIONS: Record<Role, NavItem[]> = {
  // Everything the clinic has: the referral pipeline, the directory, and every
  // tree-authoring tool. There is no Trees section — which tree is in force is
  // one fact, and it lives in a panel at the bottom of Clinic; the structure
  // behind it belongs to the Builder.
  admin: [
    { to: '/admin/referrals', label: 'Referrals' },
    { to: '/admin/clinic', label: 'Clinic' },
    // Drafting a tree and setting it up are two steps of one job, so they are
    // one section with its own step nav (see pages/GenerateLayout.tsx).
    { to: '/admin/generate', label: 'Generate' },
    { to: '/admin/builder', label: 'Builder' },
    { to: '/admin/knowledge', label: 'Knowledge' },
    { to: '/admin/runner', label: 'Runner' },
  ],
  // A specialist's own referrals, the clinic directory, tree generation, and
  // the builder. No knowledge tab or runner — those are admin-only.
  surgeon: [
    { to: '/surgeon/referrals', label: 'Referrals' },
    { to: '/surgeon/clinic', label: 'Clinic' },
    { to: '/surgeon/generate', label: 'Generate' },
    { to: '/surgeon/builder', label: 'Builder' },
  ],
  // Intake, then their own referral status. Nothing clinical, nothing about anyone else.
  patient: [
    { to: '/patient/intake', label: 'Intake' },
    { to: '/patient/status', label: 'My referral' },
  ],
}

/** Where a role lands after signing in, and where a wrong-role URL bounces to. */
export function homeFor(role: Role): string {
  return SECTIONS[role][0].to
}
