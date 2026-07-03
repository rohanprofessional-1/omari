/**
 * Blume — resolveWorkup tests (schema v2 path-conditioned workup).
 *
 * Same self-asserting style as engine.test.ts: no framework, non-zero exit
 * code on failure. Run with `npm test`.
 */
import { resolveWorkup, runEngine } from './engine'
import { TreeSchema, WorkupSpecSchema, type FilledVariables, type WorkupSpec } from '../types/tree'
import { sampleTree } from '../data/sampleTree'

declare const process: { exitCode?: number } | undefined

function filled(entries: Record<string, unknown>, confidence = 1): FilledVariables {
  const out: FilledVariables = {}
  for (const [key, value] of Object.entries(entries)) {
    out[key] = { value, confidence }
  }
  return out
}

const SPEC: WorkupSpec = {
  always: [
    { name: 'EMG/NCS', protocol: 'Bilateral upper limbs', rationale: 'Localize the lesion' },
  ],
  conditional: [
    {
      when: { key: 'mass_present', op: 'equals', value: true },
      item: { name: 'MRI with contrast', protocol: 'Brachial plexus protocol', rationale: 'Characterize the mass' },
      reason: 'Without imaging the consult is wasted',
    },
    {
      when: { key: 'symptom_duration_months', op: 'range', min: 6 },
      item: { name: 'Ultrasound', protocol: 'Point of care', rationale: 'Chronic assessment' },
      reason: '',
    },
  ],
  doNotOrderUnless: [
    { item: 'MRI with contrast', requiredCondition: { key: 'has_pacemaker', op: 'equals', value: false } },
  ],
  escalateWorkupIf: { key: 'prior_surgery', op: 'equals', value: true },
}

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'always items ordered with empty variables',
    run: () => {
      const r = resolveWorkup(SPEC, filled({}))
      if (r.ordered.length !== 1 || r.ordered[0].name !== 'EMG/NCS') {
        return `expected only EMG/NCS, got ${JSON.stringify(r.ordered.map((o) => o.name))}`
      }
      return r.escalated ? 'unexpected escalation' : null
    },
  },
  {
    name: 'conditional fires only when its condition holds',
    run: () => {
      const off = resolveWorkup(SPEC, filled({ mass_present: false, has_pacemaker: false }))
      if (off.ordered.some((o) => o.name === 'MRI with contrast'))
        return 'MRI ordered though mass_present=false'
      const on = resolveWorkup(SPEC, filled({ mass_present: true, has_pacemaker: false }))
      const mri = on.ordered.find((o) => o.name === 'MRI with contrast')
      if (!mri) return 'MRI missing though mass_present=true'
      if (mri.source !== 'conditional' || !mri.reason) return 'MRI lost its provenance/reason'
      return null
    },
  },
  {
    name: 'range conditional respects numeric bounds',
    run: () => {
      const short = resolveWorkup(SPEC, filled({ symptom_duration_months: 2 }))
      if (short.ordered.some((o) => o.name === 'Ultrasound')) return 'Ultrasound at 2 months'
      const long = resolveWorkup(SPEC, filled({ symptom_duration_months: 9 }))
      if (!long.ordered.some((o) => o.name === 'Ultrasound')) return 'no Ultrasound at 9 months'
      return null
    },
  },
  {
    name: 'do-not-order guard withholds when required condition unmet (over-ordering protection)',
    run: () => {
      // Pacemaker present → guard's required condition (has_pacemaker=false) fails.
      const r = resolveWorkup(SPEC, filled({ mass_present: true, has_pacemaker: true }))
      if (r.ordered.some((o) => o.name === 'MRI with contrast')) return 'MRI ordered with a pacemaker'
      if (r.withheld.length !== 1 || r.withheld[0].item !== 'MRI with contrast')
        return `expected MRI withheld, got ${JSON.stringify(r.withheld)}`
      return null
    },
  },
  {
    name: 'guard withholds when its variable is UNKNOWN (conservative default)',
    run: () => {
      const r = resolveWorkup(SPEC, filled({ mass_present: true }))
      if (r.ordered.some((o) => o.name === 'MRI with contrast'))
        return 'MRI ordered though pacemaker status unknown'
      return r.withheld.length === 1 ? null : 'expected exactly one withheld item'
    },
  },
  {
    name: 'escalateWorkupIf fires and reports a reason',
    run: () => {
      const r = resolveWorkup(SPEC, filled({ prior_surgery: true }))
      if (!r.escalated || !r.escalationReason) return 'expected workup escalation'
      const calm = resolveWorkup(SPEC, filled({ prior_surgery: false }))
      return calm.escalated ? 'escalated without cause' : null
    },
  },
  {
    name: 'legacy flat workup arrays normalize through WorkupSpecSchema',
    run: () => {
      const spec = WorkupSpecSchema.parse([
        { name: 'X-ray', protocol: 'PA view', rationale: 'Baseline' },
      ])
      if (spec.always.length !== 1 || spec.conditional.length !== 0) {
        return `bad normalization: ${JSON.stringify(spec)}`
      }
      return null
    },
  },
  {
    name: 'sampleTree still parses and runEngine returns resolvedWorkup on route',
    run: () => {
      const tree = TreeSchema.parse(sampleTree)
      const r = runEngine(tree, filled({
        presentationType: 'typical_nerve_symptoms',
        dominantSymptom: 'numbness_tingling',
        symptomLocation: 'arm_hand',
        emgStatus: 'done_abnormal',
      }))
      if (r.outcome !== 'routed') return `expected routed, got ${r.outcome}`
      if (!r.resolvedWorkup || r.resolvedWorkup.ordered.length === 0)
        return 'routed result missing resolvedWorkup'
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
  throw new Error(`${failures} workup test(s) failed`)
}
console.log(`workup.test.ts — all ${checks.length} passed`)
