import { useEffect } from 'react'
import { applyAction, reopenReview, reviewerNameFor, useDashboardStore } from '../../lib/reviewStore'
import type { ReviewState, ReviewStatus, ReviewableReferral } from '../../types'
import type { ActionModalMode } from './ActionModal'

/**
 * Dashboard detail — the sticky decision bar. Buttons adapt to the referral's
 * archetype (routed / out-of-scope / tree-escalated / needs-info) and to the
 * current review state: once acted on, the bar becomes a summary + Reopen.
 *
 * One-click actions happen here; anything needing structured input (a
 * correction, a redirect, a request, an escalation note) opens ActionModal.
 */

const btnPrimary =
  'rounded-dash-ctl bg-dash-accent-strong px-3 py-1 text-dash-micro font-semibold text-white transition-colors hover:bg-dash-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent disabled:cursor-not-allowed disabled:opacity-40'
const btnOutline =
  'rounded-dash-ctl border border-dash-line bg-dash-surface px-3 py-1 text-dash-micro font-medium text-dash-ink transition-colors hover:bg-dash-bg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent'
const btnGhost =
  'rounded-dash-ctl border border-transparent px-3 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent'

const DONE_VERB: Record<Exclude<ReviewStatus, 'pending'>, string> = {
  approved: 'Approved',
  corrected: 'Corrected',
  rejected: 'Rejected — out of scope',
  escalated: 'Escalated to surgeon',
  info_requested: 'Information requested',
}

type Archetype = 'escalated' | 'out_of_scope' | 'needs_info' | 'routed'

function archetypeOf(referral: ReviewableReferral): Archetype {
  const { result } = referral
  if (result.escalated) return 'escalated'
  if (!result.inScope) return 'out_of_scope'
  if (result.missingVariables.length > 0) return 'needs_info'
  return 'routed'
}

export default function ActionBar({
  referral,
  review,
  modalOpen,
  onOpenModal,
}: {
  referral: ReviewableReferral
  review: ReviewState | undefined
  modalOpen: boolean
  onOpenModal: (mode: ActionModalMode) => void
}) {
  const { role } = useDashboardStore()
  const actor = reviewerNameFor(role)
  const id = referral.payload.referralId
  const { result } = referral
  const status: ReviewStatus = review?.status ?? 'pending'
  const archetype = archetypeOf(referral)

  const approveEnabled =
    status === 'pending' && (archetype === 'routed' || archetype === 'needs_info')

  const approve = () => applyAction(id, 'approved', { actor, role })

  const confirmOutOfScope = () => {
    if (!result.suggestedRedirect) {
      onOpenModal('out_of_scope') // no suggested redirect — collect one
      return
    }
    applyAction(id, 'rejected', {
      actor,
      role,
      correction: {
        field: 'scope',
        from: result.routedTo?.specialistName ?? 'unrouted',
        to: result.suggestedRedirect,
        reason: result.scopeReason ?? 'Out of scope for this clinic',
      },
    })
  }

  const sendToSurgeon = () =>
    applyAction(id, 'escalated', {
      actor,
      role,
      note: result.escalationReason
        ? `Tree escalation confirmed — ${result.escalationReason}`
        : 'Sent to surgeon for review',
    })

  /* Keyboard: 'a' approves when approve is enabled and no modal is open. */
  useEffect(() => {
    if (modalOpen || !approveEnabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'a' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        t?.isContentEditable
      ) {
        return
      }
      approve()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, approveEnabled, id, actor, role])

  /* ── Already reviewed → summary + Reopen ──────────────────────────────── */

  if (status !== 'pending') {
    const time = review?.reviewedAt
      ? new Date(review.reviewedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : null
    return (
      <div className="sticky bottom-0 -mx-6 mt-4 border-t border-dash-line bg-dash-surface/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-dash-body text-dash-ink">
            <span className="font-medium">{DONE_VERB[status]}</span>
            {review?.reviewer && <span className="text-dash-muted"> by {review.reviewer}</span>}
            {time && <span className="tabular-nums text-dash-muted"> · {time}</span>}
            {review?.correction && (
              <span className="text-dash-muted">
                {' '}
                · {review.correction.field}: {review.correction.from} →{' '}
                <span className="text-dash-ink">{review.correction.to}</span>
              </span>
            )}
          </p>
          <button
            onClick={() => reopenReview(id, actor, role)}
            className={`ml-auto ${btnGhost}`}
            title="Return this referral to the pending queue"
          >
            Reopen
          </button>
        </div>
      </div>
    )
  }

  /* ── Pending → archetype-specific buttons ─────────────────────────────── */

  return (
    <div className="sticky bottom-0 -mx-6 mt-4 border-t border-dash-line bg-dash-surface/95 px-6 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        {archetype === 'routed' && (
          <>
            <button onClick={approve} className={btnPrimary} title="Shortcut: a">
              Approve as proposed
            </button>
            <button onClick={() => onOpenModal('change_destination')} className={btnOutline}>
              Change destination
            </button>
            <button onClick={() => onOpenModal('out_of_scope')} className={btnGhost}>
              Mark out of scope
            </button>
            <button onClick={() => onOpenModal('request_info')} className={btnGhost}>
              Request information
            </button>
            <button onClick={() => onOpenModal('escalate')} className={btnGhost}>
              Escalate to surgeon
            </button>
          </>
        )}

        {archetype === 'out_of_scope' && (
          <>
            <button onClick={confirmOutOfScope} className={btnPrimary}>
              Confirm out of scope
            </button>
            <button onClick={() => onOpenModal('change_destination')} className={btnOutline}>
              Disagree — route in clinic
            </button>
            <button onClick={() => onOpenModal('request_info')} className={btnGhost}>
              Request information
            </button>
            <button onClick={() => onOpenModal('escalate')} className={btnGhost}>
              Escalate to surgeon
            </button>
          </>
        )}

        {archetype === 'escalated' && (
          <>
            <button onClick={sendToSurgeon} className={btnPrimary}>
              Send to surgeon
            </button>
            <button onClick={() => onOpenModal('change_destination')} className={btnOutline}>
              Change destination
            </button>
            <button onClick={() => onOpenModal('request_info')} className={btnGhost}>
              Request information
            </button>
          </>
        )}

        {archetype === 'needs_info' && (
          <>
            <button onClick={() => onOpenModal('request_info')} className={btnPrimary}>
              Request information
            </button>
            <button
              onClick={approve}
              disabled={!approveEnabled}
              title={approveEnabled ? 'Shortcut: a' : 'Missing information blocks approval'}
              className={`${btnOutline} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              Approve as proposed
            </button>
            <button onClick={() => onOpenModal('change_destination')} className={btnGhost}>
              Change destination
            </button>
            <button onClick={() => onOpenModal('escalate')} className={btnGhost}>
              Escalate to surgeon
            </button>
          </>
        )}
      </div>
    </div>
  )
}
