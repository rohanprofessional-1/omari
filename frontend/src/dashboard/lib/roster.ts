import { fetchSpecialists, fetchTreeSpecialists } from '../../lib/api'
import type { Tree } from '../../types/tree'
import type { ReviewState, ReviewableReferral } from '../types'
import { destinationOf } from './scope'

/**
 * Who is in the clinic, and what each of them is carrying.
 *
 * Two sources, in priority order:
 *
 *   The compiled decision TREE is the source of truth for who can be routed to.
 *   It needs no network, always agrees with the referrals on screen, and is
 *   what the directory shows when the backend is down (which, in a demo, it
 *   usually is).
 *
 *   The specialists TABLE enriches those entries with contact details when the
 *   database happens to be seeded. It cannot add people — a specialist with no
 *   destination in the tree receives no referrals, so listing them in a
 *   caseload view would be a lie.
 */

export interface RosterEntry {
  /** Matches TreeResult.routedTo.specialistName and User.specialistName. */
  name: string
  specialty: string
  /** Enrichment from the specialists table; absent when the API is unreachable. */
  email?: string
  phone?: string
  department?: string
}

export interface Caseload {
  total: number
  pending: number
  approved: number
  escalated: number
}

/** Every routable destination in the clinic's compiled tree. No network. */
export function treeRoster(activeTree: Tree): RosterEntry[] {
  const seen = new Map<string, RosterEntry>()
  for (const node of activeTree.nodes) {
    if (node.type !== 'specialist') continue
    if (seen.has(node.specialistName)) continue
    seen.set(node.specialistName, {
      name: node.specialistName,
      specialty: node.specialty ?? '—',
    })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Shape of a row from GET /api/v1/specialists (snake_case, all optional). */
interface ApiSpecialist {
  name?: string
  specialty?: string | null
  email?: string | null
  phone?: string | null
  department?: string | null
}

/**
 * Enrich the tree roster with contact details from the specialists table.
 * Never adds or removes people — the tree decides who is in the directory.
 */
export function mergeRoster(api: unknown, tree: RosterEntry[]): RosterEntry[] {
  if (!Array.isArray(api)) return tree
  const byName = new Map<string, ApiSpecialist>()
  for (const row of api as ApiSpecialist[]) {
    if (row?.name) byName.set(row.name, row)
  }
  return tree.map((entry) => {
    const match = byName.get(entry.name)
    if (!match) return entry
    return {
      ...entry,
      specialty: match.specialty || entry.specialty,
      email: match.email ?? undefined,
      phone: match.phone ?? undefined,
      department: match.department ?? undefined,
    }
  })
}

/** The directory, enriched if the API answers and unchanged if it doesn't.
 *
 * Merges two data sources:
 *  1. The tree nodes (always available, used as the base).
 *  2. The tree_specialists join table (enriches with contact details AND adds
 *     any specialists who were manually linked to the tree in the DB but whose
 *     name may differ slightly from the node string).
 */
export async function loadRoster(activeTree: Tree): Promise<RosterEntry[]> {
  const tree = treeRoster(activeTree)
  try {
    // Fetch both enrichment sources in parallel.
    const [apiSpecialists, treeSpecialists] = await Promise.all([
      fetchSpecialists().catch(() => []),
      fetchTreeSpecialists(activeTree.treeId).catch(() => []),
    ])

    // Build a name→details map from the DB specialists.
    const byName = new Map<string, typeof apiSpecialists[number]>()
    for (const s of apiSpecialists as any[]) {
      if (s?.name) byName.set(s.name, s)
    }

    // Start with the tree-derived roster enriched by DB contact details.
    const enriched = mergeRoster(apiSpecialists, tree)

    // Add any specialists from the join table who aren't already in the roster
    // (e.g. manually linked with a slightly different name).
    const inRoster = new Set(enriched.map((e) => e.name))
    for (const ts of treeSpecialists as any[]) {
      if (ts?.name && !inRoster.has(ts.name)) {
        enriched.push({
          name: ts.name,
          specialty: ts.specialty ?? '—',
          email: ts.email ?? undefined,
          phone: ts.phone ?? undefined,
          department: ts.department ?? undefined,
        })
      }
    }

    return enriched
  } catch {
    // Backend fully down — tree roster is a complete answer on its own.
    return tree
  }
}

/**
 * What one specialist is carrying, counted off the referrals on screen.
 * Uses the correction-aware destination, so a corrected referral counts against
 * the surgeon who actually has it.
 */
export function caseloadFor(
  name: string,
  referrals: ReviewableReferral[],
  reviews: Record<string, ReviewState>,
): Caseload {
  const load: Caseload = { total: 0, pending: 0, approved: 0, escalated: 0 }
  for (const referral of referrals) {
    const review = reviews[referral.payload.referralId]
    if (destinationOf(referral, review) !== name) continue
    load.total += 1
    const status = review?.status ?? 'pending'
    if (status === 'pending') load.pending += 1
    if (status === 'approved' || status === 'corrected') load.approved += 1
    if (status === 'escalated' || referral.result.escalated) load.escalated += 1
  }
  return load
}
