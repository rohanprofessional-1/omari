import { createContext, useContext } from 'react'

/**
 * Lets BuilderCanvas publish its global tree actions (Save / Auto-layout /
 * Clear) up to the top app bar, so those buttons live in the bar instead of
 * floating on the canvas — WITHOUT changing what they do. The buttons still
 * invoke the exact same handlers (they close over React Flow context).
 */
export interface ToolbarActions {
  onSave: () => void
  onAutoLayout: () => void
  onClear: () => void
  treeId: string
}

interface ToolbarRegistry {
  register: (actions: ToolbarActions | null) => void
}

const BuilderToolbarContext = createContext<ToolbarRegistry>({ register: () => {} })

export function useBuilderToolbar(): ToolbarRegistry {
  return useContext(BuilderToolbarContext)
}

export default BuilderToolbarContext
