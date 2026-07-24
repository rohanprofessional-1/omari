import { Fragment, useEffect, useState } from 'react'
import { getReferralSource } from '../../data/adapter'
import { ageFromDob, waitingSince } from '../../lib/demoClock'
import { useDashboardStore } from '../../lib/reviewStore'
import type { ReviewStatus, ReviewableReferral } from '../../types'
import ChannelBadge from '../shared/ChannelBadge'
import ActionBar from './ActionBar'
import ActionModal, { type ActionModalMode } from './ActionModal'
import ConclusionPanel from './ConclusionPanel'
import IncomingPanel from './IncomingPanel'

/**
 * Dashboard detail — one referral. Left column: what came in (the referrer's
 * document). Right column: what the tree concluded and why. The sticky
 * ActionBar at the bottom carries the decision (approve / correct / reject /
 * request info / escalate); structured input happens in ActionModal. After an
 * action the screen stays open showing the new state.
 */

const REVIEW_PILL: Record<ReviewStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending review', cls: 'border border-line bg-bg text-muted' },
  approved: { label: 'Approved', cls: 'bg-success-soft text-success-deep' },
  corrected: { label: 'Corrected', cls: 'bg-accent/10 text-accent-strong' },
  rejected: { label: 'Rejected', cls: 'bg-danger/10 text-danger' },
  escalated: { label: 'Escalated to surgeon', cls: 'bg-danger/10 text-danger' },
  info_requested: { label: 'Info requested', cls: 'bg-sky text-accent-strong' },
}

/**
 * Local 4-stage stepper in the visual style of Runner's StatusStepper (whose
 * stages are hardcoded to the patient journey, so it can't be reused here):
 * Received → Analyzed → In review → Decided.
 */
function ReviewStepper({ decided }: { decided: boolean }) {
  const current = decided ? 3 : 2
  const stages = ['Received', 'Analyzed', 'In review', 'Decided'].map((label, i) => ({
    label,
    state: i < current ? ('done' as const) : i === current ? ('current' as const) : ('upcoming' as const),
  }))

  const dotClass = (state: 'done' | 'current' | 'upcoming') => {
    const base =
      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold'
    if (state === 'done') return `${base} border-accent bg-accent text-white`
    if (state === 'current') return `${base} border-accent bg-canvas text-accent ring-4 ring-accent/15`
    return `${base} border-line bg-canvas text-muted`
  }

  return (
    <div className="w-full max-w-xs">
      <div className="flex items-center">
        {stages.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && (
              <span
                aria-hidden
                className={`h-0.5 flex-1 ${stages[i - 1].state === 'done' ? 'bg-accent' : 'bg-line'}`}
              />
            )}
            <span className={dotClass(s.state)}>{s.state === 'done' ? '✓' : i + 1}</span>
          </Fragment>
        ))}
      </div>
      <div className="mt-1 flex">
        {stages.map((s) => (
          <span
            key={s.label}
            className={`flex-1 text-center text-[9.5px] leading-tight ${
              s.state === 'upcoming' ? 'text-muted' : 'font-medium text-ink'
            }`}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function DetailScreen({
  referralId,
  onBack,
  backLabel = '← Queue',
}: {
  referralId: string
  onBack: () => void
  /** Back-button text — reflects where the referral was opened from. */
  backLabel?: string
}) {
  const { reviews } = useDashboardStore()
  const [referral, setReferral] = useState<ReviewableReferral | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalMode, setModalMode] = useState<ActionModalMode | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReferral(null)
    getReferralSource()
      .getReferral(referralId)
      .then((r) => {
        if (cancelled) return
        setReferral(r)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [referralId])

  if (loading) {
    return <p className="px-4 py-8 text-center text-[13px] text-muted">Loading referral…</p>
  }
  if (!referral) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[13px] text-muted">
          Referral <span className="font-medium text-ink">{referralId}</span> was not found.
        </p>
        <button
          onClick={onBack}
          className="mt-3 rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:text-ink"
        >
          {backLabel}
        </button>
      </div>
    )
  }

  const { payload } = referral
  const { patient } = payload
  const review = reviews[referralId]
  const status: ReviewStatus = review?.status ?? 'pending'
  const pill = REVIEW_PILL[status]

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          onClick={onBack}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:text-ink"
        >
          {backLabel}
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-serif text-[16px] font-semibold leading-tight text-ink">
            {patient.name}{' '}
            <span className="font-sans text-[12.5px] font-normal text-muted">
              {ageFromDob(patient.dob)}
              {patient.sex} · {patient.mrn}
            </span>
          </h2>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ChannelBadge channel={payload.channel} />
          <span
            className="text-[11.5px] tabular-nums text-muted"
            title={`Received ${payload.receivedAt.replace('T', ' ')}`}
          >
            waiting {waitingSince(payload.receivedAt)}
          </span>
          <span className={`inline-flex rounded px-1.5 py-0.5 text-[10.5px] font-medium ${pill.cls}`}>
            {pill.label}
          </span>
        </div>
      </div>

      {/* Lifecycle stepper */}
      <div className="mt-3">
        <ReviewStepper decided={status !== 'pending'} />
      </div>

      {/* Two-column split — right (conclusion) slightly wider */}
      <div className="mt-4 grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-4">
        <div className="min-h-0 overflow-y-auto">
          <IncomingPanel payload={payload} />
        </div>
        <div className="min-h-0 overflow-y-auto">
          <ConclusionPanel referral={referral} onOpenModal={setModalMode} />
        </div>
      </div>

      {/* Decision layer */}
      <ActionBar
        referral={referral}
        review={review}
        modalOpen={modalMode !== null}
        onOpenModal={setModalMode}
      />
      {modalMode && (
        <ActionModal mode={modalMode} referral={referral} onClose={() => setModalMode(null)} />
      )}
    </div>
  )
}
