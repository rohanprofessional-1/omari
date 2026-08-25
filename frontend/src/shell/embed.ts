import { isRole } from '../types/roles'
import type { Role } from '../types/roles'

/**
 * Running inside someone else's chrome.
 *
 * Omari is pitched as something that lives INSIDE the EHR, not beside it, and
 * public/mychart.html is the mock that shows it: an Epic MyChart shell with the
 * patient view in an iframe. Embedded, the app must not bring its own identity
 * furniture — the host already has a header, an account, and a nav rail, so a
 * second wordmark and a role switcher read as a website someone pasted in.
 *
 * Two query flags, both read ONCE at startup so the first render is already
 * correct (an effect would let RequireRole bounce a patient to sign-in before
 * the identity landed):
 *
 *   ?embed=1     hide the app's own wordmark, demo role chip and account menu.
 *                The section nav stays — that is the app's own navigation, and
 *                the host's rail is a level above it.
 *   ?as=<role>   adopt the seeded demo account for that role. The host page
 *                pins the patient so opening MyChart never shows whatever role
 *                the main tab happened to be signed in as.
 *
 * DEMO ONLY. `?as=` is an unauthenticated identity switch, which is acceptable
 * exactly as long as auth is the mock in auth/authStore.ts and no further.
 * TODO(auth): the real embed is an EHR SSO handshake (SMART on FHIR launch),
 * and this flag goes with it.
 */

function params(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

/** True when the app is being framed by a host that supplies its own chrome. */
export const isEmbedded: boolean = (() => {
  const flag = params().get('embed')
  return flag === '1' || flag === 'true'
})()


