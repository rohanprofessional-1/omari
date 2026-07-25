import type {
  AuditEvent,
  Correction,
  ReviewState,
  ReviewableReferral,
  Role,
} from '../types'

/**
 * Dashboard — pure selectors for the surgeon brief.
 *
 * The surgeon sees ONLY exceptions — three short sections — plus proof the
 * system is working (what was handled without them since their last visit).
 * All membership and counting rules live here so they are testable without UI.
 */

/* ── Since-last-visit counter ─────────────────────────────────────────────── */

export interface HandledSummary {
  /** Referrals decided without the surgeon (approved + corrected + rejected). */
  total: number
  /** …of which approved exactly as the tree proposed. */
  approved: number
  /** …of which corrected by a coordinator. */
  corrected: number
}

const DECISION_ACTIONS = new Set<AuditEvent['action']>(['approved', 'corrected', 'rejected'])

/**
 * Count referrals decided by NON-surgeon actors since `since` (null = since
 * the start of demo data, i.e. all events). A referral counts once, by its
 * latest qualifying decision — reopen-then-redecide doesn't double-count.
 */
export function summarizeHandled(audit: AuditEvent[], since: string | null): HandledSummary {
  const latest = new Map<string, AuditEvent>()
  for (const e of audit) {
    if (e.role === 'surgeon') continue
    if (!DECISION_ACTIONS.has(e.action)) continue
    if (since !== null && e.at <= since) continue
    const prev = latest.get(e.referralId)
    if (!prev || e.at >= prev.at) latest.set(e.referralId, e)
  }
  let approved = 0
  let corrected = 0
  for (const e of latest.values()) {
    if (e.action === 'approved') approved += 1
    else if (e.action === 'corrected') corrected += 1
  }
  return { total: latest.size, approved, corrected }
}

/* ── Section membership ───────────────────────────────────────────────────── */

export interface EscalatedEntry {
  referral: ReviewableReferral
  /** Coordinator's escalation note (latest 'escalated' audit event), if any. */
  coordinatorNote?: string
}

export interface LowConfidenceEntry {
  referral: ReviewableReferral
}

export interface CorrectedEntry {
  referral: ReviewableReferral
  correction: Correction
  /** Display name of whoever recorded the correction. */
  reviewer: string
}

export interface SurgeonSections {
  escalated: EscalatedEntry[]
  lowConfidence: LowConfidenceEntry[]
  corrected: CorrectedEntry[]
}

/** Latest audit event for a referral matching `action`, or undefined. */
function latestEvent(
  audit: AuditEvent[],
  referralId: string,
  action: AuditEvent['action'],
): AuditEvent | undefined {
  let found: AuditEvent | undefined
  for (const e of audit) {
    if (e.referralId !== referralId || e.action !== action) continue
    if (!found || e.at >= found.at) found = e
  }
  return found
}

/**
 * Membership rules (each referral appears in at most one section):
 * - Escalated to you: review status 'escalated', OR the tree itself escalated
 *   and nobody has decided yet (status pending). Leaves on approve/correct/
 *   reject.
 * - Low confidence: still pending, not escalated, and the tree's confidence
 *   is below high. Leaves on any decision (including info_requested — a
 *   coordinator is already chasing it).
 * - Coordinator disagreed: status 'corrected' by a non-surgeon, not yet
 *   endorsed (surgeonSeen). Leaves on endorse (seen) or revert (approved).
 */
export function surgeonSections(
  referrals: ReviewableReferral[],
  reviews: Record<string, ReviewState>,
  audit: AuditEvent[],
): SurgeonSections {
  const escalated: EscalatedEntry[] = []
  const lowConfidence: LowConfidenceEntry[] = []
  const corrected: CorrectedEntry[] = []

  for (const referral of referrals) {
    const id = referral.payload.referralId
    const review = reviews[id]
    const status = review?.status ?? 'pending'
    const { result } = referral

    if (status === 'escalated' || (result.escalated && status === 'pending')) {
      escalated.push({ referral, coordinatorNote: latestEvent(audit, id, 'escalated')?.note })
      continue
    }

    if (status === 'pending' && !result.escalated && result.confidence !== 'high') {
      lowConfidence.push({ referral })
      continue
    }

    if (status === 'corrected' && !review?.surgeonSeen) {
      const event = latestEvent(audit, id, 'corrected')
      const byRole: Role | undefined = event?.role
      if (byRole === 'surgeon') continue // surgeon's own correction needs no endorsement
      const correction = review?.correction ?? event?.correction
      if (!correction) continue
      corrected.push({ referral, correction, reviewer: review?.reviewer ?? event?.actor ?? '' })
    }
  }

  return { escalated, lowConfidence, corrected }
}
