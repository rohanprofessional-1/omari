import { useEffect, useMemo, useState } from 'react'
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
import Badge from '../shared/Badge'
import ConfidencePill from '../shared/ConfidencePill'
import SectionBand from '../shared/SectionBand'
import ReasonBlock, { type ReasonTone } from './ReasonBlock'
import SurgeonRow, {
  CommentButton,
  surgeonBtnOutline,
  surgeonBtnPrimary,
  type CardRail,
} from './SurgeonRow'
import { useOpenReferral } from '../../lib/useOpenReferral'
import { useAuth } from '../../../auth/authStore'
import { filterForUser, listForUser } from '../../lib/scope'
import { escalationLabel, escalationTone } from '../shared/escalationPalette'
import { splitEscalationReason } from '../../lib/escalationReason'

/**
 * The surgeon's brief — NOT a filtered queue. Three short exception sections
 * (escalations, low confidence, coordinator disagreements), each row
 * resolvable inline in seconds, headed by proof the system is working: a
 * count of everything handled without the surgeon since their last visit.
 * If this list is ever long, the design has failed.
 */

/** Each section is its own card, banded like the queue's tiers. */
const SECTION_CARD =
  'rounded-dash-card border border-dash-line-strong bg-dash-surface shadow-dash-card [&>article:last-child]:border-b-0 [&>article:last-child]:rounded-b-dash-card'

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
    <div className="flex flex-wrap items-center gap-3 rounded-dash-card border border-dash-line bg-dash-surface px-4 py-3 shadow-dash-card">
      <p className="text-dash-body text-dash-strong">
        {total === 0 ? (
          <>Nothing handled {sinceLabel} yet.</>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-dash-ink">
              {total} referral{total === 1 ? '' : 's'}
            </span>{' '}
            handled without you {sinceLabel} ·{' '}
            <span className="font-semibold tabular-nums">{approved}</span> approved as proposed ·{' '}
            <span className="font-semibold tabular-nums">{corrected}</span> corrected by
            coordinators
          </>
        )}
      </p>
      <button
        onClick={onCaughtUp}
        title="Zeroes these counters — the next visit counts from now"
        className={`ml-auto ${surgeonBtnOutline}`}
      >
        Mark caught up
      </button>
    </div>
  )
}

export default function SurgeonScreen() {
  const onOpen = useOpenReferral()
  const { reviews, audit, role, surgeonLastVisit } = useDashboardStore()
  const { user } = useAuth()
  const [fetched, setReferrals] = useState<ReviewableReferral[] | null>(null)
  /** Escalated-with-no-route rows route inline via the existing modal. */
  const [routingFor, setRoutingFor] = useState<ReviewableReferral | null>(null)

  useEffect(() => {
    let cancelled = false
    listForUser(user).then((rows) => {
      if (!cancelled) setReferrals(rows)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  // A destination CORRECTION can move a referral to or from this surgeon, and
  // the adapter can't see corrections — so narrow here, on every render, rather
  // than refetching each time someone reviews something.
  const referrals = useMemo(
    () => (fetched === null ? null : filterForUser(fetched, reviews, user)),
    [fetched, reviews, user],
  )

  const summary = useMemo(() => summarizeHandled(audit, surgeonLastVisit), [audit, surgeonLastVisit])
  const sections = useMemo(
    () => surgeonSections(referrals ?? [], reviews, audit),
    [referrals, reviews, audit],
  )

  if (!referrals) {
    return (
      <div className="min-h-full bg-dash-bg">
        <div className="mx-auto w-full max-w-dash-page p-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="mb-3 h-24 animate-pulse rounded-dash-card bg-dash-line/60 motion-reduce:animate-none"
            />
          ))}
        </div>
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

  /* Flag-type badge opening the scan line — the calm status palette. Always
   * present on an escalation, so rows start with the same shape even when the
   * engine gave no category. */
  const escalatedBadge = ({ referral }: EscalatedEntry) => (
    <Badge
      tone={escalationTone(referral.result.escalationCategory)}
      className="font-semibold uppercase tracking-wide"
    >
      {escalationLabel(referral.result.escalationCategory) ?? 'Escalated'}
    </Badge>
  )

  const escalatedRail = ({ referral }: EscalatedEntry): CardRail =>
    escalationTone(referral.result.escalationCategory) as CardRail

  /* Where the referral is headed, on the scan line. Confirm means "approve
   * routing to X" — X has to be visible for the button to mean anything. */
  const destination = ({ result }: { result: ReviewableReferral['result'] }) =>
    result.routedTo ? (
      <span
        className="text-dash-micro text-dash-muted"
        title={`${result.routedTo.specialistName} — ${result.routedTo.specialty}`}
      >
        <span aria-hidden className="text-dash-faint">
          →{' '}
        </span>
        <span className="font-medium text-dash-ink">{result.routedTo.specialistName}</span>
      </span>
    ) : (
      <span
        className="text-dash-micro italic text-dash-faint"
        title="The tree stopped before it reached a destination — Route… picks one"
      >
        → no destination yet
      </span>
    )

  /* The tree's own words. Its directive ("URGENT FAST-TRACK (<72h)") becomes
   * the block's heading; the criteria clamp underneath, expandable in place. */
  const escalatedPayload = ({ referral, coordinatorNote }: EscalatedEntry) => {
    const { directive, detail } = splitEscalationReason(referral.result.escalationReason)
    return (
      <ReasonBlock
        label={directive ?? 'Why the tree escalated'}
        tone={escalationTone(referral.result.escalationCategory) as ReasonTone}
        text={detail || undefined}
        extra={
          coordinatorNote ? (
            <span className="block border-l-2 border-dash-line pl-3 text-dash-body text-dash-ink">
              <span className="text-dash-muted">Coordinator:</span> “{coordinatorNote}”
            </span>
          ) : undefined
        }
      />
    )
  }

  const lowConfidencePayload = ({ referral }: LowConfidenceEntry) => {
    const { result } = referral
    const ambiguous = result.flags.ambiguousBetween
    return (
      <ReasonBlock
        label="Why the tree isn’t sure"
        tone="slate"
        /* The candidates ARE the punchline — above the prose, never clamped */
        head={
          ambiguous ? (
            <span className="font-medium">
              Could be {ambiguous[0]} or {ambiguous[1]}.
            </span>
          ) : undefined
        }
        text={result.confidenceReason}
      />
    )
  }

  /* The tree-improvement feed — the coordinator's reason quote is the point. */
  const correctedPayload = ({ correction, reviewer }: CorrectedEntry) => (
    <ReasonBlock
      label="The correction"
      tone="accent"
      head={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-dash-muted line-through">{correction.from}</span>
          <span aria-hidden className="text-dash-faint">
            →
          </span>
          <span className="font-semibold">{correction.to}</span>
          <span className="text-dash-micro text-dash-faint">by {reviewer}</span>
        </span>
      }
      text={`“${correction.reason}”`}
    />
  )

  return (
    <div className="min-h-full bg-dash-bg">
      <div className="mx-auto w-full max-w-dash-page px-6 pb-12 pt-4">
        <HandledStrip
          total={summary.total}
          approved={summary.approved}
          corrected={summary.corrected}
          sinceLabel={sinceLabel}
          onCaughtUp={markSurgeonVisit}
        />

        {allClear ? (
          <div className="mt-8 text-center">
            <p className="text-dash-row text-dash-ink">Nothing needs you.</p>
            <p className="mt-1 text-dash-body text-dash-muted">
              {summary.total} referral{summary.total === 1 ? '' : 's'} handled {sinceLabel}.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {sections.escalated.length > 0 && (
              <section className={SECTION_CARD}>
                <SectionBand
                  tone="red"
                  label="Escalated to you"
                  count={sections.escalated.length}
                  hint="The tree or a coordinator wants your call"
                  stickyTop={0}
                />
                {sections.escalated.map((entry) => (
                  <SurgeonRow
                    key={entry.referral.payload.referralId}
                    referral={entry.referral}
                    badge={escalatedBadge(entry)}
                    rail={escalatedRail(entry)}
                    meta={destination(entry.referral)}
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
              <section className={SECTION_CARD}>
                <SectionBand
                  tone="slate"
                  label="Low confidence"
                  count={sections.lowConfidence.length}
                  hint="Routed, but the tree isn't sure"
                  stickyTop={0}
                />
                {sections.lowConfidence.map((entry) => (
                  <SurgeonRow
                    key={entry.referral.payload.referralId}
                    referral={entry.referral}
                    badge={<ConfidencePill level={entry.referral.result.confidence} />}
                    rail="slate"
                    meta={destination(entry.referral)}
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
              <section className={SECTION_CARD}>
                <SectionBand
                  tone="accent"
                  label="Coordinator disagreed with the tree"
                  count={sections.corrected.length}
                  hint="Their reasons feed tree improvement"
                  stickyTop={0}
                />
                {sections.corrected.map((entry) => (
                  <SurgeonRow
                    key={entry.referral.payload.referralId}
                    referral={entry.referral}
                    rail="accent"
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
    </div>
  )
}
