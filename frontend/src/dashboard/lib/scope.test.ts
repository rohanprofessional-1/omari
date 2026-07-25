/**
 * Dashboard — referral scoping tests.
 *
 * The invariants a surgeon's view rests on:
 *   1. A destination CORRECTION moves a referral — away from the surgeon the
 *      tree chose, and toward the corrected one. Urgency and scope corrections
 *      do not move anything.
 *   2. Admin sees the clinic; a surgeon sees only their own; a patient scopes
 *      by MRN.
 *   3. A missing identity binding fails CLOSED — an unbound surgeon must not
 *      fall back to seeing everyone.
 *
 * Same self-asserting style as the other dashboard tests: no framework, run via
 * `npm test`. Registered by hand in scripts/run-tests.mjs.
 */
import type { User } from '../../auth/types'
import { destinationOf, filterForUser, isForSpecialist, scopeFor } from './scope'
import type { Correction, ReviewState, ReviewableReferral, TreeResult } from '../types'

declare const process: { exitCode?: number } | undefined

const LI = 'Dr. Neill Li'
const SALTZMAN = 'Dr. Eliana Saltzman'

/** A referral carrying only what scoping reads. */
function referral(id: string, routedTo: string | null, mrn = 'MRN-1'): ReviewableReferral {
  return {
    payload: { referralId: id, patient: { mrn } } as ReviewableReferral['payload'],
    extraction: { variables: {}, sources: {} },
    result: {
      routedTo: routedTo ? { specialistName: routedTo, specialty: 'Nerve', nodeId: 'n1' } : null,
    } as TreeResult,
  }
}

function review(status: ReviewState['status'], correction?: Correction): ReviewState {
  return { referralId: 'x', status, correction }
}

const surgeonLi: User = {
  id: 'u1',
  clinicId: 'c1',
  email: 'n.li@dukenerve.org',
  name: LI,
  role: 'surgeon',
  specialistName: LI,
}
const admin: User = { id: 'u2', clinicId: 'c1', email: 'a@c', name: 'M. Okafor', role: 'admin' }
const patient: User = {
  id: 'u3',
  clinicId: 'c1',
  email: 'p@c',
  name: 'Marla Testfield',
  role: 'patient',
  mrn: 'MRN-4839201',
}

const checks: { name: string; run: () => string | null }[] = [
  {
    name: 'destinationOf: the tree destination when nothing was corrected',
    run: () => {
      const r = referral('A', SALTZMAN)
      if (destinationOf(r, undefined) !== SALTZMAN) return 'ignored the tree destination'
      if (destinationOf(r, review('approved')) !== SALTZMAN) return 'approval changed the destination'
      return null
    },
  },
  {
    name: 'destinationOf: a destination correction wins; urgency/scope corrections do not',
    run: () => {
      const r = referral('A', SALTZMAN)
      const dest = review('corrected', { field: 'destination', from: SALTZMAN, to: LI, reason: 'x' })
      if (destinationOf(r, dest) !== LI) return 'destination correction not applied'

      const urg = review('corrected', { field: 'urgency', from: 'routine', to: 'urgent', reason: 'x' })
      if (destinationOf(r, urg) !== SALTZMAN) return 'urgency correction moved the referral'

      const scope = review('corrected', { field: 'scope', from: 'in', to: 'out', reason: 'x' })
      if (destinationOf(r, scope) !== SALTZMAN) return 'scope correction moved the referral'
      return null
    },
  },
  {
    name: 'destinationOf: an unrouted referral has no destination',
    run: () => (destinationOf(referral('A', null), undefined) === null ? null : 'expected null'),
  },
  {
    name: 'isForSpecialist: matches on the effective destination',
    run: () => {
      const r = referral('A', SALTZMAN)
      if (isForSpecialist(r, undefined, LI)) return 'matched the wrong surgeon'
      const corrected = review('corrected', {
        field: 'destination',
        from: SALTZMAN,
        to: LI,
        reason: 'x',
      })
      if (!isForSpecialist(r, corrected, LI)) return 'correction toward LI not honoured'
      if (isForSpecialist(r, corrected, SALTZMAN)) return 'still matched the original destination'
      return null
    },
  },
  {
    name: 'filterForUser: a correction moves a referral BOTH ways for a surgeon',
    run: () => {
      const rows = [
        referral('toLi', LI), //          tree sent it to Li
        referral('awayFromLi', LI), //    tree sent it to Li, corrected away
        referral('toLiByFix', SALTZMAN), // tree sent it elsewhere, corrected to Li
      ]
      const reviews: Record<string, ReviewState> = {
        awayFromLi: review('corrected', {
          field: 'destination',
          from: LI,
          to: SALTZMAN,
          reason: 'x',
        }),
        toLiByFix: review('corrected', {
          field: 'destination',
          from: SALTZMAN,
          to: LI,
          reason: 'x',
        }),
      }
      const ids = filterForUser(rows, reviews, surgeonLi)
        .map((r) => r.payload.referralId)
        .sort()
      const want = ['toLi', 'toLiByFix']
      if (ids.join(',') !== want.join(',')) return `got [${ids}], want [${want}]`
      return null
    },
  },
  {
    name: 'filterForUser: admin and patient lists are never narrowed here',
    run: () => {
      const rows = [referral('A', LI), referral('B', SALTZMAN)]
      if (filterForUser(rows, {}, admin).length !== 2) return 'admin list was narrowed'
      if (filterForUser(rows, {}, patient).length !== 2) return 'patient list was narrowed'
      return null
    },
  },
  {
    name: 'scopeFor: admin unscoped, surgeon narrowed later, patient by MRN',
    run: () => {
      if (scopeFor(admin) !== undefined) return 'admin should be unscoped'
      // A bound surgeon is filtered by correction-aware destination, not by the
      // adapter — so the adapter scope is intentionally undefined.
      if (scopeFor(surgeonLi) !== undefined) return 'bound surgeon should not scope the adapter'
      if (scopeFor(patient)?.mrn !== 'MRN-4839201') return 'patient should scope by mrn'
      return null
    },
  },
  {
    name: 'scopeFor: unbound identities fail CLOSED, not open',
    run: () => {
      const unboundSurgeon: User = { ...surgeonLi, specialistName: undefined }
      const unboundPatient: User = { ...patient, mrn: undefined }
      if (scopeFor(unboundSurgeon) === undefined) return 'unbound surgeon fell back to everything'
      if (scopeFor(unboundPatient) === undefined) return 'unbound patient fell back to everything'
      if (scopeFor(null) === undefined) return 'signed-out fell back to everything'
      return null
    },
  },
]

let failures = 0
for (const c of checks) {
  let msg: string | null
  try {
    msg = c.run()
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err)
  }
  if (msg) {
    failures += 1
    console.error(`✗ ${c.name}: ${msg}`)
  } else {
    console.log(`✓ ${c.name}`)
  }
}

if (failures > 0) {
  if (typeof process !== 'undefined') process.exitCode = 1
  throw new Error(`${failures} scope test(s) failed`)
}
console.log(`dashboard/lib/scope.test.ts — all ${checks.length} passed`)
