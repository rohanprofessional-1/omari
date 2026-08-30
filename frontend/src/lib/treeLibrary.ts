import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchTrees,
  fetchTree,
  createTreeFull,
  renameTree,
  deleteTree,
  activateTree,
  type TreeSummary,
} from './api'
import { sampleTree } from '../data/sampleTree'
import { dukeNerveTree } from '../data/dukeNerveTree'
import type { Tree } from '../types/tree'

/**
 * Tree library controller — the bridge between the Postgres-backed tree store
 * and the Runner's picker UI. Lists trees, remembers the active selection
 * (per browser, in localStorage), loads the active tree's full definition, and
 * exposes CRUD actions. The Runner falls back to the built-in sample tree when
 * the library is empty or unreachable, so it always has something to run.
 */

const ACTIVE_KEY = 'omari:activeTreeId'

function readStored(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export interface TreeLibrary {
  trees: TreeSummary[]
  activeId: string | null
  /** Full definition of the active tree; null → caller uses the built-in sample. */
  activeTree: Tree | null
  loadingList: boolean
  loadingTree: boolean
  error: string | null
  /** Bumped whenever the active tree changes — used to re-key the Runner session. */
  sessionNonce: number
  refresh: () => Promise<void>
  select: (id: string) => Promise<void>
  saveCurrent: (name: string, tree: Tree) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  importStarters: () => Promise<void>
  activate: (id: string) => Promise<void>
}

export function useTreeLibrary(): TreeLibrary {
  const [trees, setTrees] = useState<TreeSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(() => readStored())
  const [activeTree, setActiveTree] = useState<Tree | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingTree, setLoadingTree] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionNonce, setNonce] = useState(0)

  // Track the latest active id without re-creating callbacks on every change.
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  const persistActive = useCallback((id: string | null) => {
    activeIdRef.current = id
    setActiveId(id)
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id)
      else localStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* ignore unavailable storage */
    }
  }, [])

  const loadTree = useCallback(async (id: string) => {
    setLoadingTree(true)
    setError(null)
    try {
      const t = await fetchTree(id)
      setActiveTree(t)
      setNonce((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the selected tree.')
      setActiveTree(null)
    } finally {
      setLoadingTree(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoadingList(true)
    setError(null)
    try {
      const list = await fetchTrees()
      setTrees(list)
      const stored = readStored()
      const activeTree = list.find((t) => t.is_active)
      const storedTree = list.find((t) => t.id === stored)
      const pick = activeTree ?? storedTree ?? list[0]
      if (pick) {
        persistActive(pick.id)
        await loadTree(pick.id)
      } else {
        persistActive(null)
        setActiveTree(null)
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not reach the tree library — is the API running?',
      )
      setTrees([])
    } finally {
      setLoadingList(false)
    }
  }, [persistActive, loadTree])

  // Initial load.
  useEffect(() => {
    void refresh()
  }, [refresh])

  const select = useCallback(
    async (id: string) => {
      persistActive(id)
      await loadTree(id)
    },
    [persistActive, loadTree],
  )

  const saveCurrent = useCallback(
    async (name: string, tree: Tree) => {
      const created = await createTreeFull(name, tree)
      const list = await fetchTrees()
      setTrees(list)
      persistActive(created.id)
      await loadTree(created.id)
    },
    [persistActive, loadTree],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      await renameTree(id, name)
      const list = await fetchTrees()
      setTrees(list)
    },
    [],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteTree(id)
      if (id === activeIdRef.current) persistActive(null)
      await refresh()
    },
    [persistActive, refresh],
  )

  const importStarters = useCallback(async () => {
    await createTreeFull('Peripheral Nerve (sample)', sampleTree)
    await createTreeFull('Duke Nerve Center', dukeNerveTree)
    await refresh()
  }, [refresh])

  const activate = useCallback(
    async (id: string) => {
      await activateTree(id)
      persistActive(id)
      await refresh()
    },
    [persistActive, refresh],
  )

  return {
    trees,
    activeId,
    activeTree,
    loadingList,
    loadingTree,
    error,
    sessionNonce,
    refresh,
    select,
    saveCurrent,
    rename,
    remove,
    importStarters,
    activate,
  }
}
