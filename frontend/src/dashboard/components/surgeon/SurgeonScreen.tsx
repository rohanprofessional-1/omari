import { useEffect, useMemo, useState } from 'react'
import { getReferralSource } from '../../data/adapter'
import {
  addComment,
  applyAction,
  markSurgeonSeen,
  markSurgeonVisit,
  reviewerNameFor,
  useDashboardStore,
} from '../../lib/reviewStore'
import {
  summarizeHandled,
  surgeonSections,
  type CorrectedEntry,
  type EscalatedEntry,
  type LowConfidenceEntry,
} from '../../lib/surgeonBrief'
import type { ReviewableReferral } from '../../types'
import ActionModal from '../detail/ActionModal'
import ConfidencePill from '../shared/ConfidencePill'
import SurgeonRow, { CommentButton, surgeonBtnOutline, surgeonBtnPrimary } from './SurgeonRow'

/**
 * The surgeon's brief — NOT a filtered queue. Three short exception sections
 * (escalations, low confidence, coordinator disagreements), each row
 * resolvable inline in seconds, headed by proof the system is working: a
 * count of everything handled without the surgeon since their last visit.
 * If this list is ever long, the design has failed.
 */

const ESCALATION_CATEGORY_LABELS: Record<string, string> = {
  emergency: 'Emergency',
  ambiguous: 'Ambiguous',
  complex: 'Complex',
}

function SectionHeader({ label, count, hint }: { label: string; count: number; hint: string }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-line bg-bg/60 px-4 py-2">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink">
        {label} <span className="font-normal text-muted">({count})</span>
      </h2>
      <p className="truncate text-[11px] text-muted">{hint}</p>
    </div>
  )
}

/** The "system works" proof — counts of what was handled without the surgeon. */
function HandledStrip({
  total,
  approved,
  corrected,
  sinceLabel,
  onCaughtUp,
}: {
  total: number
  approved: number
  corrected: number
  sinceLabel: string
  onCaughtUp: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success-deep/20 bg-success-soft/50 px-4 py-3">
      <p className="text-[13px] text-success-deep">
        {total === 0 ? (
          <>Nothing handled {sinceLabel} yet.</>
        ) : (
          <>
            <span className="font-semibold">
              {total} referral{total === 1 ? '' : 's'}
            </span>{' '}
            handled without you {sinceLabel} · <span className="font-semibold">{approved}</span>{' '}
            approved as proposed · <span className="font-semibold">{corrected}</span> corrected by
            coordinators
          </>
        )}
      </p>
      <button
        onClick={onCaughtUp}
        title="Zeroes these counters — the next visit counts from now"
        className="ml-auto shrink-0 rounded-md border border-success-deep/30 px-2.5 py-1 text-[11.5px] font-medium text-success-deep transition-colors hover:bg-success-soft"
      >
        Mark caught up
      </button>
    </div>
  )
}

export default function SurgeonScreen({ onOpen }: { onOpen: (referralId: string) => void }) {
  const { reviews, audit, role, surgeonLastVisit } = useDashboardStore()
  const [referrals, setReferrals] = useState<ReviewableReferral[] | null>(null)
  /** Escalated-with-no-route rows route inline via the existing modal. */
  const [routingFor, setRoutingFor] = useState<ReviewableReferral | null>(null)

  useEffect(() => {
    let cancelled = false
    getReferralSource()
      .listReferrals()
      .then((rows) => {
        if (!cancelled) setReferrals(rows)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const summary = useMemo(() => summarizeHandled(audit, surgeonLastVisit), [audit, surgeonLastVisit])
  const sections = useMemo(
    () => surgeonSections(referrals ?? [], reviews, audit),
    [referrals, reviews, audit],
  )

  if (!referrals) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-2 h-14 animate-pulse rounded-lg bg-line/50" />
        ))}
      </div>
    )
  }

  const actor = reviewerNameFor(role)
  const sinceLabel = surgeonLastVisit ? 'since your last visit' : 'since the demo began'
  const allClear =
    sections.escalated.length === 0 &&
    sections.lowConfidence.length === 0 &&
    sections.corrected.length === 0

  const confirm = (id: string) =>
    applyAction(id, 'approved', { actor, role, note: 'Surgeon confirmed' })

  const comment = (id: string) => (note: string) => addComment(id, note, actor, role)

  const endorse = (id: string) => {
    addComment(id, 'Endorsed correction', actor, role)
    markSurgeonSeen(id)
  }

  const revert = (id: string) =>
    applyAction(id, 'approved', { actor, role, note: 'Surgeon reverted to tree recommendation' })

  /* Escalated + low-confidence rows: Confirm agrees with the tree's routing;
   * rows with no route (tree escalations) get Route… instead. */
  const confirmOrRoute = (referral: ReviewableReferral) =>
    referral.result.routedTo ? (
      <button
        onClick={() => confirm(referral.payload.referralId)}
        title={`Approve routing to ${referral.result.routedTo.specialistName}`}
        className={surgeonBtnPrimary}
      >
        Confirm
      </button>
    ) : (
      <button
        onClick={() => setRoutingFor(referral)}
        title="No route yet — pick the destination"
        className={surgeonBtnPrimary}
      >
        Route…
      </button>
    )

  const escalatedPayload = ({ referral, coordinatorNote }: EscalatedEntry) => {
    const { result } = referral
    const category = result.escalationCategory
      ? ESCALATION_CATEGORY_LABELS[result.escalationCategory] ?? result.escalationCategory
      : null
    return (
      <>
        <span className="text-danger">
          {category && <span className="font-semibold uppercase tracking-[0.05em]">{category}</span>}
          {category && result.escalationReason && ' — '}
          {result.escalationReason}
        </span>
        {coordinatorNote && (
          <span className="mt-0.5 block text-ink">
            <span className="text-muted">Coordinator:</span> “{coordinatorNote}”
          </span>
        )}
      </>
    )
  }

  const lowConfidencePayload = ({ referral }: LowConfidenceEntry) => {
    const { result } = referral
    const ambiguous = result.flags.ambiguousBetween
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <ConfidencePill level={result.confidence} />
        <span>{result.confidenceReason}</span>
        {ambiguous && (
          <span className="text-ink">
            Could be {ambiguous[0]} or {ambiguous[1]}.
          </span>
        )}
      </span>
    )
  }

  /* The tree-improvement feed — the coordinator's reason quote is the point. */
  const correctedPayload = ({ correction, reviewer }: CorrectedEntry) => (
    <>
      <span>
        Tree said <span className="text-ink">{correction.from}</span> →{' '}
        <span className="text-muted">{reviewer}</span> sent to{' '}
        <span className="font-medium text-ink">{correction.to}</span>:
      </span>{' '}
      <span className="font-medium text-accent-strong">“{correction.reason}”</span>
    </>
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <HandledStrip
        total={summary.total}
        approved={summary.approved}
        corrected={summary.corrected}
        sinceLabel={sinceLabel}
        onCaughtUp={markSurgeonVisit}
      />

      {allClear ? (
        <div className="mt-8 text-center">
          <p className="font-serif text-[16px] font-semibold text-ink">Nothing needs you.</p>
          <p className="mt-1 text-[13px] text-muted">
            {summary.total} referral{summary.total === 1 ? '' : 's'} handled {sinceLabel}.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {sections.escalated.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-line bg-canvas">
              <SectionHeader
                label="Escalated to you"
                count={sections.escalated.length}
                hint="The tree or a coordinator wants your call"
              />
              {sections.escalated.map((entry) => (
                <SurgeonRow
                  key={entry.referral.payload.referralId}
                  referral={entry.referral}
                  payload={escalatedPayload(entry)}
                  onOpen={onOpen}
                  actions={
                    <>
                      {confirmOrRoute(entry.referral)}
                      <CommentButton onSubmit={comment(entry.referral.payload.referralId)} />
                    </>
                  }
                />
              ))}
            </section>
          )}

          {sections.lowConfidence.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-line bg-canvas">
              <SectionHeader
                label="Low confidence"
                count={sections.lowConfidence.length}
                hint="Routed, but the tree isn't sure"
              />
              {sections.lowConfidence.map((entry) => (
                <SurgeonRow
                  key={entry.referral.payload.referralId}
                  referral={entry.referral}
                  payload={lowConfidencePayload(entry)}
                  onOpen={onOpen}
                  actions={
                    <>
                      {confirmOrRoute(entry.referral)}
                      <CommentButton onSubmit={comment(entry.referral.payload.referralId)} />
                    </>
                  }
                />
              ))}
            </section>
          )}

          {sections.corrected.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-line bg-canvas">
              <SectionHeader
                label="Coordinator disagreed with the tree"
                count={sections.corrected.length}
                hint="Their reasons feed tree improvement"
              />
              {sections.corrected.map((entry) => (
                <SurgeonRow
                  key={entry.referral.payload.referralId}
                  referral={entry.referral}
                  payload={correctedPayload(entry)}
                  onOpen={onOpen}
                  actions={
                    <>
                      <button
                        onClick={() => endorse(entry.referral.payload.referralId)}
                        title="Agree with the coordinator — logs an endorsement note"
                        className={surgeonBtnPrimary}
                      >
                        Endorse correction
                      </button>
                      <button
                        onClick={() => revert(entry.referral.payload.referralId)}
                        title="Disagree — approve the tree's original recommendation"
                        className={surgeonBtnOutline}
                      >
                        Revert to tree
                      </button>
                    </>
                  }
                />
              ))}
            </section>
          )}
        </div>
      )}

      {routingFor && (
        <ActionModal
          mode="change_destination"
          referral={routingFor}
          onClose={() => setRoutingFor(null)}
        />
      )}
    </div>
  )
}
