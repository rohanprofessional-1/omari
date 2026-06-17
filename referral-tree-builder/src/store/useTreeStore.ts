import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  TreeStore, TreeNode, TreeEdge, TreeSchema,
  NodeType, PortId,
} from '../types'
import { getNodeDef } from '../nodes/registry'
import { generateId } from '../utils/ids'
import { DEFAULT_RED_FLAGS } from '../constants/redFlags'

export const useTreeStore = create<TreeStore>()(
  immer((set, get) => ({
    nodes: [],
    edges: [],
    redFlags: DEFAULT_RED_FLAGS,
    selectedNodeId: null,
    pendingConnection: null,

    addNode: (type: NodeType, x: number, y: number, overrides: Partial<TreeNode> = {}) => {
      const def = getNodeDef(type)
      const node: TreeNode = {
        id: generateId('n'),
        type,
        label: overrides.label ?? def.label,
        sub: overrides.sub ?? '',
        position: { x: Math.max(8, x), y: Math.max(8, y) },
        meta: { ...def.defaultMeta, ...(overrides.meta ?? {}) } as TreeNode['meta'],
      }
      set(state => { state.nodes.push(node) })
      return node
    },

    updateNode: (id, patch) => {
      set(state => {
        const node = state.nodes.find(n => n.id === id)
        if (!node) return
        if (patch.label !== undefined) node.label = patch.label
        if (patch.sub !== undefined) node.sub = patch.sub
        if (patch.meta !== undefined) node.meta = { ...node.meta, ...patch.meta } as TreeNode['meta']
      })
    },

    moveNode: (id, x, y) => {
      set(state => {
        const node = state.nodes.find(n => n.id === id)
        if (node) { node.position.x = x; node.position.y = y }
      })
    },

    deleteNode: (id) => {
      set(state => {
        state.nodes = state.nodes.filter(n => n.id !== id)
        state.edges = state.edges.filter(e => e.from !== id && e.to !== id)
        if (state.selectedNodeId === id) state.selectedNodeId = null
      })
    },

    addEdge: (from: string, fromPort: PortId, to: string, toPort: PortId) => {
      set(state => {
        const dup = state.edges.find(
          e => e.from === from && e.fromPort === fromPort && e.to === to
        )
        if (dup) return
        const edge: TreeEdge = { id: generateId('e'), from, fromPort, to, toPort }
        state.edges.push(edge)
      })
    },

    deleteEdge: (id) => {
      set(state => { state.edges = state.edges.filter(e => e.id !== id) })
    },

    toggleRedFlag: (id) => {
      set(state => {
        const flag = state.redFlags.find(f => f.id === id)
        if (flag) flag.active = !flag.active
      })
    },

    addRedFlag: (label) => {
      set(state => {
        state.redFlags.push({ id: generateId('rf'), label, active: true })
      })
    },

    selectNode: (id) => {
      set(state => { state.selectedNodeId = id })
    },

    setPendingConnection: (conn) => {
      set(state => { state.pendingConnection = conn })
    },

    clearAll: () => {
      set(state => {
        state.nodes = []
        state.edges = []
        state.selectedNodeId = null
        state.pendingConnection = null
        state.redFlags = DEFAULT_RED_FLAGS.map(f => ({ ...f }))
      })
    },

    loadSchema: (schema: TreeSchema) => {
      set(state => {
        state.nodes = schema.nodes
        state.edges = schema.edges
        state.redFlags = schema.safetyLayer.redFlags
        state.selectedNodeId = null
        state.pendingConnection = null
      })
    },

    exportSchema: (name = 'Untitled tree', specialty = '') => {
      const { nodes, edges, redFlags } = get()
      return {
        version: '1.1',
        createdAt: new Date().toISOString(),
        name,
        specialty,
        safetyLayer: { redFlags },
        nodes,
        edges,
      }
    },
  }))
)
