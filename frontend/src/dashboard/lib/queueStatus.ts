import type { QueueGroup, ReviewState, TreeResult } from '../types'

/**
 * Dashboard — deterministic queue assignment.
 *
 * Every referral lands in exactly one worklist group. Order of checks is
 * clinical priority: reviewed referrals leave the queue, safety escalations
 * first, then scope, then blockers, then judgment calls, then ready.
 */

export function queueGroupFor(
  result: TreeResult,
  review: ReviewState | undefined,
): QueueGroup | 'done' {
  if (review && review.status !== 'pending') return 'done'
  if (result.escalated) return 'escalated'
  if (!result.inScope) return 'out_of_scope'
  if (result.missingVariables.length > 0) return 'needs_info'
  if (
    result.confidence !== 'high' ||
    result.flags.ambiguousBetween ||
    result.flags.statedReasonMismatch
  ) {
    return 'needs_judgment'
  }
  return 'ready'
}

export const QUEUE_GROUP_ORDER: QueueGroup[] = [
  'ready',
  'needs_info',
  'needs_judgment',
  'out_of_scope',
  'escalated',
]

export const QUEUE_GROUP_LABELS: Record<QueueGroup, string> = {
  ready: 'Ready to approve',
  needs_info: 'Needs information',
  needs_judgment: 'Needs judgment',
  out_of_scope: 'Likely out of scope',
  escalated: 'Escalated',
}
