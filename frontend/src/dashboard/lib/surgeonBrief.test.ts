/**
 * Surgeon-brief selector tests — the since-last-visit counter and the three
 * exception-section membership rules.
 *
 * Same self-asserting style as deriveTreeResult.test.ts. The runner registry
 * lives outside src/dashboard, so this module is side-effect-imported from
 * deriveTreeResult.test.ts (which IS registered) instead of being listed
 * itself. It must not throw — a throw would skip the importer's checks — so
 * failures only set process.exitCode.
 */
import { summarizeHandled, surgeonSections } from './surgeonBrief'
import type { AuditEvent, ReviewState, ReviewableReferral, Role } from '../types'

declare const process: { exitCode?: number } | undefined

/* ── Minimal builders ─────────────────────────────────────────────────────── */

let eventSeq = 0
function evt(overrides: Partial<AuditEvent> & { referralId: string }): AuditEvent {
  eventSeq += 1
  return {
    id: `t-${eventSeq}`,
    at: `2026-07-24T10:${String(eventSeq).padStart(2, '0')}:00.000Z`,
    actor: 'M. Okafor (coordinator)',
    role: 'coordinator' as Role,
    action: 'approved',
    ...overrides,
  }
}

function ref(
  id: string,
  opts: { escalated?: boolean; confidence?: 'high' | 'medium' | 'low' } = {},
): ReviewableReferral {
  return {
    payload: { referralId: id },
    extraction: { variables: {}, sources: {} },
    result: {
      escalated: opts.escalated ?? false,
      confidence: opts.confidence ?? 'high',
      flags: {},
    },
  } as unknown as ReviewableReferral
}

function review(referralId: string, partial: Partial<ReviewState>): ReviewState {
  return { referralId, status: 'pending', ...partial }
}

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'summarizeHandled: null since counts every non-surgeon decision once',
    run: () => {
      const audit = [
        evt({ referralId: 'A', action: 'approved' }),
        evt({ referralId: 'B', action: 'corrected' }),
        evt({ referralId: 'C', action: 'rejected' }),
        evt({ referralId: 'D', action: 'info_requested' }), // not a decision
        evt({ referralId: 'E', action: 'approved', role: 'surgeon', actor: 'Dr. N. Li' }),
      ]
      const s = summarizeHandled(audit, null)
      if (s.total !== 3) return `total ${s.total}, expected 3 (surgeon + info_requested excluded)`
      if (s.approved !== 1) return `approved ${s.approved}`
      if (s.corrected !== 1) return `corrected ${s.corrected}`
      return null
    },
  },
  {
    name: 'summarizeHandled: a referral counts once, by its LATEST decision',
    run: () => {
      const audit = [
        evt({ referralId: 'A', action: 'approved', at: '2026-07-24T10:00:00.000Z' }),
        evt({ referralId: 'A', action: 'pending', at: '2026-07-24T10:05:00.000Z' }), // reopen
        evt({ referralId: 'A', action: 'corrected', at: '2026-07-24T10:10:00.000Z' }),
      ]
      const s = summarizeHandled(audit, null)
      if (s.total !== 1) return `total ${s.total}, expected 1`
      if (s.corrected !== 1 || s.approved !== 0) {
        return `expected the reopened referral to count as corrected, got ${JSON.stringify(s)}`
      }
      return null
    },
  },
  {
    name: 'summarizeHandled: events at or before the last visit are excluded',
    run: () => {
      const audit = [
        evt({ referralId: 'A', action: 'approved', at: '2026-07-24T09:00:00.000Z' }),
        evt({ referralId: 'B', action: 'approved', at: '2026-07-24T10:00:00.000Z' }),
        evt({ referralId: 'C', action: 'approved', at: '2026-07-24T11:00:00.000Z' }),
      ]
      const s = summarizeHandled(audit, '2026-07-24T10:00:00.000Z')
      if (s.total !== 1) return `total ${s.total}, expected only the 11:00 event to count`
      return null
    },
  },
  {
    name: 'sections: tree escalation (pending) and coordinator escalation both land in escalated',
    run: () => {
      const treeEsc = ref('T', { escalated: true, confidence: 'low' })
      const coordEsc = ref('C', { confidence: 'high' })
      const audit = [
        evt({ referralId: 'C', action: 'escalated', note: 'Is this really peripheral?' }),
      ]
      const reviews = { C: review('C', { status: 'escalated' }) }
      const s = surgeonSections([treeEsc, coordEsc], reviews, audit)
      if (s.escalated.length !== 2) return `escalated ${s.escalated.length}, expected 2`
      const coord = s.escalated.find((e) => e.referral.payload.referralId === 'C')
      if (coord?.coordinatorNote !== 'Is this really peripheral?') {
        return `coordinator note not surfaced: ${coord?.coordinatorNote}`
      }
      // The tree-escalated referral must NOT also appear in low confidence.
      if (s.lowConfidence.length !== 0) return 'escalated referral leaked into low confidence'
      return null
    },
  },
  {
    name: 'sections: escalated rows leave on approve; low-confidence needs pending status',
    run: () => {
      const wasEsc = ref('T', { escalated: true })
      const lowPending = ref('L', { confidence: 'medium' })
      const lowRequested = ref('R', { confidence: 'low' })
      const highPending = ref('H', { confidence: 'high' })
      const reviews = {
        T: review('T', { status: 'approved', reviewer: 'Dr. N. Li' }),
        R: review('R', { status: 'info_requested' }),
      }
      const s = surgeonSections([wasEsc, lowPending, lowRequested, highPending], reviews, [])
      if (s.escalated.length !== 0) return 'approved escalation still shown'
      if (s.lowConfidence.length !== 1 || s.lowConfidence[0].referral.payload.referralId !== 'L') {
        return `low confidence should hold exactly L, got ${s.lowConfidence.map((e) => e.referral.payload.referralId).join(',')}`
      }
      return null
    },
  },
  {
    name: 'sections: coordinator corrections show until endorsed; surgeon corrections never do',
    run: () => {
      const coord = ref('C')
      const seen = ref('S')
      const bySurgeon = ref('G')
      const correction = { field: 'destination' as const, from: 'Dr. A', to: 'Dr. B', reason: 'Proximal signs' }
      const reviews = {
        C: review('C', { status: 'corrected', reviewer: 'M. Okafor (coordinator)', correction }),
        S: review('S', { status: 'corrected', correction, surgeonSeen: true }),
        G: review('G', { status: 'corrected', reviewer: 'Dr. N. Li', correction }),
      }
      const audit = [
        evt({ referralId: 'C', action: 'corrected', correction }),
        evt({ referralId: 'S', action: 'corrected', correction }),
        evt({ referralId: 'G', action: 'corrected', correction, role: 'surgeon', actor: 'Dr. N. Li' }),
      ]
      const s = surgeonSections([coord, seen, bySurgeon], reviews, audit)
      if (s.corrected.length !== 1) {
        return `corrected ${s.corrected.map((e) => e.referral.payload.referralId).join(',')}, expected only C`
      }
      const entry = s.corrected[0]
      if (entry.referral.payload.referralId !== 'C') return `wrong referral ${entry.referral.payload.referralId}`
      if (entry.correction.reason !== 'Proximal signs') return 'correction not carried through'
      if (!entry.reviewer.includes('Okafor')) return `reviewer ${entry.reviewer}`
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
    ? `dashboard/lib/surgeonBrief.test.ts — ${failures} FAILED of ${checks.length}`
    : `dashboard/lib/surgeonBrief.test.ts — all ${checks.length} passed`,
)
