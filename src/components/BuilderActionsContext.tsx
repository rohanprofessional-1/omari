import { createContext, useContext } from 'react'

/**
 * Lets node cards trigger Builder-level actions (delete) without prop-drilling
 * through React Flow. The provider value is supplied by BuilderCanvas.
 */
export interface BuilderActions {
  deleteNode: (id: string) => void
  /** Signal which bucket row is hovered (for per-path edge highlighting), or null. */
  onBucketHover?: (key: { nodeId: string; branchIndex: number } | null) => void
}

const BuilderActionsContext = createContext<BuilderActions>({
  deleteNode: () => {},
  onBucketHover: () => {},
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

export default BuilderActionsContext
