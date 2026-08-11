import { deriveTreeResult } from '../lib/deriveTreeResult'
import type { ReferralScope, ReferralSource, ReviewableReferral } from '../types'
import { REFERRAL_FIXTURES } from './fixtures/referrals'
import { fetchReferrals as apiFetchReferrals } from '../../lib/api'

/**
 * Dashboard — referral source adapter. THIS IS THE EPIC SWAP SEAM.
 *
 * The entire UI consumes only the `ReferralSource` interface. Today it is
 * backed by `MockEpicSource`, which maps the seed fixtures through
 * `deriveTreeResult` (with a little simulated latency so loading states are
 * honest). A future `LiveEpicSource` would fetch real referral payloads from
 * Epic (FHIR ServiceRequest / referral messages), run the real LLM extraction
 * to produce `ReferralExtraction`, and return the same `ReviewableReferral`
 * shape — same interface, zero UI change. Swap happens only inside
 * `getReferralSource()`.
 *
 * TODO(epic): the OUTBOUND leg is still missing. Today the pipeline ENDS at a
 * local review decision, but in production the queue is Epic's, not ours — an
 * approve / correct / reject has to write BACK. Add
 * `submitDecision(referralId, decision)` to `ReferralSource`; `LiveEpicSource`
 * implements it as a FHIR ServiceRequest update (status / performer /
 * reasonCode) or an Epic In Basket message, and `MockEpicSource` no-ops. See
 * docs/tree-generator-technical-architecture.md §5 (api/v1/referrals.py). The
 * one place decisions funnel through is `applyAction` in lib/reviewStore.ts.
 */

const SIMULATED_LATENCY_MS = 150

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

class MockEpicSource implements ReferralSource {
  private cache: ReviewableReferral[] | null = null

  /** Derivation runs once and is cached — the engine is deterministic. */
  private materialize(): ReviewableReferral[] {
    if (!this.cache) {
      this.cache = REFERRAL_FIXTURES.map((fixture) => ({
        payload: fixture.payload,
        extraction: fixture.extraction,
        result: deriveTreeResult(fixture),
      }))
    }
    return this.cache
  }

  async listReferrals(scope?: ReferralScope): Promise<ReviewableReferral[]> {
    await delay(SIMULATED_LATENCY_MS)
    return applyScope(this.materialize(), scope)
  }

  async getReferral(id: string, scope?: ReferralScope): Promise<ReviewableReferral | null> {
    await delay(SIMULATED_LATENCY_MS)
    const match = this.materialize().find((r) => r.payload.referralId === id)
    if (!match) return null
    return applyScope([match], scope)[0] ?? null
  }
}

class LiveEpicSource implements ReferralSource {
  private cache: ReviewableReferral[] | null = null
  private lastFetch = 0

  private async fetchAndMaterialize(): Promise<ReviewableReferral[]> {
    // Basic cache (5 seconds) to avoid spamming the backend
    if (this.cache && Date.now() - this.lastFetch < 5000) {
      return this.cache
    }

    const backendReferrals = await apiFetchReferrals()
    
    this.cache = backendReferrals.map((r: any) => {
      // Map backend model back to the EpicReferralPayload fixture shape the frontend expects
      const payload: any = {
        referralId: r.display_id, // Map display ID to referralId for URL routing
        receivedAt: r.received_at,
        channel: r.channel,
        patient: {
          name: r.patient?.name || 'Unknown Patient',
          mrn: r.patient?.mrn || 'Unknown MRN',
          dob: r.patient?.dob || 'Unknown DOB',
          sex: r.patient?.sex || 'Unknown',
          phone: r.patient?.phone || ''
        },
        referredBy: {
          provider: r.referred_by?.provider || 'Unknown Provider',
          npi: r.referred_by?.npi || '',
          practice: r.referred_by?.practice || '',
          phone: r.referred_by?.phone || '',
          fax: r.referred_by?.fax || ''
        },
        referredToDepartment: 'Neurology',
        priority: r.priority || 'routine',
        reasonForReferral: r.reason_for_referral || '',
        clinicalNote: r.clinical_note || '',
        diagnoses: [],
        attachments: [],
        structured: r.structured_data || {}
      }
      
      const extraction = {
        variables: r.extraction || {},
        sources: {}
      }

      const fixture = { payload, extraction, annotations: r.annotations || {} }
      
      return {
        payload,
        extraction,
        result: deriveTreeResult(fixture),
      }
    })
    
    this.lastFetch = Date.now()
    return this.cache
  }

  async listReferrals(scope?: ReferralScope): Promise<ReviewableReferral[]> {
    const materialized = await this.fetchAndMaterialize()
    return applyScope(materialized, scope)
  }

  async getReferral(id: string, scope?: ReferralScope): Promise<ReviewableReferral | null> {
    const materialized = await this.fetchAndMaterialize()
    const match = materialized.find((r) => r.payload.referralId === id)
    if (!match) return null
    return applyScope([match], scope)[0] ?? null
  }
}

let singleton: ReferralSource | null = null

export function getReferralSource(): ReferralSource {
  if (!singleton) singleton = new LiveEpicSource()
  return singleton
}

