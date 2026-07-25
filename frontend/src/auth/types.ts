import type { Role } from '../types/roles'

export type { Role }

/**
 * The signed-in person.
 *
 * Shaped to match the `users` table specified in
 * docs/tree-generator-technical-architecture.md §2.1
 * (`id, clinic_id, email, role, name, auth fields`) so that swapping the mock
 * store for a real /auth/login response is a change of source, not of shape.
 */
export interface User {
  id: string
  /** Tenant. Every demo user is in one clinic; the server will scope by this.
   *  TODO(auth): docs §7 stage 1 filters every router by clinic_id, stage 2
   *  enforces it with Postgres RLS. The client must never be the authority. */
  clinicId: string | null
  email: string
  /** Display name — also the actor stamped on every audit event. */
  name: string
  role: Role
  /**
   * Roster identity for surgeons: matches `specialists.name` and, critically,
   * the `specialistName` on the tree's specialist nodes. Referral scoping
   * compares against this, so it must be the tree's string verbatim.
   * TODO(auth): becomes a users.specialist_id FK (docs §2.1).
   */
  specialistName?: string
  /**
   * Patient identity: matches EpicReferralPayload.patient.mrn.
   * TODO(auth): becomes a users.patient_id FK to the `patients` table.
   */
  mrn?: string
}

export interface AuthSnapshot {
  user: User | null
}
