/**
 * Export frontend referral fixtures to JSON for backend seeding.
 *
 * Usage: npx tsx scripts/export-fixtures.ts > ../backend/fixtures.json
 *
 * Reads the TypeScript fixture files and outputs them as JSON that the
 * backend seed_referrals.py script can POST to /api/v1/referrals/bulk.
 */
import { REFERRAL_FIXTURES } from '../src/dashboard/data/fixtures/referrals'

const output = REFERRAL_FIXTURES.map((fixture) => ({
  payload: fixture.payload,
  extraction: fixture.extraction,
  annotations: fixture.annotations ?? null,
}))

console.log(JSON.stringify(output, null, 2))
