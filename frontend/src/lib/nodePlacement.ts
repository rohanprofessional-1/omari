/**
 * Blume — deterministic placement for Sprout's confirmed layout moves.
 *
 * The model only ever names WHICH nodes and WHICH canvas edge; everything
 * geometric happens here, from the real per-node rectangles (position +
 * measured size) and the real edge list (derived from branch wiring). Edge
 * paths themselves are routed by React Flow as a function of their endpoint
 * nodes, so "untangled lines" is achieved by choosing node positions well:
 *
 *  1. CROSSING MINIMISATION — each moved card gets a desired coordinate at
 *     the barycenter (mean centre) of the nodes it is wired to, the classic
 *     one-layer ordering heuristic: cards land under/beside their wiring, so
 *     their edges run short and parallel instead of criss-crossing.
 *  2. OVERLAP ELIMINATION — a plane sweep along the row/column enforces a
 *     minimum gap between cards, then the whole run is shifted back by its
 *     mean displacement so it stays centred on the wiring rather than
 *     drifting to one side.
 *  3. CLEARANCE — the row/column is parked GAP beyond the bounding box of
 *     everything that isn't moving, so it can never sit on top of the graph.
 *
 * Pure and framework-free so it can be unit-tested like the engine modules.
 */

export interface PlacedRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface MovePlanInput {
  /** Current geometry of the cards being moved. */
  moved: PlacedRect[]
  /** Geometry of every other VISIBLE card — the graph to park beside. */
  rest: PlacedRect[]
  /** Wiring among all of the above (source → target node ids). */
  edges: { source: string; target: string }[]
  placement: 'top' | 'bottom' | 'left' | 'right'
  /** Clearance between the graph and the parked row/column. */
  gap?: number
  /** Minimum gap between parked cards. */
  spacing?: number
}

/** New top-left positions for the moved cards (empty when nothing anchors). */
export function planNodeMoves(input: MovePlanInput): Map<string, { x: number; y: number }> {
  const { moved, rest, edges, placement } = input
  const gap = input.gap ?? 140
  const spacing = input.spacing ?? 48
  const out = new Map<string, { x: number; y: number }>()
  if (moved.length === 0 || rest.length === 0) return out

  const minX = Math.min(...rest.map((r) => r.x))
  const maxX = Math.max(...rest.map((r) => r.x + r.w))
  const minY = Math.min(...rest.map((r) => r.y))
  const maxY = Math.max(...rest.map((r) => r.y + r.h))

  // Barycenter along the row axis of everything a card is wired to (either
  // direction), anchored on the non-moving graph. Falls back to the card's
  // current coordinate so unwired cards keep their relative order.
  const restById = new Map(rest.map((r) => [r.id, r]))
  const movedIds = new Set(moved.map((m) => m.id))
  const horizontal = placement === 'top' || placement === 'bottom'
  const axisCentre = (r: PlacedRect): number => (horizontal ? r.x + r.w / 2 : r.y + r.h / 2)
  const desiredCentre = (m: PlacedRect): number => {
    const anchors: number[] = []
    for (const e of edges) {
      const other =
        e.source === m.id && !movedIds.has(e.target)
          ? restById.get(e.target)
          : e.target === m.id && !movedIds.has(e.source)
            ? restById.get(e.source)
            : undefined
      if (other) anchors.push(axisCentre(other))
    }
    if (anchors.length === 0) return axisCentre(m)
    return anchors.reduce((s, v) => s + v, 0) / anchors.length
  }

  const size = (r: PlacedRect): number => (horizontal ? r.w : r.h)
  const plan = moved
    .map((m) => ({ m, want: desiredCentre(m) - size(m) / 2 }))
    .sort((a, b) => a.want - b.want || a.m.id.localeCompare(b.m.id))

  // Sweep to clear overlaps (can only push forward), then shift the whole run
  // back by its mean displacement so it stays centred on the wiring.
  let cursor = -Infinity
  const placed = plan.map((p) => {
    const at = Math.max(p.want, cursor)
    cursor = at + size(p.m) + spacing
    return { ...p, at }
  })
  const drift = placed.reduce((s, p) => s + (p.at - p.want), 0) / placed.length
  for (const p of placed) p.at -= drift

  for (const p of placed) {
    if (horizontal) {
      // Face the graph: bottom rows top-align just below it, top rows
      // bottom-align just above it — edges take the short way home.
      const y = placement === 'bottom' ? maxY + gap : minY - gap - p.m.h
      out.set(p.m.id, { x: p.at, y })
    } else {
      const x = placement === 'right' ? maxX + gap : minX - gap - p.m.w
      out.set(p.m.id, { x, y: p.at })
    }
  }
  return out
}
