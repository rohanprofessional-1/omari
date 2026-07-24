import { dukeNerveTree } from '../../data/dukeNerveTree'
import { compile } from '../../lib/deltas/compile'
import { describeDelta } from '../../lib/deltas/describe'
import { DeltaSchema, type Delta } from '../../lib/deltas/schema'
import type { Tree } from '../../types/tree'

/**
 * Dashboard — the clinic's delta layer over the Duke Nerve Center base tree.
 *
 * Two real clinic decisions authored with the REAL persisted Delta vocabulary
 * (lib/deltas/schema.ts), anchored semantically by specialist name (every
 * specialist name in dukeNerveTree is unique, so the terminal anchor resolves
 * exactly). Both deltas deviate from the CPG on purpose — deviatesFromCpg is
 * first-class provenance, and the dashboard renders these terminals as
 * clinic-overridden.
 *
 * The compiled singleton (DASHBOARD_TREE) is what every referral replays
 * through. Same fail-loud discipline as dukeNerveTree: any delta that does
 * not compile to 'applied' throws at import time.
 */

/* Verbatim CPG text being overridden (from dukeNerveTree clinicalBasis). */
const LI_CPG_BASIS =
  'Brachial plexus (adult + birth), nerve transfers, AND upper-motor-neuron functional restoration after stroke/TBI/CP/SCI (nerve + tendon + muscle transfer). Route here for brachial plexus injuries, complex peripheral-nerve reconstruction, functional restoration after UMN injury, and upper-limb nerve-transfer candidates.'

const BHOWMICK_CPG_BASIS =
  'Complex & trauma spine, craniocervical junction, and cervical deformity. Route here for complex/severe or trauma-related spine pathology and craniocervical/cervical deformity.'

export const DASHBOARD_DELTAS: Delta[] = [
  DeltaSchema.parse({
    id: 'dash_wk_li_ultrasound',
    seq: 0,
    payload: {
      op: 'add_workup',
      anchor: { kind: 'terminal', specialistName: 'Dr. Neill Li' },
      item: {
        name: 'High-resolution nerve ultrasound (brachial plexus protocol)',
        protocol:
          '18+ MHz linear probe; supraclavicular and infraclavicular plexus survey with side-to-side comparison.',
        rationale:
          'Dynamic plexus ultrasound before the visit — reconstruction candidacy is decided in one appointment.',
      },
    },
    provenance: {
      author: 'Dr. Li',
      rationale:
        'Our clinic reviews plexus ultrasound alongside MRI at the first visit; the guideline workup (MRI + EMG alone) forces a second appointment before transfer planning.',
      deviatesFromCpg: true,
      cpgBasis: LI_CPG_BASIS,
      sessionStage: 'workup',
    },
  }),
  DeltaSchema.parse({
    id: 'dash_urg_bhowmick_urgent',
    seq: 1,
    payload: {
      op: 'set_urgency',
      anchors: [{ kind: 'terminal', specialistName: 'Dr. Deb Bhowmick' }],
      urgency: 'urgent',
    },
    provenance: {
      author: 'Dr. Li',
      rationale:
        'Rapidly worsening cervical radicular deficits get our urgent (<72h) slot, not the expedited queue the guideline suggests — we have seen fixed deficits develop while patients waited.',
      deviatesFromCpg: true,
      cpgBasis: BHOWMICK_CPG_BASIS,
      sessionStage: 'thresholds',
    },
  }),
]

const compiled = compile(dukeNerveTree, DASHBOARD_DELTAS)

/* Fail loud at import — same discipline as the dukeNerveTree integrity check.
 * A dashboard silently running on a base tree missing the clinic's decisions
 * would misrepresent every routing it displays. */
for (const result of compiled.results) {
  if (result.status !== 'applied') {
    throw new Error(
      `dashboardDeltas integrity: delta "${result.deltaId}" compiled to "${result.status}"${
        result.reason ? ` — ${result.reason}` : ''
      }`,
    )
  }
}

/** The deployed tree the dashboard replays every referral through. */
export const DASHBOARD_TREE: Tree = compiled.tree

/** Node ids touched by deltas whose provenance says deviatesFromCpg. */
export const OVERRIDE_NODE_IDS: Set<string> = new Set(
  compiled.results.flatMap((result) => {
    const delta = DASHBOARD_DELTAS.find((d) => d.id === result.deltaId)
    return delta?.provenance.deviatesFromCpg ? result.nodeIds : []
  }),
)

if (OVERRIDE_NODE_IDS.size === 0) {
  throw new Error('dashboardDeltas integrity: no override node ids — deltas did not touch any node.')
}

/* ── Override provenance for the detail screen ────────────────────────────── */

export interface OverrideInfo {
  author: string
  rationale: string
  /** Verbatim CPG text the clinic deviated from (captured at authoring time). */
  cpgBasis?: string
  /** One-sentence human rendering of the delta op. */
  opSummary: string
}

const OVERRIDE_INFO_BY_NODE = new Map<string, OverrideInfo>(
  compiled.results.flatMap((result) => {
    const delta = DASHBOARD_DELTAS.find((d) => d.id === result.deltaId)
    if (!delta?.provenance.deviatesFromCpg) return []
    const info: OverrideInfo = {
      author: delta.provenance.author,
      rationale: delta.provenance.rationale,
      cpgBasis: delta.provenance.cpgBasis,
      // describeDelta appends '— DEVIATES FROM CPG: {rationale}'; the detail
      // screen shows rationale separately, so keep just the op sentence.
      opSummary: describeDelta(delta).split(' — DEVIATES FROM CPG')[0],
    }
    return result.nodeIds.map((nodeId): [string, OverrideInfo] => [nodeId, info])
  }),
)

/** Delta provenance for a clinic-overridden node, or null when untouched. */
export function overrideInfoForNode(nodeId: string): OverrideInfo | null {
  return OVERRIDE_INFO_BY_NODE.get(nodeId) ?? null
}
