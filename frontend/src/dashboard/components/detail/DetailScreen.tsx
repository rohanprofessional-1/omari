import { Fragment, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { getReferralSource } from '../../data/adapter'
import { backLabelFor } from '../../lib/useOpenReferral'
import { ageFromDob, waitingSince } from '../../lib/demoClock'
import { useDashboardStore } from '../../lib/reviewStore'
import type { ReviewStatus, ReviewableReferral } from '../../types'
import Badge, { type BadgeTone } from '../shared/Badge'
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

const REVIEW_PILL: Record<ReviewStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending review', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'green' },
  corrected: { label: 'Corrected', tone: 'accent' },
  rejected: { label: 'Rejected', tone: 'red' },
  escalated: { label: 'Escalated to surgeon', tone: 'red' },
  info_requested: { label: 'Info requested', tone: 'accent' },
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
      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-dash-micro font-semibold leading-none'
    if (state === 'done') return `${base} border-dash-accent bg-dash-accent text-white`
    if (state === 'current')
      return `${base} border-dash-accent bg-dash-surface text-dash-accent ring-4 ring-dash-accent-soft`
    return `${base} border-dash-line bg-dash-surface text-dash-muted`
  }

  return (
    <div className="w-full max-w-xs">
      <div className="flex items-center">
        {stages.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && (
              <span
                aria-hidden
                className={`h-0.5 flex-1 ${stages[i - 1].state === 'done' ? 'bg-dash-accent' : 'bg-dash-line'}`}
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
            className={`flex-1 text-center text-dash-micro leading-tight ${
              s.state === 'upcoming' ? 'text-dash-faint' : 'font-medium text-dash-ink'
            }`}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function DetailScreen() {
  const { referralId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // Which list this was opened from — set by useOpenReferral, absent on a cold
  // deep link, in which case the label degrades to a generic "← Back".
  const origin = (location.state as { from?: string } | null)?.from
  const backLabel = backLabelFor(origin)
  // navigate(-1) keeps the list's scroll position and filters; a cold deep link
  // has nothing to go back to, so send it to the section instead.
  const onBack = () => (origin ? navigate(-1) : navigate('..'))

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
    return <p className="px-4 py-8 text-center text-dash-body text-dash-muted">Loading referral…</p>
  }
  if (!referral) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-dash-body text-dash-muted">
          Referral <span className="font-medium text-dash-ink">{referralId}</span> was not found.
        </p>
        <button
          onClick={onBack}
          className="mt-3 rounded-dash-ctl border border-dash-line bg-dash-surface px-3 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink"
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
    <div className="mx-auto w-full max-w-dash-page px-6 pt-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          onClick={onBack}
          className="shrink-0 rounded-dash-ctl border border-dash-line bg-dash-surface px-3 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink"
        >
          {backLabel}
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-dash-title leading-tight text-dash-ink">
            {patient.name}{' '}
            <span className="text-dash-micro font-normal text-dash-muted">
              {ageFromDob(patient.dob)}
              {patient.sex} · {patient.mrn}
            </span>
          </h2>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ChannelBadge channel={payload.channel} />
          <span
            className="text-dash-micro tabular-nums text-dash-muted"
            title={`Received ${payload.receivedAt.replace('T', ' ')}`}
          >
            waiting {waitingSince(payload.receivedAt)}
          </span>
          <Badge tone={pill.tone}>{pill.label}</Badge>
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
