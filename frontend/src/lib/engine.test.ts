/**
 * Blume — deterministic engine tests.
 *
 * Hardcoded FilledVariables cases run against the seeded sample tree. No test
 * framework dependency: this file self-asserts and sets a non-zero exit code
 * on any failure. Run with `npm test`.
 */
import { runEngine, type RoutingResult } from './engine'
import { sampleTree } from '../data/sampleTree'
import type { FilledVariables } from '../types/tree'

// Minimal ambient so this runnable script typechecks without @types/node.
declare const process: { exitCode?: number } | undefined

/** Build a FilledVariables map; confidence defaults to 1 (engine ignores it). */
function filled(
  entries: Record<string, unknown>,
  confidence = 1,
): FilledVariables {
  const out: FilledVariables = {}
  for (const [key, value] of Object.entries(entries)) {
    out[key] = { value, confidence }
  }
  return out
}

interface Expectation {
  name: string
  filled: FilledVariables
  expect: (r: RoutingResult) => string | null // return null = pass, string = failure msg
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const cases: Expectation[] = [
  /* 1. Clean route to Dr. Chen (EMG abnormal upper limb). */
  {
    name: 'routes to Dr. Chen — abnormal EMG, arm/hand',
    filled: filled({
      presentationType: 'typical_nerve_symptoms',
      dominantSymptom: 'numbness_tingling',
      symptomLocation: 'arm_hand',
      emgStatus: 'done_abnormal',
    }),
    expect: (r) =>
      r.outcome === 'routed' && r.specialist?.specialistName === 'Dr. Chen'
        ? eq(r.pathTaken, [
            'node_presentation',
            'node_dominant_symptom',
            'node_location',
            'node_emg_upper',
            'node_spec_chen',
          ])
          ? null
          : `wrong path: ${r.pathTaken.join(' -> ')}`
        : `expected routed/Dr. Chen, got ${r.outcome}/${r.specialist?.specialistName}`,
  },

  /* 2. Clean route to Dr. Reyes (neck radiating, complex upper extremity). */
  {
    name: 'routes to Dr. Reyes — neck radiating',
    filled: filled({
      presentationType: 'typical_nerve_symptoms',
      dominantSymptom: 'mixed',
      symptomLocation: 'neck_radiating',
    }),
    expect: (r) =>
      r.outcome === 'routed' &&
      r.specialist?.specialistName === 'Dr. Reyes' &&
      r.specialist?.urgency === 'expedited'
        ? null
        : `expected routed/Dr. Reyes/expedited, got ${r.outcome}/${r.specialist?.specialistName}/${r.specialist?.urgency}`,
  },

  /* 3. Clean route to Dr. Okafor (lower limb, chronic). */
  {
    name: 'routes to Dr. Okafor — leg/foot, chronic',
    filled: filled({
      presentationType: 'typical_nerve_symptoms',
      dominantSymptom: 'weakness',
      symptomLocation: 'leg_foot',
      symptomDuration: 'chronic',
    }),
    expect: (r) =>
      r.outcome === 'routed' && r.specialist?.specialistName === 'Dr. Okafor'
        ? null
        : `expected routed/Dr. Okafor, got ${r.outcome}/${r.specialist?.specialistName}`,
  },

  /* 4. Clean route to Dr. Patel (normal EMG -> conservative-first). */
  {
    name: 'routes to Dr. Patel — normal EMG, arm/hand',
    filled: filled({
      presentationType: 'typical_nerve_symptoms',
      dominantSymptom: 'pain',
      symptomLocation: 'arm_hand',
      emgStatus: 'done_normal',
    }),
    expect: (r) =>
      r.outcome === 'routed' && r.specialist?.specialistName === 'Dr. Patel'
        ? null
        : `expected routed/Dr. Patel, got ${r.outcome}/${r.specialist?.specialistName}`,
  },

  /* 5. Clean route to Dr. Reyes URGENT via the acute-trauma red flag. */
  {
    name: 'routes to Dr. Reyes (URGENT) — acute trauma red flag',
    filled: filled({ presentationType: 'acute_trauma' }),
    expect: (r) =>
      r.outcome === 'routed' &&
      r.specialist?.id === 'node_spec_acute_trauma' &&
      r.specialist?.urgency === 'urgent'
        ? null
        : `expected routed/urgent acute-trauma node, got ${r.outcome}/${r.specialist?.id}/${r.specialist?.urgency}`,
  },

  /* 6. Incomplete — resumability: stops at the FIRST missing variable on path. */
  {
    name: 'incomplete — stops at missing emgStatus only',
    filled: filled({
      presentationType: 'typical_nerve_symptoms',
      dominantSymptom: 'numbness_tingling',
      symptomLocation: 'arm_hand',
      // emgStatus deliberately absent
    }),
    expect: (r) =>
      r.outcome === 'incomplete' &&
      eq(r.missingVariables, ['emgStatus']) &&
      r.pathTaken[r.pathTaken.length - 1] === 'node_emg_upper'
        ? null
        : `expected incomplete/[emgStatus] stopped at node_emg_upper, got ${r.outcome}/${JSON.stringify(
            r.missingVariables,
          )}/${r.pathTaken.join(' -> ')}`,
  },

  /* 6b. Incomplete at the very root (no variables at all). */
  {
    name: 'incomplete — empty input stops at root variable',
    filled: filled({}),
    expect: (r) =>
      r.outcome === 'incomplete' &&
      eq(r.missingVariables, ['presentationType']) &&
      eq(r.pathTaken, ['node_presentation'])
        ? null
        : `expected incomplete/[presentationType] at root, got ${r.outcome}/${JSON.stringify(
            r.missingVariables,
          )}`,
  },

  /* 7. Escalated — mass/lump red flag. */
  {
    name: 'escalated — mass/lump red flag',
    filled: filled({ presentationType: 'mass_lump' }),
    expect: (r) =>
      r.outcome === 'escalated' &&
      r.specialist === undefined &&
      eq(r.pathTaken, ['node_presentation', 'node_esc_mass']) &&
      !!r.escalationReason
        ? null
        : `expected escalated via node_esc_mass, got ${r.outcome}/${r.pathTaken.join(' -> ')}`,
  },

  /* 7b. Escalated — ambiguous acute lower-limb red flag deep in the tree. */
  {
    name: 'escalated — acute leg symptoms reach ambiguous escalation',
    filled: filled({
      presentationType: 'typical_nerve_symptoms',
      dominantSymptom: 'weakness',
      symptomLocation: 'leg_foot',
      symptomDuration: 'acute',
    }),
    expect: (r) =>
      r.outcome === 'escalated' &&
      r.pathTaken[r.pathTaken.length - 1] === 'node_esc_ambiguous'
        ? null
        : `expected escalated via node_esc_ambiguous, got ${r.outcome}/${r.pathTaken.join(' -> ')}`,
  },

  /* 8. No branch matches — an out-of-domain value escalates rather than hangs. */
  {
    name: 'escalated — no branch matches an unknown value',
    filled: filled({ presentationType: 'banana' }),
    expect: (r) =>
      r.outcome === 'escalated' &&
      r.specialist === undefined &&
      eq(r.pathTaken, ['node_presentation']) &&
      (r.escalationReason ?? '').includes('No branch matched')
        ? null
        : `expected escalated/no-branch-match at root, got ${r.outcome}/${r.escalationReason}`,
  },
]

let failures = 0
console.log(`\nRunning ${cases.length} deterministic engine cases:\n`)
for (const c of cases) {
  const result = runEngine(sampleTree, c.filled)
  const problem = c.expect(result)
  if (problem === null) {
    console.log(`  PASS  ${c.name}`)
  } else {
    failures++
    console.log(`  FAIL  ${c.name}\n        ${problem}`)
  }
}

console.log(
  `\n${cases.length - failures}/${cases.length} passed${
    failures ? `, ${failures} FAILED` : ' — all green'
  }.\n`,
)

if (failures > 0) {
  // Surface failure to the runner / CI.
  if (typeof process !== 'undefined') process.exitCode = 1
  throw new Error(`${failures} engine test(s) failed.`)
}
