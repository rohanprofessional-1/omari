import { useRef, useCallback, useEffect } from 'react';
import { useTreeStore } from '../store/useTreeStore';
import type { PortId, NodeType } from '../types';

interface DragState {
  nodeId: string;
  offsetX: number;
  offsetY: number;
}

/**
 * useCanvasInteraction
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all mouse interactions on the canvas:
 *  - Drag nodes to reposition them
 *  - Click output ports to start a connection
 *  - Click input ports to finish a connection
 *  - Click empty canvas to clear selection
 *  - Drop from sidebar palette to create new nodes
 */
export const useCanvasInteraction = (canvasRef: React.RefObject<HTMLDivElement>) => {
  const dragState = useRef<DragState | null>(null);
  const {
    moveNode, selectNode, addNode,
    pendingConnection, setPendingConnection, addEdge,
  } = useTreeStore();

  // ── Node drag ────────────────────────────────────────────────────────────

  const startNodeDrag = useCallback((nodeId: string, e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cr = canvas.getBoundingClientRect();
    const nodeEl = document.getElementById(nodeId);
    if (!nodeEl) return;
    const nr = nodeEl.getBoundingClientRect();
    dragState.current = {
      nodeId,
      offsetX: e.clientX - (nr.left - cr.left),
      offsetY: e.clientY - (nr.top  - cr.top),
    };
    selectNode(nodeId);
  }, [canvasRef, selectNode]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds || !canvasRef.current) return;
      const cr = canvasRef.current.getBoundingClientRect();
      moveNode(
        ds.nodeId,
        Math.max(0, e.clientX - cr.left - ds.offsetX),
        Math.max(0, e.clientY - cr.top  - ds.offsetY),
      );
    };
    const onMouseUp = () => { dragState.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [canvasRef, moveNode]);

  // ── Port interactions ────────────────────────────────────────────────────

  const handlePortMouseDown = useCallback((
    e: React.MouseEvent,
    nodeId: string,
    portId: PortId,
  ) => {
    e.stopPropagation();
    e.preventDefault();

    if (portId === 'in') {
      // Finish a pending connection
      if (pendingConnection && pendingConnection.nodeId !== nodeId) {
        addEdge(pendingConnection.nodeId, pendingConnection.port, nodeId, 'in');
        setPendingConnection(null);
      }
      return;
    }

    // Start a new connection from an output port
    setPendingConnection({ nodeId, port: portId });
  }, [pendingConnection, setPendingConnection, addEdge]);

  // ── Canvas click (clear selection / cancel connection) ────────────────────

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).classList.contains('edges-svg')) {
      selectNode(null);
      setPendingConnection(null);
    }
  }, [canvasRef, selectNode, setPendingConnection]);

  // ── Palette drop ─────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('nodeType') as NodeType;
    if (!type || !canvasRef.current) return;
    const cr = canvasRef.current.getBoundingClientRect();
    addNode(type, e.clientX - cr.left - 80, e.clientY - cr.top - 28);
  }, [canvasRef, addNode]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return {
    startNodeDrag,
    handlePortMouseDown,
    handleCanvasMouseDown,
    handleDrop,
    handleDragOver,
    isConnecting: pendingConnection !== null,
  };
};
