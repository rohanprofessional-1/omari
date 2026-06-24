import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Tree } from '../types/tree'

/**
 * Shared app state for the saved decision tree — the bridge between the
 * Builder (writes) and the Runner (reads). In-memory only, per the project's
 * "no database, hold data in app state" principle.
 */
interface TreeStore {
  savedTree: Tree | null
  savedAt: number | null
  saveTree: (tree: Tree) => void
}

const TreeStoreContext = createContext<TreeStore | null>(null)

export function TreeProvider({ children }: { children: ReactNode }) {
  const [savedTree, setSavedTree] = useState<Tree | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const saveTree = (tree: Tree) => {
    setSavedTree(tree)
    setSavedAt(Date.now())
  }

  return (
    <TreeStoreContext.Provider value={{ savedTree, savedAt, saveTree }}>
      {children}
    </TreeStoreContext.Provider>
  )
}

export function useTreeStore(): TreeStore {
  const ctx = useContext(TreeStoreContext)
  if (!ctx) throw new Error('useTreeStore must be used within a <TreeProvider>.')
  return ctx
}
