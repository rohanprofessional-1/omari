import { NavLink, Outlet, useLocation } from 'react-router-dom'

/**
 * Omari — the tree-authoring section: draft, then set up.
 *
 * These were two top-level tabs ("Generate" and "Set up") and that was a lie
 * about the work: you cannot set up a guideline you have not drafted, and
 * drafting one drops you straight into setting it up. It is one job in two
 * steps, so it is now one section with two steps — the same second-level
 * pattern the referral section uses.
 *
 * Each step keeps its own URL (`/admin/generate` and `/admin/generate/setup`),
 * so the back button, deep links, and the hand-off from Clinic all still work.
 */

interface Step {
  /** Absolute, so the numbered nav reads as a path rather than a fragment. */
  to: string
  /** Only the first step is an exact match — 'setup' lives underneath it. */
  end?: boolean
  label: string
  subtitle: string
}

const STEPS: Step[] = [
  {
    to: '/admin/generate',
    end: true,
    label: 'Draft',
    subtitle: 'Turn clinical practice guidelines into a draft decision tree.',
  },
  {
    to: '/admin/generate/setup',
    label: 'Set up',
    subtitle: 'Say where your clinic differs from the guideline, then sign it off.',
  },
]

export default function GenerateLayout() {
  const { pathname } = useLocation()
  const onSetup = pathname.startsWith('/admin/generate/setup')
  const active = onSetup ? STEPS[1] : STEPS[0]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Section header — the SAME object as the referral section's header:
          24px sans title, quiet caption, second-level nav as a white pill on a
          gray track. A section header should not change shape between tabs. */}
      <div className="border-b border-line bg-canvas">
        <div className="flex w-full flex-wrap items-center gap-3 px-6 py-3">
          <div className="min-w-0">
            <h1 className="min-w-0 truncate text-heading-sm text-ink">Generate</h1>
            <p className="truncate text-meta text-muted">{active.subtitle}</p>
          </div>

          <nav className="ml-auto inline-flex rounded-lg border border-line bg-bg p-0.5">
            {STEPS.map((step, i) => (
              <NavLink
                key={step.to}
                to={step.to}
                end={step.end}
                className={({ isActive }) =>
                  'flex items-center gap-1.5 rounded-md px-3 py-1 text-meta font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ' +
                  (isActive ? 'bg-canvas text-ink shadow-subtle' : 'text-muted hover:text-ink')
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={
                        'grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-semibold ' +
                        (isActive ? 'bg-accent-strong text-white' : 'bg-line text-muted')
                      }
                    >
                      {i + 1}
                    </span>
                    {step.label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {/* Body — each step owns its own scrolling */}
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
