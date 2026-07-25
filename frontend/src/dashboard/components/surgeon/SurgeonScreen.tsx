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
import Badge, { type BadgeTone } from '../shared/Badge'
import ConfidencePill from '../shared/ConfidencePill'
import SurgeonRow, {
  CommentButton,
  surgeonBtnOutline,
  surgeonBtnPrimary,
  type CardRail,
} from './SurgeonRow'
import { useOpenReferral } from '../../lib/useOpenReferral'

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

/** Flag color per category — calm clinical palette, badge + rail only. */
const ESCALATION_TONES: Record<string, BadgeTone & CardRail> = {
  emergency: 'red',
  ambiguous: 'amber',
  complex: 'slate',
}

/** Band-header idiom shared with the queue: dot · label · count · explainer. */
const SECTION_DOTS = {
  red: 'bg-dash-red',
  slate: 'bg-dash-slate',
  accent: 'bg-dash-accent',
} as const

function SectionHeader({
  dot,
  label,
  count,
  hint,
}: {
  dot: keyof typeof SECTION_DOTS
  label: string
  count: number
  hint: string
}) {
  return (
    <header className="mb-2 flex items-center gap-2">
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${SECTION_DOTS[dot]}`} />
      <h2 className="text-dash-band uppercase text-dash-strong">{label}</h2>
      <span className="text-dash-band tabular-nums text-dash-faint">{count}</span>
      <p className="hidden min-w-0 truncate text-dash-micro text-dash-faint md:block">{hint}</p>
    </header>
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
    <div className="flex flex-wrap items-center gap-3 rounded-dash-card border border-dash-line bg-dash-surface px-4 py-3 shadow-dash-card">
      <p className="text-dash-body text-dash-strong">
        {total === 0 ? (
          <>Nothing handled {sinceLabel} yet.</>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-dash-green">
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

  /* Flag-type badge at the card top — colored per the calm status palette. */
  const escalatedBadge = ({ referral }: EscalatedEntry) => {
    const { result } = referral
    if (!result.escalationCategory) return undefined
    const category =
      ESCALATION_CATEGORY_LABELS[result.escalationCategory] ?? result.escalationCategory
    return (
      <Badge
        tone={ESCALATION_TONES[result.escalationCategory] ?? 'red'}
        className="font-semibold uppercase tracking-wide"
      >
        {category}
      </Badge>
    )
  }

  const escalatedRail = ({ referral }: EscalatedEntry): CardRail =>
    (referral.result.escalationCategory &&
      ESCALATION_TONES[referral.result.escalationCategory]) ||
    'red'

  const escalatedPayload = ({ referral, coordinatorNote }: EscalatedEntry) => {
    const { result } = referral
    return (
      <>
        {result.escalationReason && <span className="block">{result.escalationReason}</span>}
        {coordinatorNote && (
          <span className="mt-2 block border-l-2 border-dash-line pl-3 text-dash-ink">
            <span className="text-dash-muted">Coordinator:</span> “{coordinatorNote}”
          </span>
        )}
      </>
    )
  }

  const lowConfidencePayload = ({ referral }: LowConfidenceEntry) => {
    const { result } = referral
    const ambiguous = result.flags.ambiguousBetween
    return (
      <>
        <span className="block">{result.confidenceReason}</span>
        {/* Suggested destination — distinct placement + weight, not new words */}
        {ambiguous && (
          <span className="mt-1 block font-medium text-dash-ink">
            Could be {ambiguous[0]} or {ambiguous[1]}.
          </span>
        )}
      </>
    )
  }

  /* The tree-improvement feed — the coordinator's reason quote is the point. */
  const correctedPayload = ({ correction, reviewer }: CorrectedEntry) => (
    <>
      <span className="block">
        Tree said <span className="font-medium text-dash-ink">{correction.from}</span> →{' '}
        <span className="text-dash-muted">{reviewer}</span> sent to{' '}
        <span className="font-medium text-dash-ink">{correction.to}</span>:
      </span>
      <span className="mt-2 block border-l-2 border-dash-accent pl-3 font-medium text-dash-ink">
        “{correction.reason}”
      </span>
    </>
  )

  return (
    <div className="min-h-full bg-dash-bg">
      <div className="mx-auto w-full max-w-dash-page p-6">
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
          <div className="mt-6 space-y-6">
            {sections.escalated.length > 0 && (
              <section>
                <SectionHeader
                  dot="red"
                  label="Escalated to you"
                  count={sections.escalated.length}
                  hint="The tree or a coordinator wants your call"
                />
                <div className="space-y-3">
                  {sections.escalated.map((entry) => (
                    <SurgeonRow
                      key={entry.referral.payload.referralId}
                      referral={entry.referral}
                      badge={escalatedBadge(entry)}
                      rail={escalatedRail(entry)}
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
                </div>
              </section>
            )}

            {sections.lowConfidence.length > 0 && (
              <section>
                <SectionHeader
                  dot="slate"
                  label="Low confidence"
                  count={sections.lowConfidence.length}
                  hint="Routed, but the tree isn't sure"
                />
                <div className="space-y-3">
                  {sections.lowConfidence.map((entry) => (
                    <SurgeonRow
                      key={entry.referral.payload.referralId}
                      referral={entry.referral}
                      badge={<ConfidencePill level={entry.referral.result.confidence} />}
                      rail="slate"
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
                </div>
              </section>
            )}

            {sections.corrected.length > 0 && (
              <section>
                <SectionHeader
                  dot="accent"
                  label="Coordinator disagreed with the tree"
                  count={sections.corrected.length}
                  hint="Their reasons feed tree improvement"
                />
                <div className="space-y-3">
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
                </div>
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
