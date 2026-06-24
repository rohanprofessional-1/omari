import { useState, type ReactNode } from 'react'

/**
 * A compact, independent disclosure row for node cards (Builder canvas).
 *
 * Pure local UI state — it holds no tree data and changes nothing about the
 * schema/engine. Each instance toggles on its own. It is drag/selection-safe:
 * `nodrag` + stopPropagation on pointer-down/click keep React Flow from starting
 * a drag or selecting the node when the row is clicked, while clicking ANYWHERE
 * else on the card still selects/drags/edits the node exactly as before.
 */
export function CardExpander({
  label,
  children,
  defaultOpen = false,
  onToggle,
}: {
  label: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** Fired after toggling — e.g. so a node can re-measure moved handles. */
  onToggle?: () => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
          onToggle?.()
        }}
        className="nodrag flex w-full items-center gap-1.5 rounded-md border border-line/70 bg-bg px-2 py-1 text-left font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-muted transition-colors hover:bg-sky/60 hover:text-ink"
      >
        <span
          aria-hidden
          className={`inline-block text-[9px] leading-none transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
        >
          ▸
        </span>
        {label}
      </button>
      {open && <div className="omari-panel-content mt-1.5">{children}</div>}
    </div>
  )
}
