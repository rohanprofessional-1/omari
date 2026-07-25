/**
 * Escalation-reason split tests — the surgeon brief leads each card with the
 * tree's directive, so the split has to be right on the reasons the shipped
 * tree actually carries, and has to keep its hands off anything that isn't a
 * directive (engine-generated malformed-tree messages, prose with a colon).
 *
 * Same self-asserting style as the other dashboard lib tests.
 */
import { splitEscalationReason } from './escalationReason'

declare const process: { exitCode?: number } | undefined

const checks: { name: string; run: () => string | null }[] = [
  {
    name: 'lifts a directive with a lowercase unit in its qualifier',
    run: () => {
      const { directive, detail } = splitEscalationReason(
        'URGENT FAST-TRACK (<72h): acute traumatic nerve injury — laceration/avulsion. Route immediately.',
      )
      if (directive !== 'URGENT FAST-TRACK (<72h)') return `directive ${directive}`
      if (!detail.startsWith('Acute traumatic nerve injury')) return `detail ${detail}`
      return null
    },
  },
  {
    name: 'lifts a bare one-word directive',
    run: () => {
      const { directive, detail } = splitEscalationReason(
        'EXPEDITED: a rapidly growing mass along a nerve may be a nerve-sheath tumour.',
      )
      if (directive !== 'EXPEDITED') return `directive ${directive}`
      if (!detail.startsWith('A rapidly growing')) return `detail ${detail}`
      return null
    },
  },
  {
    name: 'keeps sentence-case heads whole — not every colon is a label',
    run: () => {
      const text = 'Coordinator asked for records: the referring office has not replied.'
      const { directive, detail } = splitEscalationReason(text)
      if (directive !== undefined) return `invented directive ${directive}`
      if (detail !== text) return 'detail was altered'
      return null
    },
  },
  {
    name: 'leaves engine messages with no colon alone',
    run: () => {
      const text = 'No branch matched value "unsure" at node q_onset.'
      const { directive, detail } = splitEscalationReason(text)
      if (directive !== undefined) return `invented directive ${directive}`
      if (detail !== text) return 'detail was altered'
      return null
    },
  },
  {
    name: 'refuses a directive that runs on past label length',
    run: () => {
      const text =
        'THIS IS A VERY LONG SHOUTED SENTENCE THAT KEEPS GOING WELL PAST ANY REASONABLE LABEL: body.'
      if (splitEscalationReason(text).directive !== undefined) return 'accepted a sentence'
      return null
    },
  },
  {
    name: 'a directive with nothing after it stays whole',
    run: () => {
      const { directive, detail } = splitEscalationReason('EMERGENCY:')
      if (directive !== undefined) return `directive ${directive}`
      if (detail !== 'EMERGENCY:') return `detail ${detail}`
      return null
    },
  },
  {
    name: 'undefined and empty reasons are total, not thrown',
    run: () => {
      if (splitEscalationReason(undefined).detail !== '') return 'undefined not handled'
      if (splitEscalationReason('   ').detail !== '') return 'blank not handled'
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

if (failures > 0 && typeof process !== 'undefined') process.exitCode = 1
console.log(
  failures > 0
    ? `dashboard/lib/escalationReason.test.ts — ${failures} FAILED of ${checks.length}`
    : `dashboard/lib/escalationReason.test.ts — all ${checks.length} passed`,
)
