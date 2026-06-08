import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Home as HomeIcon,
  ClipboardList,
  Route as RouteIcon,
  FileText,
  MessageCircle,
  Bell,
  Settings as SettingsIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useToast } from './Toast'
import Logo from './Logo'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/intake', label: 'Intake', icon: ClipboardList },
  { to: '/journey', label: 'My Care', icon: RouteIcon },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/messages', label: 'Messages', icon: MessageCircle },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 ease-out justify-center md:justify-start ${
    isActive
      ? 'bg-slate-100 text-blume-dark'
      : 'text-slate-500 hover:bg-slate-50 hover:text-blume-dark'
  }`

export default function AppShell() {
  const { showToast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-canvas text-ink">
      {/* Sidebar */}
      <aside className="flex h-full w-16 shrink-0 flex-col border-r border-slate-200/70 bg-white md:w-[248px]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 py-6 md:px-5">
          <Logo className="h-8 w-8 shrink-0" />
          <div className="hidden leading-tight md:block">
            <p className="text-[15px] font-semibold tracking-tight text-blume-dark">
              Blume
            </p>
            <p className="text-[11px] font-medium text-slate-400">
              NerveRoute
            </p>
          </div>
        </div>

        {/* Primary nav */}
        <nav className="flex-1 px-2.5 py-3 md:px-3">
          <p className="mb-2 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 md:block">
            Menu
          </p>
          <ul className="space-y-0.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink to={to} end={to === '/'} className={linkClass}>
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                          isActive
                            ? 'text-blume'
                            : 'text-slate-400 group-hover:text-slate-600'
                        }`}
                      />
                      <span className="hidden md:inline">{label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom: notifications + settings + profile */}
        <div className="space-y-0.5 border-t border-slate-200/70 px-2.5 py-3 md:px-3">
          <button
            onClick={() => showToast('You have no new notifications.', 'info')}
            className="group flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-500 transition-all duration-200 hover:bg-slate-50 hover:text-blume-dark md:justify-start"
          >
            <span className="relative">
              <Bell className="h-[18px] w-[18px] shrink-0 text-slate-400 transition-colors group-hover:text-slate-600" />
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blume ring-2 ring-white" />
            </span>
            <span className="hidden md:inline">Notifications</span>
          </button>

          <NavLink to="/settings" className={linkClass}>
            {({ isActive }) => (
              <>
                <SettingsIcon
                  className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                    isActive ? 'text-blume' : 'text-slate-400 group-hover:text-slate-600'
                  }`}
                />
                <span className="hidden md:inline">Settings</span>
              </>
            )}
          </NavLink>

          <button
            onClick={() => navigate('/settings')}
            className="mt-2 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-all duration-200 hover:bg-slate-50 md:px-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-blume-dark">
              SC
            </span>
            <span className="hidden min-w-0 leading-tight md:block">
              <span className="block truncate text-[13px] font-semibold text-blume-dark">
                Sarah Chen
              </span>
              <span className="block truncate text-[11px] text-slate-400">
                Patient
              </span>
            </span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main key={location.pathname} className="min-w-0 flex-1 overflow-y-auto">
        <div className="animate-fade-up mx-auto w-full max-w-[1080px] px-5 py-10 sm:px-8 md:px-12">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
