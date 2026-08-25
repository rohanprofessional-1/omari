import { useSyncExternalStore } from 'react'
import { fetchTrees, fetchTree } from '../../lib/api'
import { fetchTreeBase, listDeltas } from '../../lib/deltas/api'
import { compile } from '../../lib/deltas/compile'
import { describeDelta } from '../../lib/deltas/describe'
import type { Tree } from '../../types/tree'
import type { Delta } from '../../lib/deltas/schema'

export interface OverrideInfo {
  author: string
  rationale: string
  cpgBasis?: string
  opSummary: string
}

export interface ActiveTreeState {
  status: 'loading' | 'ready' | 'error'
  tree: Tree | null
  overrideNodeIds: Set<string>
  overrideInfoByNode: Map<string, OverrideInfo>
  error: string | null
}

let state: ActiveTreeState = {
  status: 'loading',
  tree: null,
  overrideNodeIds: new Set(),
  overrideInfoByNode: new Map(),
  error: null,
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** 
 * Module-level trigger to load the active tree. Safe to call multiple times; 
 * it only initiates one fetch sequence.
 */
let fetchPromise: Promise<void> | null = null

export function loadActiveTree(): Promise<void> {
  if (fetchPromise) return fetchPromise

  fetchPromise = (async () => {
    try {
      // 1. Find the active tree
      const trees = await fetchTrees({ is_active: true })
      const activeSummary = trees[0] // just pick the first active one
      
      if (!activeSummary) {
        state = { ...state, status: 'error', error: 'No active tree found.' }
        emit()
        return
      }

      // 2. Fetch the compiled tree and deltas
      const [fullTree, deltas] = await Promise.all([
        fetchTree(activeSummary.id),
        listDeltas(activeSummary.id),
      ])

      // 3. We need the base tree to accurately recompile and find which node IDs were overridden
      const baseResponse = await fetchTreeBase(activeSummary.id)
      
      let overrideNodeIds = new Set<string>()
      const overrideInfoByNode = new Map<string, OverrideInfo>()

      if (baseResponse.baseTree) {
        // Recompile to get the delta results against the base tree
        const compiled = compile(baseResponse.baseTree as Tree, deltas)
        
        overrideNodeIds = new Set(
          compiled.results.flatMap((result) => {
            const delta = deltas.find((d) => d.id === result.deltaId)
            return delta?.provenance.deviatesFromCpg ? result.nodeIds : []
          })
        )

        compiled.results.forEach((result) => {
          const delta = deltas.find((d) => d.id === result.deltaId)
          if (delta?.provenance.deviatesFromCpg) {
            const info: OverrideInfo = {
              author: String(delta.provenance.author || 'Unknown'),
              rationale: String(delta.provenance.rationale || ''),
              cpgBasis: delta.provenance.cpgBasis ? String(delta.provenance.cpgBasis) : undefined,
              opSummary: describeDelta(delta).split(' — DEVIATES FROM CPG')[0],
            }
            result.nodeIds.forEach(nodeId => overrideInfoByNode.set(nodeId, info))
          }
        })
      }

      state = {
        status: 'ready',
        tree: fullTree,
        overrideNodeIds,
        overrideInfoByNode,
        error: null,
      }
    } catch (err) {
      state = { ...state, status: 'error', error: String(err) }
    } finally {
      emit()
    }
  })()
  
  return fetchPromise
}

/** Non-React accessor for the adapter and deriveTreeResult. */
export function getActiveTreeState(): ActiveTreeState {
  return state
}

/** React hook for UI components to read the tree state. */
export function useActiveTree(): ActiveTreeState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      if (state.status === 'loading' && !fetchPromise) {
        loadActiveTree()
      }
      return () => listeners.delete(listener)
    },
    () => state,
  )
}
