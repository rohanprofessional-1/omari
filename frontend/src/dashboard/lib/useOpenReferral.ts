import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Open a referral's detail screen from whichever list you're in.
 *
 * Routes are `<role>/referrals/<sub-tab>` and `<role>/referrals/<referralId>`,
 * so a relative `../<id>` lands correctly from any sub-tab without either the
 * lists or the detail screen knowing the role prefix.
 *
 * The origin sub-tab rides along in history state. That replaces the old
 * `cameFrom` useState in DashboardPage: it survives Back/Forward, and a cold
 * deep link simply has no state, which the detail screen renders as a generic
 * "← Back".
 */

/** Sub-tab slugs a detail screen can be opened from. */
export type ReferralOrigin = 'queue' | 'cases' | 'escalations' | 'workup'

const BACK_LABELS: Record<ReferralOrigin, string> = {
  queue: '← Queue',
  cases: '← My cases',
  escalations: '← Escalations',
  workup: '← Workup',
}

/** Back-button text for an origin — falls back to a generic label. */
export function backLabelFor(origin: string | undefined): string {
  return origin && origin in BACK_LABELS ? BACK_LABELS[origin as ReferralOrigin] : '← Back'
}

export function useOpenReferral(): (referralId: string) => void {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const from = pathname.split('/').filter(Boolean).pop()
  return (referralId: string) => navigate(`../${referralId}`, { state: { from } })
}
