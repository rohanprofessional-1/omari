/**
 * Blume — placement planner tests.
 *
 * The geometry behind Sprout's layout moves: parked cards must clear the
 * graph, never overlap each other, and sit ordered by their wiring so edges
 * don't cross. Same self-asserting style as engine.test.ts — `npm test`.
 */
import { planNodeMoves, type PlacedRect } from './nodePlacement'

declare const process: { exitCode?: number } | undefined

const rect = (id: string, x: number, y: number, w = 300, h = 140): PlacedRect => ({ id, x, y, w, h })

// A two-column graph: variables at the top, one anchor on each side.
const restTwoAnchors: PlacedRect[] = [
  rect('var_left', 0, 0),
  rect('var_right', 900, 0),
  rect('spec_mid', 450, 300),
]

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'bottom row clears the graph and never overlaps it',
    run: () => {
      const moved = [rect('esc_a', 100, 100), rect('esc_b', 120, 150)]
      const pos = planNodeMoves({
        moved,
        rest: restTwoAnchors,
        edges: [
          { source: 'var_left', target: 'esc_a' },
          { source: 'var_right', target: 'esc_b' },
        ],
        placement: 'bottom',
      })
      if (pos.size !== 2) return `expected 2 positions, got ${pos.size}`
      const maxY = Math.max(...restTwoAnchors.map((r) => r.y + r.h))
      for (const m of moved) {
        const p = pos.get(m.id)!
        if (p.y < maxY + 140) return `${m.id} not below the graph (y=${p.y})`
        const placed = { ...m, ...p }
        for (const r of restTwoAnchors) if (overlaps(placed, r)) return `${m.id} overlaps ${r.id}`
      }
      return null
    },
  },
  {
    name: 'barycenter ordering follows the wiring, not the current positions',
    run: () => {
      // esc_a currently sits LEFT of esc_b, but is wired to the RIGHT anchor —
      // minimising crossings means they must swap in the parked row.
      const moved = [rect('esc_a', 0, 100), rect('esc_b', 400, 100)]
      const pos = planNodeMoves({
        moved,
        rest: restTwoAnchors,
        edges: [
          { source: 'var_right', target: 'esc_a' },
          { source: 'var_left', target: 'esc_b' },
        ],
        placement: 'bottom',
      })
      const a = pos.get('esc_a')!
      const b = pos.get('esc_b')!
      if (!(a.x > b.x)) return `expected esc_a right of esc_b (a.x=${a.x}, b.x=${b.x})`
      return null
    },
  },
  {
    name: 'crowded desired spots are swept apart without overlap',
    run: () => {
      // All three wired to the SAME anchor: identical barycenters must still
      // produce a non-overlapping row (deterministic id tiebreak).
      const moved = [rect('e1', 0, 0), rect('e2', 0, 0), rect('e3', 0, 0)]
      const pos = planNodeMoves({
        moved,
        rest: [rect('var_mid', 450, 0)],
        edges: moved.map((m) => ({ source: 'var_mid', target: m.id })),
        placement: 'bottom',
      })
      const placed = moved.map((m) => ({ ...m, ...pos.get(m.id)! }))
      for (let i = 0; i < placed.length; i++)
        for (let j = i + 1; j < placed.length; j++)
          if (overlaps(placed[i], placed[j])) return `${placed[i].id} overlaps ${placed[j].id}`
      // The run should stay centred on the shared anchor, not drift rightward.
      const centres = placed.map((p) => p.x + p.w / 2)
      const mid = centres.reduce((s, c) => s + c, 0) / centres.length
      if (Math.abs(mid - 600) > 1) return `row drifted off its wiring (mean centre ${mid}, anchor 600)`
      return null
    },
  },
  {
    name: 'left placement builds a column ordered by the wiring rows',
    run: () => {
      const rest = [rect('var_top', 500, 0), rect('var_bottom', 500, 600)]
      const moved = [rect('e_top', 900, 700), rect('e_bottom', 900, 50)]
      const pos = planNodeMoves({
        moved,
        rest,
        edges: [
          { source: 'var_top', target: 'e_top' },
          { source: 'var_bottom', target: 'e_bottom' },
        ],
        placement: 'left',
      })
      const top = pos.get('e_top')!
      const bottom = pos.get('e_bottom')!
      if (!(top.y < bottom.y)) return `column ignores wiring (e_top.y=${top.y}, e_bottom.y=${bottom.y})`
      const minX = Math.min(...rest.map((r) => r.x))
      if (top.x + 300 > minX) return `column not clear of the graph (x=${top.x})`
      return null
    },
  },
  {
    name: 'no anchors → empty plan (caller keeps positions)',
    run: () => {
      const pos = planNodeMoves({ moved: [rect('a', 0, 0)], rest: [], edges: [], placement: 'bottom' })
      if (pos.size !== 0) return 'planned a move with nothing to anchor against'
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
  throw new Error(`${failures} node placement test(s) failed`)
}
console.log(`nodePlacement.test.ts — all ${checks.length} passed`)
