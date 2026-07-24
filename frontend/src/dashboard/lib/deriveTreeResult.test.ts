/**
 * Dashboard foundation tests.
 *
 * Pins the truth of the whole no-UI layer: the clinic deltas compile onto the
 * Duke base, every seed fixture replays through the real engine to its
 * intended archetype, and the queue grouping / confidence rules hold.
 *
 * Same self-asserting style as lib/deltas/deltas.test.ts: no framework,
 * registered in scripts/run-tests.mjs, run via `npm test`.
 */
// Side-effect import: surgeon-brief selector checks run alongside this file
// (the test registry lives outside src/dashboard, so it can't be listed there).
import { confidenceBand } from '../../lib/orchestrator'
import { DASHBOARD_DELTAS, DASHBOARD_TREE, OVERRIDE_NODE_IDS } from '../data/dashboardDeltas'
import { REFERRAL_FIXTURES } from '../data/fixtures/referrals'
import { deriveTreeResult } from './deriveTreeResult'
import { queueGroupFor } from './queueStatus'
import type { ReferralFixture } from '../types'

declare const process: { exitCode?: number } | undefined

const byId = (id: string): ReferralFixture => {
  const f = REFERRAL_FIXTURES.find((x) => x.payload.referralId === id)
  if (!f) throw new Error(`fixture ${id} not found`)
  return f
}

/** Minimal fixture factory for crafted extraction sets. */
function craft(variables: Record<string, { value: unknown; confidence: number }>): ReferralFixture {
  const base = byId('REF-2026-0142')
  return {
    payload: { ...base.payload, referralId: 'REF-TEST-CRAFTED' },
    extraction: {
      variables,
      sources: Object.fromEntries(Object.keys(variables).map((k) => [k, 'note' as const])),
    },
  }
}

interface Check {
  name: string
  run: () => string | null
}

const checks: Check[] = [
  {
    name: 'clinic deltas all compile to applied; override node ids recorded',
    run: () => {
      // DASHBOARD_TREE importing without throwing already proves every result
      // was 'applied' (the module throws otherwise) — assert the artifacts.
      if (DASHBOARD_DELTAS.length < 2) return `expected >= 2 deltas, got ${DASHBOARD_DELTAS.length}`
      if (OVERRIDE_NODE_IDS.size === 0) return 'OVERRIDE_NODE_IDS is empty'
      if (!OVERRIDE_NODE_IDS.has('spec_li')) return `spec_li not in overrides: ${[...OVERRIDE_NODE_IDS].join(',')}`
      if (!OVERRIDE_NODE_IDS.has('spec_bhowmick')) return `spec_bhowmick not in overrides: ${[...OVERRIDE_NODE_IDS].join(',')}`
      const bhowmick = DASHBOARD_TREE.nodes.find((n) => n.id === 'spec_bhowmick')
      if (bhowmick?.type !== 'specialist' || bhowmick.urgency !== 'urgent') {
        return 'set_urgency delta not reflected in compiled tree (spec_bhowmick should be urgent)'
      }
      const li = DASHBOARD_TREE.nodes.find((n) => n.id === 'spec_li')
      if (li?.type !== 'specialist') return 'spec_li missing'
      if (!li.workup.always.some((w) => w.name.includes('High-resolution nerve ultrasound (brachial plexus protocol)'))) {
        return 'add_workup delta not reflected on spec_li'
      }
      return null
    },
  },
  {
    name: 'fixture 1 (clean CTS) routes to Dr. Saltzman, high confidence, ready to approve',
    run: () => {
      const r = deriveTreeResult(byId('REF-2026-0142'))
      if (r.routedTo?.specialistName !== 'Dr. Eliana Saltzman') return `routed to ${r.routedTo?.specialistName}`
      if (r.urgency !== 'routine') return `urgency ${r.urgency}`
      if (r.confidence !== 'high') return `confidence ${r.confidence}: ${r.confidenceReason}`
      if (queueGroupFor(r, undefined) !== 'ready') return `group ${queueGroupFor(r, undefined)}`
      if (r.pathTaken.length !== 6) return `expected 6 decision steps, got ${r.pathTaken.length}`
      for (const step of r.pathTaken) {
        if (step.source === 'unknown') return `step ${step.variableKey} has unknown source`
        if (!step.answer || step.answer.includes('→')) return `unreadable answer "${step.answer}"`
        if (!step.nodeId) return `step ${step.variableKey} missing nodeId`
      }
      if (r.terminalOverridden) return 'Saltzman terminal wrongly marked overridden'
      if (!r.terminalCitation?.includes('compression neuropathies')) return 'terminalCitation missing clinicalBasis'
      if (r.confirmWithDrLi !== true) return 'confirmWithDrLi not carried through'
      if (r.requiredWorkup.length === 0) return 'no workup derived'
      const emg = r.requiredWorkup.find((w) => w.name === 'Nerve conduction studies + needle EMG (upper limbs)')
      if (!emg) return 'EMG workup item missing'
      if (emg.status !== 'resulted' || emg.responsible !== 'referring office') return `workupState overlay not applied: ${emg.status}/${emg.responsible}`
      if (emg.atRisk) return 'resulted item should not be at risk'
      const us = r.requiredWorkup.find((w) => w.name.startsWith('High-resolution nerve ultrasound'))
      if (!us || us.status !== 'needed' || us.responsible !== 'clinic') return 'default workup status/responsible wrong'
      if (!us.atRisk) return 'needed item due 14d before an Aug 6 visit should be at risk (due within 7d of DEMO_NOW)'
      return null
    },
  },
  {
    name: 'fixture 2 (no EMG) is incomplete → needs information, with real gates',
    run: () => {
      const r = deriveTreeResult(byId('REF-2026-0147'))
      if (r.routedTo !== null) return `unexpectedly routed to ${r.routedTo.specialistName}`
      if (r.missingVariables.length !== 1) return `expected 1 missing variable, got ${r.missingVariables.length}`
      if (queueGroupFor(r, undefined) !== 'needs_info') return `group ${queueGroupFor(r, undefined)}`
      const mv = r.missingVariables[0]
      if (mv.variableKey !== 'nerveStudyStatus') return `missing var ${mv.variableKey}`
      // node_comp_emg_upper is dataSource 'record' → medical records supply it.
      if (mv.whoCanSupply !== 'medical records') return `whoCanSupply ${mv.whoCanSupply}`
      if (!mv.question.toLowerCase().includes('nerve test')) return `question not from VARIABLE_SPECS: ${mv.question}`
      if (mv.gates.length !== 4) return `expected 4 gates, got ${mv.gates.length}`
      const direct = mv.gates.find((g) => g.answerLabel === 'EMG abnormal')
      if (!direct || !direct.leadsTo.includes('Dr. Eliana Saltzman')) return `direct gate wrong: ${JSON.stringify(direct)}`
      const gated = mv.gates.find((g) => g.answerLabel === 'EMG normal')
      if (!gated || !gated.leadsTo.includes('depends on nightOrPositional')) return `gated gate wrong: ${JSON.stringify(gated)}`
      if (!gated.leadsTo.includes('3 possible destinations')) return `terminal count wrong: ${gated.leadsTo}`
      if (mv.gates.some((g) => g.answerLabel.includes('→'))) return 'answerLabel still carries routing hint'
      // Partial path steps are kept for transparency.
      if (r.pathTaken.length !== 5) return `expected 5 partial steps, got ${r.pathTaken.length}`
      return null
    },
  },
  {
    name: 'fixture 3 (spine vs peripheral) routes but lands in needs judgment',
    run: () => {
      const r = deriveTreeResult(byId('REF-2026-0151'))
      if (r.routedTo?.specialistName !== 'Dr. Muhammad Abd-El-Barr') return `routed to ${r.routedTo?.specialistName}`
      if (r.confidence === 'high') return 'confidence should not be high'
      if (queueGroupFor(r, undefined) !== 'needs_judgment') return `group ${queueGroupFor(r, undefined)}`
      const mentionsWeakVar = r.confidenceReason.includes('0.55')
      const mentionsAmbiguity = r.confidenceReason.toLowerCase().includes('ambig') || r.confidenceReason.includes('either')
      if (!mentionsWeakVar && !mentionsAmbiguity) return `confidenceReason unhelpful: ${r.confidenceReason}`
      if (!r.flags.ambiguousBetween) return 'ambiguousBetween flag lost'
      return null
    },
  },
  {
    name: 'fixture 4 (rotator cuff) is out of scope with a redirect',
    run: () => {
      const r = deriveTreeResult(byId('REF-2026-0155'))
      if (r.inScope) return 'should be out of scope'
      if (r.routedTo !== null) return `routedTo should be null, got ${r.routedTo.specialistName}`
      if (r.urgency !== null) return `urgency should be null, got ${r.urgency}`
      if (queueGroupFor(r, undefined) !== 'out_of_scope') return `group ${queueGroupFor(r, undefined)}`
      if (r.suggestedRedirect !== 'Sports Medicine / Shoulder service') return `redirect ${r.suggestedRedirect}`
      if (r.pathTaken.length === 0) return 'pathTaken should be kept for transparency'
      return null
    },
  },
  {
    name: 'fixture 5 (acute trauma) escalates as an emergency',
    run: () => {
      const r = deriveTreeResult(byId('REF-2026-0158'))
      // Engine truth: urgentRedFlag=acute_trauma → esc_urgent_trauma escalation,
      // classified 'emergency' (acute_trauma is in the engine emergency set).
      if (!r.escalated) return 'should be escalated'
      if (r.escalationCategory !== 'emergency') return `category ${r.escalationCategory}`
      if (!r.escalationReason?.includes('URGENT FAST-TRACK')) return `reason ${r.escalationReason}`
      if (queueGroupFor(r, undefined) !== 'escalated') return `group ${queueGroupFor(r, undefined)}`
      if (r.routedTo !== null) return 'escalation should not carry a routedTo'
      return null
    },
  },
  {
    name: 'confidenceBand boundaries (0.8 / 0.5)',
    run: () => {
      if (confidenceBand(0.8) !== 'high') return '0.8 should be high'
      if (confidenceBand(0.79) !== 'medium') return '0.79 should be medium'
      if (confidenceBand(0.5) !== 'medium') return '0.5 should be medium'
      if (confidenceBand(0.49) !== 'low') return '0.49 should be low'
      return null
    },
  },
  {
    name: 'overridden path: delta-modified terminals surface terminalOverridden + delta workup',
    run: () => {
      // Route to Dr. Li (add_workup override): functional loss after stroke.
      const li = deriveTreeResult(
        craft({
          urgentRedFlag: { value: 'none', confidence: 0.95 },
          presentationCategory: { value: 'functional_umn', confidence: 0.9 },
          umnHistory: { value: 'stroke', confidence: 0.92 },
        }),
      )
      if (li.routedTo?.specialistName !== 'Dr. Neill Li') return `expected Dr. Neill Li, got ${li.routedTo?.specialistName}`
      if (!li.terminalOverridden) return 'spec_li terminal should be marked overridden'
      if (!li.requiredWorkup.some((w) => w.name === 'High-resolution nerve ultrasound (brachial plexus protocol)')) {
        return `delta-added ultrasound missing from workup: ${li.requiredWorkup.map((w) => w.name).join(' | ')}`
      }
      // Route to Dr. Bhowmick (set_urgency override): rapidly worsening spine.
      const bh = deriveTreeResult(
        craft({
          urgentRedFlag: { value: 'none', confidence: 0.95 },
          presentationCategory: { value: 'compression', confidence: 0.9 },
          laterality: { value: 'one_side', confidence: 0.9 },
          primarySymptom: { value: 'pain', confidence: 0.9 },
          symptomRegion: { value: 'neck_radiating', confidence: 0.9 },
          progression: { value: 'rapidly_worsening', confidence: 0.9 },
        }),
      )
      if (bh.routedTo?.specialistName !== 'Dr. Deb Bhowmick') return `expected Dr. Deb Bhowmick, got ${bh.routedTo?.specialistName}`
      if (!bh.terminalOverridden) return 'spec_bhowmick terminal should be marked overridden'
      if (bh.urgency !== 'urgent') return `clinic urgency override not reflected: ${bh.urgency}`
      return null
    },
  },
  {
    name: 'full fixture set: 32 referrals, unique ids, non-empty ICD-10, exact per-group counts',
    run: () => {
      const total = REFERRAL_FIXTURES.length
      if (total < 28 || total > 32) return `total ${total} outside 28–32`
      if (total !== 32) return `expected exactly 32 fixtures, got ${total}`
      const ids = REFERRAL_FIXTURES.map((f) => f.payload.referralId)
      if (new Set(ids).size !== ids.length) return 'duplicate referralIds'
      for (const f of REFERRAL_FIXTURES) {
        if (f.payload.diagnoses.length === 0) return `${f.payload.referralId} has no ICD-10 diagnoses`
      }
      const counts: Record<string, number> = {}
      for (const f of REFERRAL_FIXTURES) {
        const g = queueGroupFor(deriveTreeResult(f), undefined)
        counts[g] = (counts[g] ?? 0) + 1
      }
      const expected: Record<string, number> = {
        ready: 15,
        needs_info: 4,
        needs_judgment: 5,
        out_of_scope: 3,
        escalated: 5,
      }
      for (const [group, n] of Object.entries(expected)) {
        if (counts[group] !== n) return `group ${group}: expected ${n}, got ${counts[group] ?? 0} (${JSON.stringify(counts)})`
      }
      return null
    },
  },
  {
    name: 'fixture set: clinic-override terminals appear ≥2× each (Li add_workup, Bhowmick urgent)',
    run: () => {
      const results = REFERRAL_FIXTURES.map((f) => deriveTreeResult(f))
      const li = results.filter(
        (r) => r.routedTo?.nodeId === 'spec_li' && r.terminalOverridden,
      )
      if (li.length < 2) return `expected ≥2 overridden spec_li routings, got ${li.length}`
      const bh = results.filter(
        (r) => r.routedTo?.nodeId === 'spec_bhowmick' && r.urgency === 'urgent',
      )
      if (bh.length < 2) return `expected ≥2 urgent spec_bhowmick routings, got ${bh.length}`
      if (!bh.every((r) => r.terminalOverridden)) return 'spec_bhowmick routings not marked overridden'
      return null
    },
  },
  {
    name: 'fixture set: ≥3 stated-reason mismatches; fax/phone extractions are honestly sparser',
    run: () => {
      const mismatches = REFERRAL_FIXTURES.filter(
        (f) => f.annotations?.flags?.statedReasonMismatch === true,
      )
      if (mismatches.length < 3) return `expected ≥3 statedReasonMismatch fixtures, got ${mismatches.length}`
      // Fax/phone referrals carry lower extraction confidence than Epic ones.
      // Fixtures whose ONLY variable is urgentRedFlag are exempt: a referrer
      // phoning in an explicit red flag is a stated fact, not sparse prose.
      for (const f of REFERRAL_FIXTURES) {
        if (f.payload.channel === 'epic') continue
        const entries = Object.values(f.extraction.variables)
        if (Object.keys(f.extraction.variables).length === 1 && f.extraction.variables.urgentRedFlag) continue
        if (!entries.some((v) => v.confidence < 0.85)) {
          return `${f.payload.referralId} (${f.payload.channel}) has no variable below 0.85`
        }
      }
      return null
    },
  },
  {
    name: 'reviewed referrals leave the queue',
    run: () => {
      const r = deriveTreeResult(byId('REF-2026-0142'))
      const group = queueGroupFor(r, {
        referralId: 'REF-2026-0142',
        status: 'approved',
        reviewer: 'coordinator',
      })
      if (group !== 'done') return `expected done, got ${group}`
      return null
    },
  },
  {
    name: 'info_requested referrals stay active in needs_info (not done)',
    run: () => {
      const r = deriveTreeResult(byId('REF-2026-0147'))
      const group = queueGroupFor(r, {
        referralId: 'REF-2026-0147',
        status: 'info_requested',
        reviewer: 'coordinator',
      })
      if (group !== 'needs_info') return `expected needs_info, got ${group}`
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
  throw new Error(`${failures} dashboard foundation test(s) failed`)
}
console.log(`dashboard/lib/deriveTreeResult.test.ts — all ${checks.length} passed`)
