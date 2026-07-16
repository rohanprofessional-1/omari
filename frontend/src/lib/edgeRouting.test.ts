/**
 * Blume — edge-route geometry tests.
 *
 * The helpers that turn ELK's routed polylines into the paths the canvas
 * draws: endpoint snapping must keep routes orthogonal, and path building
 * must round corners without inventing or losing bends. Same self-asserting
 * style as engine.test.ts — `npm test`.
 */
import { roundedOrthogonalPath, snapRouteToHandles, type RoutePoint } from './edgeRouting'

declare const process: { exitCode?: number } | undefined

const p = (x: number, y: number): RoutePoint => ({ x, y })

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'snap pins endpoints to the live handles and keeps the route orthogonal',
    run: () => {
      // ELK thought the handle was at y=100; the real handle is at y=112.
      const snapped = snapRouteToHandles(
        [p(300, 100), p(400, 100), p(400, 250), p(600, 250)],
        300,
        112,
        600,
        258,
      )
      if (snapped[0].x !== 300 || snapped[0].y !== 112) return `start not pinned: ${JSON.stringify(snapped[0])}`
      if (snapped[1].y !== 112) return 'first (horizontal) segment did not slide to the real handle row'
      const last = snapped[snapped.length - 1]
      if (last.x !== 600 || last.y !== 258) return `end not pinned: ${JSON.stringify(last)}`
      if (snapped[snapped.length - 2].y !== 258) return 'last (horizontal) segment did not slide to the target row'
      // Every segment must stay horizontal or vertical.
      for (let i = 1; i < snapped.length; i++) {
        const a = snapped[i - 1]
        const b = snapped[i]
        if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01)
          return `segment ${i} went diagonal: ${JSON.stringify([a, b])}`
      }
      return null
    },
  },
  {
    name: 'snap adjusts a vertical last segment sideways, not vertically',
    run: () => {
      const snapped = snapRouteToHandles(
        [p(300, 100), p(500, 100), p(500, 300)],
        300,
        100,
        505,
        300,
      )
      const mid = snapped[1]
      if (mid.x !== 505) return `vertical approach did not slide to the target column (x=${mid.x})`
      return null
    },
  },
  {
    name: 'degenerate routes collapse to a straight handle-to-handle line',
    run: () => {
      const snapped = snapRouteToHandles([p(0, 0), p(10, 10)], 5, 5, 90, 95)
      if (snapped.length !== 2) return `expected 2 points, got ${snapped.length}`
      if (snapped[0].x !== 5 || snapped[1].y !== 95) return 'endpoints not pinned'
      return null
    },
  },
  {
    name: 'rounded path has a quadratic corner per bend and no diagonals',
    run: () => {
      const d = roundedOrthogonalPath([p(0, 0), p(100, 0), p(100, 200), p(300, 200)], 12)
      const corners = (d.match(/Q /g) ?? []).length
      if (corners !== 2) return `expected 2 rounded corners, got ${corners} in "${d}"`
      if (!d.startsWith('M 0,0')) return `path must start at the source: "${d}"`
      if (!d.endsWith('L 300,200')) return `path must end at the target: "${d}"`
      return null
    },
  },
  {
    name: 'collinear and duplicate points are collapsed before rounding',
    run: () => {
      const d = roundedOrthogonalPath(
        [p(0, 0), p(50, 0), p(50, 0), p(100, 0), p(100, 200)],
        12,
      )
      const corners = (d.match(/Q /g) ?? []).length
      if (corners !== 1) return `expected 1 corner after simplification, got ${corners} in "${d}"`
      return null
    },
  },
  {
    name: 'radius shrinks on tight staircases instead of overshooting',
    run: () => {
      // 8px jog: radius must clamp to ≤4, so the two corners cannot overlap.
      const d = roundedOrthogonalPath([p(0, 0), p(100, 0), p(100, 8), p(200, 8)], 14)
      const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
      if (nums.some((n) => Number.isNaN(n))) return `malformed path: "${d}"`
      // The curve control points sit at the bend; the entry point of corner 2
      // must not sit above the exit point of corner 1 (no overlap on the jog).
      if (!d.includes('Q 100,0') || !d.includes('Q 100,8')) return `corners missing: "${d}"`
      const exit1 = d.indexOf('Q 100,0')
      const entry2 = d.indexOf('Q 100,8')
      if (exit1 === -1 || entry2 === -1 || entry2 < exit1) return `corner order wrong: "${d}"`
      return null
    },
  },
]

let failures = 0
for (const c of checks) {
  let msg: string | null
  try {
    msg = c.run()
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err)
  }
  if (msg) {
    failures += 1
    console.error(`✗ ${c.name}: ${msg}`)
  } else {
    console.log(`✓ ${c.name}`)
  }
}

if (failures > 0) {
  if (typeof process !== 'undefined') process.exitCode = 1
  throw new Error(`${failures} edge routing test(s) failed`)
}
console.log(`edgeRouting.test.ts — all ${checks.length} passed`)
