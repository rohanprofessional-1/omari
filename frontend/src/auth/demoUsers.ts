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
    specialistName: 'Dr. Neill Li',
  },
  {
    id: 'u-surgeon-saltzman',
    clinicId: CLINIC_ID,
    email: 'e.saltzman@dukenerve.org',
    name: 'Dr. Eliana Saltzman',
    role: 'surgeon',
    specialistName: 'Dr. Eliana Saltzman',
  },
  {
    id: 'u-surgeon-bhowmick',
    clinicId: CLINIC_ID,
    email: 'd.bhowmick@dukenerve.org',
    name: 'Dr. Deb Bhowmick',
    role: 'surgeon',
    specialistName: 'Dr. Deb Bhowmick',
  },
  {
    id: 'u-surgeon-mithani',
    clinicId: CLINIC_ID,
    email: 's.mithani@dukenerve.org',
    name: 'Dr. Suhail Mithani',
    role: 'surgeon',
    specialistName: 'Dr. Suhail Mithani',
  },
  {
    id: 'u-surgeon-abdelbarr',
    clinicId: CLINIC_ID,
    email: 'm.abdelbarr@dukenerve.org',
    name: 'Dr. Muhammad Abd-El-Barr',
    role: 'surgeon',
    specialistName: 'Dr. Muhammad Abd-El-Barr',
  },
  {
    id: 'u-surgeon-smith',
    clinicId: CLINIC_ID,
    email: 'g.smith@dukenerve.org',
    name: 'Dr. Gabriel Smith',
    role: 'surgeon',
    specialistName: 'Dr. Gabriel Smith',
  },
  {
    id: 'u-surgeon-neuromuscular',
    clinicId: CLINIC_ID,
    email: 'neuromuscular@dukenerve.org',
    name: 'Dr. Lisa Hobson-Webb',
    role: 'surgeon',
    specialistName: 'Dr. Lisa Hobson-Webb / Dr. Vern Juel',
  },
  {
    id: 'u-surgeon-vorenkamp',
    clinicId: CLINIC_ID,
    email: 'k.vorenkamp@dukenerve.org',
    name: 'Dr. Kevin Vorenkamp',
    role: 'surgeon',
    specialistName: 'Dr. Kevin Vorenkamp',
  },
  {
    id: 'u-surgeon-handtherapy',
    clinicId: CLINIC_ID,
    email: 'handtherapy@dukenerve.org',
    name: 'Hand Therapy Team',
    role: 'surgeon',
    specialistName: 'Hand Therapy / Occupational Therapy',
  },
  {
    id: 'u-patient-testfield',
    clinicId: CLINIC_ID,
    email: 'marla.testfield@example.com',
    name: 'Marla Testfield',
    role: 'patient',
    mrn: 'MRN-4839201',
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
