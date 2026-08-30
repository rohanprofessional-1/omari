import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import RequireRole from './auth/RequireRole'
import SignInPage from './auth/SignInPage'
import { useAuth } from './auth/authStore'
import AppShell from './shell/AppShell'
import { homeFor } from './shell/nav'
import ReferralsLayout from './dashboard/layouts/ReferralsLayout'
import ClinicDirectoryScreen from './dashboard/components/clinic/ClinicDirectoryScreen'
import DetailScreen from './dashboard/components/detail/DetailScreen'
import QueueScreen from './dashboard/components/queue/QueueScreen'
import SurgeonScreen from './dashboard/components/surgeon/SurgeonScreen'
import WorkupScreen from './dashboard/components/workup/WorkupScreen'
import Builder from './pages/Builder'
import Generate from './pages/Generate'
import GenerateLayout from './pages/GenerateLayout'
import KnowledgeBase from './pages/KnowledgeBase'
import Reconcile from './pages/Reconcile'
import Runner from './pages/Runner'
import MyReferralScreen from './pages/patient/MyReferralScreen'
import AppointmentsScreen from './pages/patient/AppointmentsScreen'

/**
 * Omari — the route table.
 *
 * Three role-scoped subtrees behind a pathless RequireRole guard each, all
 * inside one AppShell. Sign-in is the only public route.
 *
 * Everything used to be a useState page switch (App.tsx) plus a second Vite
 * entry for the dashboard at /dashboard/. Both are gone: one app, one URL
 * space, real deep links and a working back button.
 */

/** Send someone to their own home — or to sign-in if they don't have one. */
function HomeRedirect() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/signin" state={{ from: location }} replace />
  return <Navigate to={homeFor(user.role)} replace />
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignInPage />} />

      <Route element={<AppShell />}>
        <Route index element={<HomeRedirect />} />

        {/* The dashboard's old standalone entry, so demo links still land. */}
        <Route path="/dashboard/*" element={<Navigate to="/admin/referrals" replace />} />

        {/* ── Admin — the clinic. Everything. ─────────────────────────────── */}
        <Route element={<RequireRole role="admin" />}>
          <Route path="/admin" element={<Navigate to="/admin/referrals" replace />} />
          <Route path="/admin/referrals" element={<ReferralsLayout />}>
            <Route index element={<Navigate to="queue" replace />} />
            <Route path="queue" element={<QueueScreen />} />
            <Route path="escalations" element={<SurgeonScreen />} />
            <Route path="workup" element={<WorkupScreen />} />
            <Route path=":referralId" element={<DetailScreen />} />
          </Route>
          <Route path="/admin/clinic" element={<ClinicDirectoryScreen />} />
          {/* Trees was folded into the Clinic directory's tree panel. */}
          <Route path="/admin/trees" element={<Navigate to="/admin/clinic" replace />} />
          {/* Draft a tree from guidelines, then set it up — one section, two
              steps. `/admin/setup` was the old second tab; it still resolves. */}
          <Route path="/admin/generate" element={<GenerateLayout />}>
            <Route index element={<GenerateRoute />} />
            <Route path="setup" element={<ReconcileRoute />} />
          </Route>
          <Route path="/admin/setup" element={<Navigate to="/admin/generate/setup" replace />} />
          <Route path="/admin/builder" element={<Builder />} />
          <Route path="/admin/knowledge" element={<KnowledgeBase />} />
          <Route
            path="/admin/runner"
            element={
              <div className="h-full overflow-y-auto">
                <Runner />
              </div>
            }
          />
        </Route>

        {/* ── Surgeon — their referrals, clinic, generate, and builder. ─── */}
        <Route element={<RequireRole role="surgeon" />}>
          <Route path="/surgeon" element={<Navigate to="/surgeon/referrals" replace />} />
          <Route path="/surgeon/referrals" element={<ReferralsLayout />}>
            <Route index element={<Navigate to="cases" replace />} />
            <Route path="cases" element={<QueueScreen />} />
            <Route path="escalations" element={<SurgeonScreen />} />
            <Route path="workup" element={<WorkupScreen />} />
            <Route path=":referralId" element={<DetailScreen />} />
          </Route>
          <Route path="/surgeon/clinic" element={<ClinicDirectoryScreen />} />
          <Route path="/surgeon/generate" element={<GenerateLayout />}>
            <Route index element={<SurgeonGenerateRoute />} />
            <Route path="setup" element={<SurgeonReconcileRoute />} />
          </Route>
          <Route path="/surgeon/builder" element={<Builder />} />
        </Route>

        {/* ── Patient — intake and their own referral status. ───────────── */}
        <Route element={<RequireRole role="patient" />}>
          <Route path="/patient" element={<Navigate to="/patient/intake" replace />} />
          <Route path="/patient/intake" element={<Runner audience="patient" />} />
          <Route path="/patient/status" element={<MyReferralScreen />} />
          <Route path="/patient/appointments" element={<AppointmentsScreen />} />
        </Route>

        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
  )
}

/* -------------------------------------------------------------------------- */
/* Pages that hand off to another page                                        */
/* -------------------------------------------------------------------------- */
/* Both still pass the tree id through localStorage — Builder and Reconcile   */
/* read those keys on mount — but the navigation itself is now the router's.  */

function GenerateRoute() {
  const navigate = useNavigate()
  return <Generate onOpenReconcile={() => navigate('/admin/generate/setup')} />
}

function ReconcileRoute() {
  const navigate = useNavigate()
  return <Reconcile onOpenBuilder={() => navigate('/admin/builder')} />
}

function SurgeonGenerateRoute() {
  const navigate = useNavigate()
  return <Generate onOpenReconcile={() => navigate('/surgeon/generate/setup')} />
}

function SurgeonReconcileRoute() {
  const navigate = useNavigate()
  return <Reconcile onOpenBuilder={() => navigate('/surgeon/builder')} />
}
