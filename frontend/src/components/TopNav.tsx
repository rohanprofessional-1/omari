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

/**
 * One unified toolbar-button style (the former "Load Duke" button's treatment):
 * same shape, size, padding, radius, border, and typography for EVERY action.
 * Only the colour varies by purpose — blue = load/utility, green = save (positive),
 * red = clear (destructive).
 */
const TOOLBAR_BTN =
  'rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors'
const TOOLBAR_BLUE = 'border-accent/40 bg-sky text-accent hover:bg-accent/10'
const TOOLBAR_GREEN =
  'border-success/40 bg-success-light/25 text-success hover:bg-success-light/40'
const TOOLBAR_RED = 'border-danger/40 bg-danger/8 text-danger hover:bg-danger/15'

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
            {/* Two-tree loader: simple sample (fallback) vs deep Duke tree — BLUE */}
            <button
              onClick={actions.onLoadSimple}
              title="Load the simple seeded sample tree"
              className={`${TOOLBAR_BTN} ${TOOLBAR_BLUE}`}
            >
              Load sample tree (simple)
            </button>
            <button
              onClick={actions.onLoadDuke}
              title="Load the deep Duke Nerve Center tree"
              className={`${TOOLBAR_BTN} ${TOOLBAR_BLUE}`}
            >
              Load Duke Nerve Center tree (complex)
            </button>
            {/* Save — GREEN (positive/primary) */}
            <button
              onClick={actions.onSave}
              title="Save this tree"
              className={`${TOOLBAR_BTN} ${TOOLBAR_GREEN}`}
            >
              Save tree
            </button>
            {/* Auto-layout — BLUE (utility) */}
            <button
              onClick={actions.onAutoLayout}
              title="Auto-layout the tree"
              className={`${TOOLBAR_BTN} ${TOOLBAR_BLUE}`}
            >
              Auto-layout
            </button>
            {/* Clear — RED (destructive) */}
            <button
              onClick={actions.onClear}
              title="Clear and start over"
              className={`${TOOLBAR_BTN} ${TOOLBAR_RED}`}
            >
              Clear / Start over
            </button>
            {/* Status tag (not a button) — small muted monospace label */}
            <span className="hidden rounded-md border border-line bg-bg px-2 py-1 font-mono text-[11px] text-muted lg:inline">
              {actions.treeId}
            </span>
          </>
        )}
      </div>
    </header>
  )
}

export default TopAppBar
