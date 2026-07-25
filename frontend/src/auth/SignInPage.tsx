import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { homeFor } from '../shell/nav'
import { useAuth } from './authStore'
import { DEMO_PASSWORD, DEMO_USERS } from './demoUsers'
import type { User } from './types'

/**
 * Sign in. Its own full-page layout — no app bar, because there is no app to
 * navigate until you are someone.
 *
 * The demo account list is shown outright: this is a demo, and hiding the
 * credentials behind a README costs a presenter thirty seconds on stage.
 *
 * TODO(auth): the form already collects a password and ignores it. When
 * /api/v1/auth/login lands, submit both and surface the server's error instead
 * of the local "no account" string.
 */

const ROLE_BLURB: Record<User['role'], string> = {
  admin: 'Referral queue, clinic directory, and every tree tool',
  surgeon: 'Your referrals, your escalations, your workup',
  patient: 'Intake, your referral status, and appointments',
}

export default function SignInPage() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Where the guard bounced us from, if anywhere.
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  // Already signed in — don't show a sign-in form; go where you were going.
  if (user) return <Navigate to={from ?? homeFor(user.role)} replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const signedIn = signIn(email)
    if (!signedIn) {
      setError(`No Omari account for “${email.trim() || '…'}”. Pick one of the demo accounts below.`)
      return
    }
    navigate(from ?? homeFor(signedIn.role), { replace: true })
  }

  const fillAs = (u: User) => {
    setEmail(u.email)
    setPassword(DEMO_PASSWORD)
    setError(null)
  }

  const input =
    'w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent-strong/15'

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 py-12">
      <div className="omari-msg w-full max-w-sm">
        {/* Wordmark */}
        <div className="mb-6 flex items-center justify-center">
          <img src="/omari-logo.png" alt="" aria-hidden className="h-14 w-14 object-contain" />
          <span className="-ml-1 font-serif text-[26px] font-semibold tracking-tight text-accent-strong">
            Omari
          </span>
        </div>

        <div className="rounded-2xl border border-line bg-canvas p-6 shadow-subtle">
          <h1 className="text-subheading font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">
            Your view depends on who you are — clinic, specialist, or patient.
          </p>

          <form className="mt-5" onSubmit={submit}>
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] font-medium text-muted">Email</span>
              <input
                type="email"
                className={input}
                placeholder="you@clinic.org"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setError(null)
                }}
                autoFocus
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-[11px] font-medium text-muted">Password</span>
              <input
                type="password"
                className={input}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error && (
              <p role="alert" className="mb-3 rounded-md bg-danger/8 px-3 py-2 text-[12px] text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full rounded-md bg-accent-strong px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#27508f]"
            >
              Sign in
            </button>
          </form>
        </div>

        {/* Demo accounts — one click fills the form. */}
        <div className="mt-4 rounded-2xl border border-line bg-canvas/60 p-3">
          <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Demo accounts · password “{DEMO_PASSWORD}”
          </p>
          <ul className="flex flex-col gap-1">
            {DEMO_USERS.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => fillAs(u)}
                  className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-bg"
                >
                  <span className="text-[13px] font-medium text-ink">{u.name}</span>
                  <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {u.role}
                  </span>
                  <span className="ml-auto truncate text-[11px] text-muted">{ROLE_BLURB[u.role]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted">
          Demo sign-in — no account is created and the password isn’t checked.
        </p>
      </div>
    </div>
  )
}
