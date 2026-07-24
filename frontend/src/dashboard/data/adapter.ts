import { deriveTreeResult } from '../lib/deriveTreeResult'
import type { ReferralSource, ReviewableReferral } from '../types'
import { REFERRAL_FIXTURES } from './fixtures/referrals'

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
 */

const SIMULATED_LATENCY_MS = 150

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  async listReferrals(): Promise<ReviewableReferral[]> {
    await delay(SIMULATED_LATENCY_MS)
    return this.materialize()
  }

  async getReferral(id: string): Promise<ReviewableReferral | null> {
    await delay(SIMULATED_LATENCY_MS)
    return this.materialize().find((r) => r.payload.referralId === id) ?? null
  }
}

let singleton: ReferralSource | null = null

export function getReferralSource(): ReferralSource {
  if (!singleton) singleton = new MockEpicSource()
  return singleton
}
