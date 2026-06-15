import type { Page } from '../App'
import type { ToolbarActions } from './BuilderToolbarContext'

interface TopAppBarProps {
  page: Page
  onNavigate: (page: Page) => void
  /** Global builder actions, shown on the right when on the Builder page. */
  actions: ToolbarActions | null
}

const links: { id: Page; label: string }[] = [
  { id: 'builder', label: 'Builder' },
  { id: 'runner', label: 'Runner' },
]

function TopAppBar({ page, onNavigate, actions }: TopAppBarProps) {
  return (
    <header className="omari-enter-bar relative z-10 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-canvas px-4">
      {/* Wordmark */}
      <span className="font-display text-[15px] font-semibold tracking-tight text-ink">
        Omari
      </span>

      {/* Segmented page nav */}
      <nav className="inline-flex rounded-lg border border-line bg-bg p-0.5">
        {links.map((link) => {
          const active = page === link.id
          return (
            <button
              key={link.id}
              onClick={() => onNavigate(link.id)}
              aria-current={active ? 'page' : undefined}
              className={
                'rounded-[7px] px-3 py-1 text-sm font-medium transition-colors ' +
                (active
                  ? 'bg-canvas text-accent shadow-[0_1px_2px_rgba(31,36,33,0.06)]'
                  : 'text-muted hover:text-ink')
              }
            >
              {link.label}
            </button>
          )
        })}
      </nav>

      {/* Global tree actions + tree-name tag (Builder only) */}
      <div className="ml-auto flex items-center gap-2">
        {actions && (
          <>
            <button
              onClick={actions.onSave}
              className="rounded-md bg-carolina px-3 py-1.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(75,156,211,0.35)] transition-all hover:bg-carolina-deep hover:shadow-[0_2px_8px_rgba(75,156,211,0.35)] active:translate-y-px"
            >
              Save tree
            </button>
            <button
              onClick={actions.onAutoLayout}
              className="rounded-md border border-line bg-canvas px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-bg"
            >
              Auto-layout
            </button>
            <button
              onClick={actions.onClear}
              className="rounded-md border border-transparent px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/8"
            >
              Clear / Start over
            </button>
            <span className="ml-1 hidden rounded-md border border-line bg-bg px-2 py-1 font-mono text-[11px] text-muted lg:inline">
              {actions.treeId}
            </span>
          </>
        )}
      </div>
    </header>
  )
}

export default TopAppBar
