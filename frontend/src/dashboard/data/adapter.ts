import { deriveTreeResult } from '../lib/deriveTreeResult'
import type { ReferralScope, ReferralSource, ReviewableReferral, EpicReferralPayload, ReferralExtraction, ReferralAnnotations } from '../types'
import { fetchReferrals, fetchReferral, fetchAllReviews, fetchAllAuditEvents, type ApiReferral } from '../../lib/api'
import { loadActiveTree, getActiveTreeState } from '../lib/activeTreeStore'
import { hydrateReviews, hydrateAudit } from '../lib/reviewStore'
import type { ReviewStatus } from '../types'

/**
 * Dashboard — referral source adapter. THE EPIC SWAP SEAM.
 *
 * The entire UI consumes only the `ReferralSource` interface. This adapter
 * fetches referral data from the backend API (`/api/v1/referrals`), runs each
 * referral through `deriveTreeResult` to compute routing, and returns the same
 * `ReviewableReferral` shape the UI expects.
 *
 * Previously this was backed by `MockEpicSource` which read from hardcoded
 * frontend fixture files. Now it hits the real database via the API.
 *
 * TODO(epic): the OUTBOUND leg is still missing. Today the pipeline ENDS at a
 * local review decision, but in production the queue is Epic's, not ours — an
 * approve / correct / reject has to write BACK. Add
 * `submitDecision(referralId, decision)` to `ReferralSource`; the live source
 * implements it as a FHIR ServiceRequest update (status / performer /
 * reasonCode) or an Epic In Basket message. See
 * docs/tree-generator-technical-architecture.md §5 (api/v1/referrals.py). The
 * one place decisions funnel through is `applyAction` in lib/reviewStore.ts.
 */

/**
 * Convert an API referral response into the frontend's fixture shape, then
 * derive the tree result. The derivation is deterministic and runs entirely
 * on the client — it replays the referral through the compiled dashboard tree.
 */
function apiReferralToReviewable(apiRef: ApiReferral): ReviewableReferral {
  const payload: EpicReferralPayload = apiRef.payload as unknown as EpicReferralPayload
  const extraction: ReferralExtraction = apiRef.extraction as unknown as ReferralExtraction
  const annotations: ReferralAnnotations | undefined =
    (apiRef.annotations as unknown as ReferralAnnotations) ?? undefined

  const fixture = { payload, extraction, annotations }
  
  const treeState = getActiveTreeState()
  if (treeState.status !== 'ready' || !treeState.tree) {
    throw new Error('Active tree not loaded. Cannot derive results.')
  }

  return {
    payload,
    extraction,
    result: deriveTreeResult(fixture, treeState.tree, treeState.overrideNodeIds),
  }
}

/**
 * Apply a scope to the materialized list.
 *
 * Deliberately knows NOTHING about local review state — this models the future
 * server-side `WHERE`, and the live source will do it in SQL. A destination
 * that a reviewer has since CORRECTED is handled one layer up, in lib/scope.ts,
 * because corrections live in the review store rather than in Epic.
 *
 * TODO(epic): this must become a server-side query, not a client filter. A
 * surgeon must never receive another surgeon's referrals over the wire
 * (docs/tree-generator-technical-architecture.md §7 D4).
 */
function applyScope(all: ReviewableReferral[], scope?: ReferralScope): ReviewableReferral[] {
  if (!scope || (!scope.specialistName && !scope.mrn)) return all
  return all.filter((r) => {
    if (scope.mrn && r.payload.patient.mrn !== scope.mrn) return false
    if (scope.specialistName && r.result.routedTo?.specialistName !== scope.specialistName) {
      return false
    }
    return true
  })
}

class LiveApiSource implements ReferralSource {
  private cache: ReviewableReferral[] | null = null

  /** Fetch from API and derive tree results. Cached after first fetch. */
  private async materialize(scope?: ReferralScope): Promise<ReviewableReferral[]> {
    if (!this.cache) {
      try {
        await loadActiveTree()
        const opts: { mrn?: string; clinicId?: string } = {}
        // MRN filtering can be done server-side for efficiency
        if (scope?.mrn) opts.mrn = scope.mrn
        if (scope?.clinicId) opts.clinicId = scope.clinicId

        const apiReferrals = await fetchReferrals(opts)
        this.cache = apiReferrals.map(apiReferralToReviewable)

        try {
          const apiReviews = await fetchAllReviews()
          const reviewStates = apiReviews.map(r => ({
            referralId: r.referral_id,
            status: r.status as ReviewStatus,
            reviewer: r.reviewer ?? undefined,
            reviewedAt: r.reviewed_at ?? undefined,
            correction: r.correction ? (r.correction as any) : undefined,
            surgeonSeen: r.surgeon_seen,
          }))
          hydrateReviews(reviewStates)

          const apiAudits = await fetchAllAuditEvents()
          const auditEvents = apiAudits.map((a) => ({
            id: a.id,
            referralId: a.referral_id,
            at: a.at,
            actor: a.actor,
            role: a.role as any,
            action: a.action as any,
            correction: a.correction as any,
            note: a.note || undefined,
          }))
          hydrateAudit(auditEvents)
        } catch (err) {
          console.warn('[LiveApiSource] Failed to fetch reviews for hydration:', err)
        }
      } catch (err) {
        console.warn('[LiveApiSource] Failed to fetch referrals from API, returning empty list:', err)
        this.cache = []
      }
    }
    return this.cache
  }

  async listReferrals(scope?: ReferralScope): Promise<ReviewableReferral[]> {
    const all = await this.materialize(scope)
    return applyScope(all, scope)
  }

  async getReferral(id: string, scope?: ReferralScope): Promise<ReviewableReferral | null> {
    try {
      await loadActiveTree()
      const apiRef = await fetchReferral(id)
      const reviewable = apiReferralToReviewable(apiRef)
      return applyScope([reviewable], scope)[0] ?? null
    } catch {
      return null
    }
  }
}

let singleton: ReferralSource | null = null

export function getReferralSource(): ReferralSource {
  if (!singleton) singleton = new LiveApiSource()
  return singleton
}
