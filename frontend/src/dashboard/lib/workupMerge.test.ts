/**
 * Workup merge / stratification tests — the synthetic-visit-date demo policy,
 * the override merge with live at-risk recompute, and the Workup screen's
 * population + stratification + sort rules.
 *
 * Same self-asserting style as deriveTreeResult.test.ts: no framework,
 * registered in scripts/run-tests.mjs, run via `npm test`.
 */
import { DEMO_NOW, daysUntil, isAtRisk } from './demoClock'
import {
  SYNTHETIC_VISIT_DAYS,
  buildWorkupEntries,
  mergeWorkupItems,
  syntheticVisitDate,
} from './workupMerge'
import type {
  DashboardWorkupItem,
  ReviewState,
  ReviewableReferral,
  WorkupStatus,
} from '../types'

declare const process: { exitCode?: number } | undefined

const MS_PER_DAY = 86_400_000

function demoDay(offsetDays: number): string {
  return new Date(DEMO_NOW.getTime() + offsetDays * MS_PER_DAY).toISOString().slice(0, 10)
}

function item(
  name: string,
  status: WorkupStatus,
  dueOffsetDays: number,
): DashboardWorkupItem {
  const dueBy = demoDay(dueOffsetDays)
  return {
    name,
    source: 'always',
    status,
    responsible: 'clinic',
    dueBy,
    atRisk: isAtRisk({ status, dueBy }),
  }
}

function ref(
  id: string,
  opts: {
    urgency?: 'routine' | 'expedited' | 'urgent'
    visitDate?: string
    items: DashboardWorkupItem[]
  },
): ReviewableReferral {
  return {
    payload: { referralId: id, patient: { name: `Patient ${id}` } },
    extraction: { variables: {}, sources: {} },
    result: {
      urgency: opts.urgency ?? 'routine',
      visitDate: opts.visitDate,
      requiredWorkup: opts.items,
      routedTo: { specialistName: 'Dr. Test', specialty: 'nerve', nodeId: 'n1' },
      flags: {},
    },
  } as unknown as ReviewableReferral
}

function approved(id: string): ReviewState {
  return { referralId: id, status: 'approved' }
}

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'mergeWorkupItems: overrides win and at-risk recomputes (shared with WorkupList)',
    run: () => {
      const items = [item('EMG', 'needed', 3), item('X-ray', 'needed', 3)]
      if (!items[0].atRisk) return 'precondition: due in 3d + needed should be at risk'
      const merged = mergeWorkupItems(items, { EMG: 'resulted' })
      if (merged[0].status !== 'resulted') return `override lost: ${merged[0].status}`
      if (merged[0].atRisk) return 'resulted item should no longer be at risk'
      if (merged[1] !== items[1]) return 'untouched item should keep object identity'
      return null
    },
  },
  {
    name: 'synthetic visit date: deterministic per urgency; due dates clamp to the visit',
    run: () => {
      for (const urgency of ['routine', 'expedited', 'urgent'] as const) {
        const expected = demoDay(SYNTHETIC_VISIT_DAYS[urgency])
        if (syntheticVisitDate(urgency) !== expected) {
          return `${urgency}: got ${syntheticVisitDate(urgency)}, expected ${expected}`
        }
      }
      if (syntheticVisitDate(null) !== demoDay(10)) return 'null urgency should default to routine'
      // A live-approved urgent referral (no fixture visitDate, dueBy defaulted
      // to +14d by the derivation) must clamp dueBy to the projected +2d visit
      // and become at risk.
      const r = ref('R1', { urgency: 'urgent', items: [item('EMG', 'needed', 14)] })
      const strata = buildWorkupEntries([r], { R1: approved('R1') }, {})
      const entry = strata.atRisk[0]
      if (!entry) return 'urgent synthetic-visit referral should stratify as at risk'
      if (!entry.syntheticVisit) return 'entry should be marked syntheticVisit'
      if (entry.visitDate !== demoDay(2)) return `visit ${entry.visitDate}, expected ${demoDay(2)}`
      if (entry.items[0].dueBy !== demoDay(2)) {
        return `dueBy ${entry.items[0].dueBy} not clamped to visit ${demoDay(2)}`
      }
      if (!entry.items[0].atRisk) return 'clamped urgent item should be at risk'
      if (daysUntil(entry.visitDate) > SYNTHETIC_VISIT_DAYS.urgent) {
        return 'projected visit should be within the urgency window'
      }
      return null
    },
  },
  {
    name: 'stratification: population filter, at-risk/on-track/complete membership, soonest-visit sort',
    run: () => {
      const atRiskSoon = ref('A2', {
        visitDate: demoDay(4),
        items: [item('EMG', 'needed', 2)],
      })
      const atRiskLater = ref('A9', {
        visitDate: demoDay(9),
        items: [item('EMG', 'needed', 5), item('Labs', 'resulted', 5)],
      })
      const onTrack = ref('B1', {
        visitDate: demoDay(20),
        items: [item('EMG', 'ordered', 12)],
      })
      const complete = ref('C1', {
        visitDate: demoDay(6),
        items: [item('EMG', 'resulted', 2), item('Labs', 'reviewed', 2)],
      })
      const pending = ref('P1', { visitDate: demoDay(3), items: [item('EMG', 'needed', 1)] })
      const rejected = ref('X1', { visitDate: demoDay(3), items: [item('EMG', 'needed', 1)] })
      const noWorkup = ref('N1', { visitDate: demoDay(3), items: [] })

      const reviews: Record<string, ReviewState> = {
        A2: approved('A2'),
        A9: { referralId: 'A9', status: 'corrected' },
        B1: approved('B1'),
        C1: approved('C1'),
        P1: { referralId: 'P1', status: 'pending' },
        X1: { referralId: 'X1', status: 'rejected' },
        N1: approved('N1'),
      }
      const strata = buildWorkupEntries(
        [atRiskLater, atRiskSoon, onTrack, complete, pending, rejected, noWorkup],
        reviews,
        {},
      )
      const ids = (entries: { referral: ReviewableReferral }[]) =>
        entries.map((e) => e.referral.payload.referralId).join(',')
      if (ids(strata.atRisk) !== 'A2,A9') return `atRisk [${ids(strata.atRisk)}], expected A2,A9 (soonest visit first)`
      if (ids(strata.onTrack) !== 'B1') return `onTrack [${ids(strata.onTrack)}]`
      if (ids(strata.complete) !== 'C1') return `complete [${ids(strata.complete)}] — pending/rejected/no-workup must be excluded`
      if (strata.atRisk[1].outstanding !== 1) return `A9 outstanding ${strata.atRisk[1].outstanding}, expected 1`

      // Advancing A9's outstanding item via a store override drops it to complete.
      const after = buildWorkupEntries(
        [atRiskLater, atRiskSoon, onTrack, complete, pending, rejected, noWorkup],
        reviews,
        { A9: { EMG: 'reviewed' } },
      )
      if (ids(after.atRisk) !== 'A2') return `after override atRisk [${ids(after.atRisk)}], expected A2`
      if (ids(after.complete) !== 'C1,A9') return `after override complete [${ids(after.complete)}], expected C1,A9 (visit sort)`
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
  throw new Error(`${failures} workup merge test(s) failed`)
}
console.log(`dashboard/lib/workupMerge.test.ts — all ${checks.length} passed`)
