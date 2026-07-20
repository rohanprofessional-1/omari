import { createContext, useContext } from 'react'

/**
 * Lets node cards trigger Builder-level actions (delete) without prop-drilling
 * through React Flow. The provider value is supplied by BuilderCanvas.
 */
export interface BuilderActions {
  deleteNode: (id: string) => void
  /** Signal which bucket row is hovered (for per-path edge highlighting), or null. */
  onBucketHover?: (key: { nodeId: string; branchIndex: number } | null) => void
  /** View-only: collapse/expand a node's downstream subtree on the canvas. */
  onToggleCollapse?: (id: string) => void
}

const BuilderActionsContext = createContext<BuilderActions>({
  deleteNode: () => {},
  onBucketHover: () => {},
  onToggleCollapse: () => {},
})

export function useBuilderActions(): BuilderActions {
  return useContext(BuilderActionsContext)
}

/** Small trash button rendered in each node's header. */
export function DeleteNodeButton({ id }: { id: string }) {
  const { deleteNode } = useBuilderActions()
  return (
    <button
      title="Delete node"
      aria-label="Delete node"
      // `nodrag` stops React Flow from starting a node drag on this button;
      // stopPropagation stops the click from selecting the node.
      className="nodrag rounded p-0.5 opacity-0 transition-opacity hover:bg-black/10 focus-visible:opacity-100 group-hover:opacity-100"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        deleteNode(id)
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </svg>
    </button>
  )
}

/**
 * Expand/collapse control for a node that has a downstream subtree. View-only —
 * it never touches the tree data, only what the canvas shows.
 *
 * Rendered as the first chip INSIDE the node header so it reflows with the header
 * layout and can never overlap the title, the delete button, or the canvas wires.
 * A crisp white chip with a navy symbol (matching the app's inverted accent):
 * collapsed shows "+N" (N = hidden descendants); expanded shows "−".
 */
export function CollapseToggle({
  id,
  collapsed,
  hiddenCount,
}: {
  id: string
  collapsed: boolean
  hiddenCount: number
}) {
  const { onToggleCollapse } = useBuilderActions()
  const title = collapsed
    ? `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'step' : 'steps'}`
    : 'Hide this branch'
  return (
    <button
      title={title}
      aria-label={title}
      aria-expanded={!collapsed}
      // `nodrag` stops a node drag; stopPropagation stops node selection.
      className={`nodrag flex h-5 shrink-0 items-center gap-0.5 rounded-md bg-white font-display text-[11px] font-bold leading-none text-accent-strong shadow-[0_1px_2px_rgba(24,20,16,0.18)] transition-colors hover:bg-sky ${
        collapsed ? 'px-1.5' : 'w-5 justify-center'
      }`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggleCollapse?.(id)
      }}
    >
      {collapsed ? (
        <>
          <PlusMinusIcon kind="plus" />
          <span>{hiddenCount}</span>
        </>
      ) : (
        <PlusMinusIcon kind="minus" />
      )}
    </button>
  )
}

/** Crisp +/- glyph for the collapse badge (stroke icon reads better than text). */
function PlusMinusIcon({ kind }: { kind: 'plus' | 'minus' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
      {kind === 'plus' && <path d="M12 5v14" />}
    </svg>
  )
}

export default BuilderActionsContext
