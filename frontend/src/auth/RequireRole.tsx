import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { Role } from '../types/roles'
import { homeFor } from '../shell/nav'
import { useAuth } from './authStore'

/**
 * Route guard, used as a PATHLESS layout route so one declaration wraps a whole
 * role subtree:
 *
 *   <Route element={<RequireRole role="admin" />}>
 *     <Route path="/admin/clinic" element={<ClinicDirectoryScreen />} />
 *     …
 *   </Route>
 *
 * Signed out  → /signin, remembering where you were headed.
 * Wrong role  → that role's own home, so a stale link never dead-ends.
 *
 * TODO(auth): this is UX, never security. Anyone can edit localStorage and see
 * any screen. The server must enforce with get_current_user + get_current_clinic
 * (docs/tree-generator-technical-architecture.md §7 stage 1), then Postgres RLS
 * (stage 2). Until the API filters by identity, every screen behind this guard
 * is still serving the same client-side fixtures to everyone.
 */
export default function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/signin" state={{ from: location }} replace />
  }
  if (user.role !== role) {
    return <Navigate to={homeFor(user.role)} replace />
  }
  return <Outlet />
}
