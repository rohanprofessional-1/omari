import type { ReactNode } from 'react'

/**
 * EpicContainer — the outermost chrome that makes a view look like it's
 * running inside Epic Hyperspace. Provides the navy header bar, applies
 * Epic design tokens via the .epic-shell class, and constrains the content
 * to a comfortable reading width.
 */

interface EpicContainerProps {
  /** Text shown in the navy header bar (e.g. "Orders" or "In Basket") */
  title: string
  /** Optional subtitle / context (e.g. "Duke Nerve Center") */
  subtitle?: string
  /** Optional right-side slot in the header (user badge, status, etc.) */
  headerRight?: ReactNode
  children: ReactNode
}

export default function EpicContainer({ title, subtitle, headerRight, children }: EpicContainerProps) {
  return (
    <div className="epic-shell flex h-full flex-col">
      {/* Epic navy header bar */}
      <header
        className="flex h-12 shrink-0 items-center justify-between px-5"
        style={{ background: 'var(--epic-navy-700)' }}
      >
        <div className="flex items-center gap-3">
          <EpicLogo />
          <div>
            <h1 className="text-[14px] font-semibold text-white leading-tight">{title}</h1>
            {subtitle && (
              <p className="text-[11px] text-white/70 leading-tight">{subtitle}</p>
            )}
          </div>
        </div>
        {headerRight && <div className="flex items-center gap-2">{headerRight}</div>}
      </header>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: 'var(--epic-bg)' }}>
        {children}
      </div>
    </div>
  )
}

/** Simplified Epic "E" logo mark for the demo header */
function EpicLogo() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded bg-white/15">
      <span className="text-[13px] font-bold text-white">E</span>
    </div>
  )
}
