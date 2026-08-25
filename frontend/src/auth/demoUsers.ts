import type { Role } from '../types/roles'
import type { User } from './types'

/**
 * Demo accounts — the whole "user database".
 *
 * TODO(auth): delete this file once the `users` table exists. Every entry here
 * maps 1:1 to a users row (docs/tree-generator-technical-architecture.md §2.1),
 * so the swap is a query, not a redesign.
 *
 * Two bindings are load-bearing and must not be edited casually:
 *
 *  1. Every surgeon's `specialistName` is a VERBATIM specialist destination
 *     from src/data/dukeNerveTree.ts. Referral scoping matches on this string;
 *     a typo silently empties that surgeon's queue.
 *
 *  2. The patient's `mrn` binds to referral REF-2026-0142 in
 *     src/dashboard/data/fixtures/referrals.ts. Intake does not yet write to
 *     the referral queue (there is no /referrals endpoint), so the patient's
 *     status screen reads that pinned fixture instead. Cross-referenced in the
 *     fixture file.
 */

const CLINIC_ID = 'duke-nerve-center'

/** Any password works in the demo; this is what the sign-in page suggests. */
export const DEMO_PASSWORD = 'omari'

export const DEMO_USERS: User[] = [
  {
    id: 'u-admin-okafor',
    clinicId: CLINIC_ID,
    email: 'gkancharla@gmail.com',
    name: 'M. Okafor',
    role: 'admin',
  },
  {
    id: 'u-surgeon-li',
    clinicId: CLINIC_ID,
    email: 'n.li@dukenerve.org',
    name: 'Dr. Neill Li',
    role: 'surgeon',
    specialistName: 'Dr. Neill Li', // dukeNerveTree.ts:281
  },
  {
    id: 'u-surgeon-saltzman',
    clinicId: CLINIC_ID,
    email: 'e.saltzman@dukenerve.org',
    name: 'Dr. Eliana Saltzman',
    role: 'surgeon',
    specialistName: 'Dr. Eliana Saltzman', // dukeNerveTree.ts:298 — busiest destination
  },
  {
    id: 'u-surgeon-bhowmick',
    clinicId: CLINIC_ID,
    email: 'd.bhowmick@dukenerve.org',
    name: 'Dr. Deb Bhowmick',
    role: 'surgeon',
    specialistName: 'Dr. Deb Bhowmick', // dukeNerveTree.ts:349 — has a clinic delta
  },
  {
    id: 'u-patient-testfield',
    clinicId: CLINIC_ID,
    email: 'marla.testfield@example.com',
    name: 'Marla Testfield',
    role: 'patient',
    mrn: 'MRN-4839201', // fixtures/referrals.ts → REF-2026-0142
  },
  {
    id: 'u-patient-wilson',
    clinicId: CLINIC_ID,
    email: 'james.wilson@example.com',
    name: 'James Wilson',
    role: 'patient',
    mrn: 'MRN-8472910', // From seed.py REF-2026-3392
  },
]

/** Case-insensitive lookup by email. Password is not checked (demo). */
export function findDemoUser(email: string): User | null {
  const needle = email.trim().toLowerCase()
  return DEMO_USERS.find((u) => u.email.toLowerCase() === needle) ?? null
}

/** The account the DEMO role chip jumps to for a given role. */
export function demoUserForRole(role: Role): User {
  const match = DEMO_USERS.find((u) => u.role === role)
  if (!match) throw new Error(`No demo user seeded for role "${role}"`)
  return match
}
