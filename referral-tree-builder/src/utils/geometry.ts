import type { PortId } from '../types';

export interface Point { x: number; y: number }
export interface Rect  { x: number; y: number; w: number; h: number }

/**
 * Given a node's bounding rect and a port id,
 * return the center point of that port in canvas-relative coordinates.
 */
export const getPortCenter = (rect: Rect, portId: PortId): Point => {
  const { x, y, w, h } = rect;
  switch (portId) {
    case 'in':                   return { x: x + w / 2, y };
    case 'out':                  return { x: x + w / 2, y: y + h };
    case 'yes': case 'pass': case 'tried': return { x: x + w,       y: y + h / 2 };
    case 'no':  case 'fail': case 'never': return { x,               y: y + h / 2 };
    default:                     return { x: x + w / 2, y: y + h };
  }
};

/**
 * Build a cubic bezier SVG path string between two points.
 * Curves vertically — good for top-down trees.
 */
export const buildEdgePath = (from: Point, to: Point): string => {
  const dy = Math.max(40, Math.abs(to.y - from.y) * 0.5);
  return `M${from.x},${from.y} C${from.x},${from.y + dy} ${to.x},${to.y - dy} ${to.x},${to.y}`;
};

/** Midpoint of two points, used for edge delete button placement */
export const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
