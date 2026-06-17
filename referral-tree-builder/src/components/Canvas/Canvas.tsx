import React, { useRef, useCallback, useEffect } from 'react'
import { useTreeStore } from '../../store/useTreeStore'
import { CanvasNode } from './CanvasNode'
import { EdgeLayer } from './EdgeLayer'
import { useCanvasInteraction } from '../../hooks/useCanvasInteraction'
import type { PortId } from '../../types'
import type { Rect } from '../../utils/geometry'
import styles from './Canvas.module.css'

/**
 * Canvas
 * ─────────────────────────────────────────────────────────────────────────────
 * The main interactive surface. Renders:
 *   - EdgeLayer (SVG bezier curves)
 *   - CanvasNode instances (absolutely positioned divs)
 *
 * All interaction logic lives in useCanvasInteraction.
 * This component is purely about layout + wiring state → UI.
 */
export function Canvas() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const {
    nodes, edges, selectedNodeId, deleteEdge, selectNode, updateNode,
  } = useTreeStore()

  const {
    startNodeDrag,
    handlePortMouseDown,
    handleCanvasMouseDown,
    handleDrop,
    handleDragOver,
    isConnecting,
  } = useCanvasInteraction(canvasRef)

  // Cancel pending connection on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useTreeStore.getState().setPendingConnection(null)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = useTreeStore.getState().selectedNodeId
        if (sel && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          useTreeStore.getState().deleteNode(sel)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Get a node's bounding rect relative to the canvas — used by EdgeLayer
  const getNodeRect = useCallback((id: string): Rect | null => {
    if (!canvasRef.current) return null
    const nodeEl = document.getElementById(id)
    if (!nodeEl) return null
    const cr = canvasRef.current.getBoundingClientRect()
    const nr = nodeEl.getBoundingClientRect()
    return {
      x: nr.left - cr.left,
      y: nr.top  - cr.top,
      w: nr.width,
      h: nr.height,
    }
  }, [])

  return (
    <div
      ref={canvasRef}
      className={`${styles.canvas} ${isConnecting ? styles.connecting : ''}`}
      onMouseDown={handleCanvasMouseDown}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Edge SVG layer — rendered below nodes */}
      <EdgeLayer
        edges={edges}
        selectedEdgeId={null}
        onDeleteEdge={deleteEdge}
        getNodeRect={getNodeRect}
      />

      {/* Nodes */}
      {nodes.map(node => (
        <CanvasNode
          key={node.id}
          node={node}
          isSelected={node.id === selectedNodeId}
          isConnecting={isConnecting}
          onMouseDown={e => {
            if ((e.target as HTMLElement).classList.contains('port')) return
            e.preventDefault()
            startNodeDrag(node.id, e)
          }}
          onPortMouseDown={(e, portId: PortId) => handlePortMouseDown(e, node.id, portId)}
        />
      ))}

      {nodes.length === 0 && (
        <div className={styles.emptyHint}>
          Drag a node from the sidebar to get started
        </div>
      )}
    </div>
  )
}
