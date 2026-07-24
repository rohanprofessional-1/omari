import { useEffect, useState, type ReactNode } from 'react'
import { DASHBOARD_TREE } from '../../data/dashboardDeltas'
import type { SpecialistNode } from '../../../types/tree'
import { applyAction, reviewerNameFor, useDashboardStore } from '../../lib/reviewStore'
import type { Correction, ReviewableReferral } from '../../types'
import UrgencyBadge from '../shared/UrgencyBadge'

/**
 * Dashboard detail — the four review-action modals in one component, driven by
 * `mode`. Same shell idiom as Reconcile's SignOffModal (overlay, centered card,
 * backdrop/Escape close, header–body–footer borders).
 *
 * Every correction is STRUCTURED (field/from/to/reason) — corrections feed
 * tree improvement, so the reason never hides in a free-text note.
 */

export type ActionModalMode = 'change_destination' | 'out_of_scope' | 'request_info' | 'escalate'

type Urgency = 'routine' | 'expedited' | 'urgent'
const URGENCIES: Urgency[] = ['routine', 'expedited', 'urgent']

const MIN_REASON_CHARS = 10

const inputCls =
  'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/60'
const labelCls = 'block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted'
const primaryBtnCls =
  'rounded-md bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40'

/** Where the tree currently sends this referral, as correction `from` text. */
function currentDestination(referral: ReviewableReferral): string {
  const { result } = referral
  if (!result.inScope) return 'Out of scope'
  if (result.escalated) return 'Escalated'
  return result.routedTo?.specialistName ?? 'Unrouted (missing information)'
}

/* ── Shared shell ─────────────────────────────────────────────────────────── */

function ModalShell({
  title,
  subtitle,
  footer,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  footer: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/30 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="font-serif text-[17px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
        <div className="border-t border-line px-5 py-3.5">{footer}</div>
      </div>
    </div>
  )
}

/* ── change_destination ───────────────────────────────────────────────────── */

function ChangeDestinationModal({
  referral,
  actor,
  role,
  onClose,
}: {
  referral: ReviewableReferral
  actor: string
  role: 'coordinator' | 'surgeon' | 'admin'
  onClose: () => void
}) {
  const { result } = referral
  const terminals = DASHBOARD_TREE.nodes.filter((n): n is SpecialistNode => n.type === 'specialist')
  const [selectedId, setSelectedId] = useState<string | null>(result.routedTo?.nodeId ?? null)
  /** '' = follow the selected terminal's default urgency. */
  const [urgency, setUrgency] = useState<Urgency | ''>('')
  const [reason, setReason] = useState('')

  const chosen = terminals.find((t) => t.id === selectedId) ?? null
  const effectiveUrgency: Urgency | null = chosen ? (urgency || chosen.urgency) : null
  const urgencyChanged = chosen !== null && urgency !== '' && urgency !== chosen.urgency
  const reasonShort = Math.max(0, MIN_REASON_CHARS - reason.trim().length)
  const valid = chosen !== null && reasonShort === 0

  const submit = () => {
    if (!chosen || !valid) return
    /* Disagreeing with an out-of-scope conclusion is a SCOPE correction —
     * the clinic is saying "this belongs here after all". */
    const correction: Correction = {
      field: result.inScope ? 'destination' : 'scope',
      from: currentDestination(referral),
      to: chosen.specialistName + (urgencyChanged ? ` · urgency: ${effectiveUrgency}` : ''),
      reason: reason.trim(),
    }
    applyAction(referral.payload.referralId, 'corrected', { actor, role, correction })
    onClose()
  }

  return (
    <ModalShell
      title={result.inScope ? 'Change destination' : 'Route in clinic'}
      subtitle={`Currently: ${currentDestination(referral)}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted">
            {reasonShort > 0
              ? `Reason needs ${reasonShort} more character${reasonShort === 1 ? '' : 's'}`
              : chosen
                ? 'Recorded as a structured correction — it feeds tree improvement.'
                : 'Pick a destination.'}
          </p>
          <button onClick={submit} disabled={!valid} className={primaryBtnCls}>
            Save correction
          </button>
        </div>
      }
    >
      <fieldset>
        <legend className={labelCls}>New destination</legend>
        <div className="mt-1.5 space-y-1">
          {terminals.map((t, i) => {
            const checked = t.id === selectedId
            return (
              <label
                key={t.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 ${
                  checked ? 'border-accent bg-accent/5' : 'border-line hover:bg-bg'
                }`}
              >
                <input
                  type="radio"
                  name="destination"
                  autoFocus={checked || (selectedId === null && i === 0)}
                  checked={checked}
                  onChange={() => {
                    setSelectedId(t.id)
                    setUrgency('') // reset override to the terminal's default
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {t.specialistName}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">{t.specialty}</span>
                </span>
                <UrgencyBadge urgency={t.urgency} />
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-3">
        <label className={labelCls} htmlFor="urgency-override">
          Urgency
        </label>
        <select
          id="urgency-override"
          className="mt-1 rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] text-ink"
          disabled={!chosen}
          value={effectiveUrgency ?? 'routine'}
          onChange={(e) => setUrgency(e.target.value as Urgency)}
        >
          {URGENCIES.map((u) => (
            <option key={u} value={u}>
              {u}
              {chosen && u === chosen.urgency ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <label className={labelCls} htmlFor="correction-reason">
          Why? <span className="normal-case tracking-normal">(required)</span>
        </label>
        <textarea
          id="correction-reason"
          rows={3}
          className={`mt-1 ${inputCls}`}
          placeholder="Clinical reason for overriding the tree's routing…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </ModalShell>
  )
}

/* ── out_of_scope ─────────────────────────────────────────────────────────── */

function OutOfScopeModal({
  referral,
  actor,
  role,
  onClose,
}: {
  referral: ReviewableReferral
  actor: string
  role: 'coordinator' | 'surgeon' | 'admin'
  onClose: () => void
}) {
  const { result } = referral
  const [redirect, setRedirect] = useState(result.suggestedRedirect ?? '')
  const [note, setNote] = useState('')
  const valid = redirect.trim().length > 0

  const submit = () => {
    if (!valid) return
    applyAction(referral.payload.referralId, 'rejected', {
      actor,
      role,
      correction: {
        field: 'scope',
        from: result.routedTo?.specialistName ?? 'unrouted',
        to: redirect.trim(),
        reason: note.trim() || 'Out of scope for this clinic',
      },
    })
    onClose()
  }

  return (
    <ModalShell
      title="Mark out of scope"
      subtitle="Rejects the referral and records where it should go instead."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted">
            {valid ? 'The redirect is captured with the rejection.' : 'A redirect is required.'}
          </p>
          <button onClick={submit} disabled={!valid} className={primaryBtnCls}>
            Reject — out of scope
          </button>
        </div>
      }
    >
      <label className={labelCls} htmlFor="oos-redirect">
        Where should this go instead? <span className="normal-case tracking-normal">(required)</span>
      </label>
      <input
        id="oos-redirect"
        autoFocus
        className={`mt-1 ${inputCls}`}
        placeholder="e.g. Movement disorders neurology"
        value={redirect}
        onChange={(e) => setRedirect(e.target.value)}
      />
      <label className={`mt-3 ${labelCls}`} htmlFor="oos-note">
        Note <span className="normal-case tracking-normal">(optional)</span>
      </label>
      <textarea
        id="oos-note"
        rows={3}
        className={`mt-1 ${inputCls}`}
        placeholder="Why this clinic isn't the right destination…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </ModalShell>
  )
}

/* ── request_info ─────────────────────────────────────────────────────────── */

function RequestInfoModal({
  referral,
  actor,
  role,
  onClose,
}: {
  referral: ReviewableReferral
  actor: string
  role: 'coordinator' | 'surgeon' | 'admin'
  onClose: () => void
}) {
  const missing = referral.result.missingVariables
  const [checked, setChecked] = useState<Set<string>>(new Set(missing.map((m) => m.variableKey)))
  const [freeText, setFreeText] = useState('')

  const selected = missing.filter((m) => checked.has(m.variableKey))
  const recipient = selected[0]?.whoCanSupply ?? 'referring office'
  const valid = selected.length > 0 || freeText.trim().length > 0

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const submit = () => {
    if (!valid) return
    const parts = selected.map((m) => m.clinicalPrompt)
    const note =
      `Requested from ${recipient}: ` +
      [...parts, freeText.trim()].filter(Boolean).join(' · ')
    applyAction(referral.payload.referralId, 'info_requested', { actor, role, note })
    onClose()
  }

  return (
    <ModalShell
      title="Request information"
      subtitle="Demo — the request is logged to the audit trail; nothing is actually sent."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted">
            {valid ? 'The referral stays in Needs information until it arrives.' : 'Pick an item or describe what you need.'}
          </p>
          <button
            onClick={submit}
            disabled={!valid}
            title="Demo: records the request in the audit trail"
            className={primaryBtnCls}
          >
            Send request to {recipient}
          </button>
        </div>
      }
    >
      {missing.length > 0 && (
        <fieldset>
          <legend className={labelCls}>Missing items</legend>
          <div className="mt-1.5 space-y-1">
            {missing.map((m, i) => (
              <label
                key={m.variableKey}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2 hover:bg-bg"
              >
                <input
                  type="checkbox"
                  autoFocus={i === 0}
                  className="mt-0.5"
                  checked={checked.has(m.variableKey)}
                  onChange={() => toggle(m.variableKey)}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] leading-snug text-ink">{m.clinicalPrompt}</span>
                  <span className="block text-[11px] text-muted">supplied by {m.whoCanSupply}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className={`${missing.length > 0 ? 'mt-3 ' : ''}${labelCls}`} htmlFor="info-freetext">
        What do you need?
      </label>
      <textarea
        id="info-freetext"
        rows={3}
        autoFocus={missing.length === 0}
        className={`mt-1 ${inputCls}`}
        placeholder="Anything else to ask for…"
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
      />
    </ModalShell>
  )
}

/* ── escalate ─────────────────────────────────────────────────────────────── */

function EscalateModal({
  referral,
  actor,
  role,
  onClose,
}: {
  referral: ReviewableReferral
  actor: string
  role: 'coordinator' | 'surgeon' | 'admin'
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const valid = note.trim().length > 0

  const submit = () => {
    if (!valid) return
    applyAction(referral.payload.referralId, 'escalated', { actor, role, note: note.trim() })
    onClose()
  }

  return (
    <ModalShell
      title="Escalate to surgeon"
      subtitle="Moves this referral to the surgeon's review list."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end">
          <button onClick={submit} disabled={!valid} className={primaryBtnCls}>
            Escalate
          </button>
        </div>
      }
    >
      <label className={labelCls} htmlFor="escalate-note">
        What should the surgeon look at? <span className="normal-case tracking-normal">(required)</span>
      </label>
      <textarea
        id="escalate-note"
        rows={4}
        autoFocus
        className={`mt-1 ${inputCls}`}
        placeholder="The question you want the surgeon to settle…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </ModalShell>
  )
}

/* ── Dispatcher ───────────────────────────────────────────────────────────── */

export default function ActionModal({
  mode,
  referral,
  onClose,
}: {
  mode: ActionModalMode
  referral: ReviewableReferral
  onClose: () => void
}) {
  const { role } = useDashboardStore()
  const actor = reviewerNameFor(role)
  const shared = { referral, actor, role, onClose }

  switch (mode) {
    case 'change_destination':
      return <ChangeDestinationModal {...shared} />
    case 'out_of_scope':
      return <OutOfScopeModal {...shared} />
    case 'request_info':
      return <RequestInfoModal {...shared} />
    case 'escalate':
      return <EscalateModal {...shared} />
  }
}
