/**
 * Blume — edge-route geometry helpers.
 *
 * ELK's layered algorithm doesn't just position nodes: with ORTHOGONAL edge
 * routing it also computes a full route for every edge — node-avoiding,
 * crossing-minimised, and spaced into parallel lanes so wires never sit on
 * top of each other. The Builder captures those routes and renders them
 * directly; these helpers do the two purely geometric steps:
 *
 *  - `snapRouteToHandles` pins a route's endpoints to the REAL React Flow
 *    handle coordinates (ELK worked from estimated port positions), bending
 *    the adjacent point so the route stays orthogonal.
 *  - `roundedOrthogonalPath` turns the polyline into an SVG path with soft
 *    quadratic corners, collapsing duplicate/collinear points on the way.
 *
 * Pure and dependency-free so they can be unit-tested like the engine.
 */

export interface RoutePoint {
  x: number
  y: number
}

/** Drop consecutive duplicates and interior collinear points. */
function simplify(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = []
  for (const p of points) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5) continue
    out.push(p)
    // Collapse A→B→C when B sits on the straight line A→C (orthogonal runs).
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3)
      const colinear =
        (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
        (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)
      if (!colinear) break
      out.splice(out.length - 2, 1)
    }
  }
  return out
}

/**
 * Pin an ELK route to the actual source/target handle coordinates. The first
 * and last segments keep their orientation: a horizontal first segment slides
 * vertically to the true handle row (and vice versa), so the route stays
 * orthogonal instead of kinking diagonally at the card edge.
 */
export function snapRouteToHandles(
  points: RoutePoint[],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): RoutePoint[] {
  if (points.length < 3) return [{ x: sx, y: sy }, { x: tx, y: ty }]
  const pts = points.map((p) => ({ ...p }))
  const firstHorizontal = Math.abs(pts[1].y - pts[0].y) <= Math.abs(pts[1].x - pts[0].x)
  if (firstHorizontal) pts[1].y = sy
  else pts[1].x = sx
  pts[0] = { x: sx, y: sy }
  const n = pts.length
  const lastHorizontal = Math.abs(pts[n - 1].y - pts[n - 2].y) <= Math.abs(pts[n - 1].x - pts[n - 2].x)
  if (lastHorizontal) pts[n - 2].y = ty
  else pts[n - 2].x = tx
  pts[n - 1] = { x: tx, y: ty }
  return pts
}

/**
 * SVG path through the polyline with rounded corners. Radius shrinks on short
 * segments (never more than half a segment) so tight staircases stay clean.
 */
export function roundedOrthogonalPath(points: RoutePoint[], radius = 12): string {
  const pts = simplify(points)
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r < 0.75) {
      d += ` L ${cur.x},${cur.y}`
      continue
    }
    const inU = { x: (cur.x - prev.x) / inLen, y: (cur.y - prev.y) / inLen }
    const outU = { x: (next.x - cur.x) / outLen, y: (next.y - cur.y) / outLen }
    d += ` L ${cur.x - inU.x * r},${cur.y - inU.y * r}`
    d += ` Q ${cur.x},${cur.y} ${cur.x + outU.x * r},${cur.y + outU.y * r}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x},${last.y}`
  return d
}
