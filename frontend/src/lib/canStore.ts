/**
 * Is localStorage actually usable here?
 *
 * `typeof localStorage !== 'undefined'` is NOT enough. Node exposes a partial
 * shim when run with --localstorage-file, and Safari's private mode exposes the
 * object but throws on write. Both pass the typeof check and then blow up at
 * module-load time, taking the whole store with them.
 *
 * Feature-detect the two methods we call, and prove a write round-trips.
 */
export function localStorageWorks(): boolean {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return false
    if (typeof localStorage.getItem !== 'function') return false
    if (typeof localStorage.setItem !== 'function') return false
    if (typeof localStorage.removeItem !== 'function') return false
    // Safari private mode: the API exists but every write throws.
    const probe = '__omari_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}
