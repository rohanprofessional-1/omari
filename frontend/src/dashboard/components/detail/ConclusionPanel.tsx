import type { ReactNode } from 'react'
import type { ReviewableReferral, TreeResult } from '../../types'
import type { ActionModalMode } from './ActionModal'
import Badge from '../shared/Badge'
import ConfidencePill from '../shared/ConfidencePill'
import SectionCard from '../shared/SectionCard'
import UrgencyBadge from '../shared/UrgencyBadge'
import AuditTrail from './AuditTrail'
import DecisionChain, { CitationToggle, OverrideBadge, OverrideDetails } from './DecisionChain'
import MissingVariableCard from './MissingVariableCard'
import WorkupList from './WorkupList'
import { escalationTone } from '../shared/escalationPalette'

/**
 * Dashboard detail, right column — "what the tree concluded and why": the
 * conclusion header (routed / out-of-scope / escalated / paused), the decision
 * chain as plain clinical reasoning, the blocking variable when there is one,
 * the resolved workup, and the review audit trail. The ten-second surface.
 */

/* ── Conclusion header variants ───────────────────────────────────────────── */

function HeaderCard({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={`rounded-dash-card border border-dash-line bg-dash-surface p-4 shadow-dash-card ${className}`}
    >
      {children}
    </section>
  )
}

function RoutedHeader({ result }: { result: TreeResult }) {
  const routed = result.routedTo!
  return (
    <HeaderCard>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-dash-title leading-tight text-dash-ink">→ {routed.specialistName}</p>
        {result.terminalOverridden && <OverrideBadge />}
      </div>
      <p className="mt-1 text-dash-body text-dash-muted">{routed.specialty}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {result.urgency && <UrgencyBadge urgency={result.urgency} />}
        <ConfidencePill level={result.confidence} />
        {result.confirmWithDrLi && <Badge tone="accent">Confirm with Dr. Li</Badge>}
      </div>
      <p className="mt-2 max-w-prose text-dash-micro leading-snug text-dash-muted">
        {result.confidenceReason}
      </p>
      {result.terminalCitation && (
        <div className="mt-2">
          <CitationToggle quote={result.terminalCitation} label="clinical basis" />
        </div>
      )}
      {result.terminalOverridden && <OverrideDetails nodeId={routed.nodeId} />}
    </HeaderCard>
  )
}

function OutOfScopeHeader({ result }: { result: TreeResult }) {
  return (
    <HeaderCard>
      <p className="text-dash-title leading-tight text-dash-ink">
        Likely out of scope for this clinic
      </p>
      {result.scopeReason && (
        <p className="mt-1 max-w-prose text-dash-body leading-relaxed text-dash-muted">
          {result.scopeReason}
        </p>
      )}
      {result.suggestedRedirect && (
        <p className="mt-2 text-dash-body text-dash-ink">
          Suggested: <span className="font-medium">{result.suggestedRedirect}</span>
        </p>
      )}
      <p className="mt-2 border-t border-dash-line pt-2 text-dash-micro leading-snug text-dash-muted">
        Requires human confirmation — never auto-rejected.
      </p>
    </HeaderCard>
  )
}

function EscalatedHeader({ result }: { result: TreeResult }) {
  return (
    <HeaderCard className="border-l-2 border-l-dash-red">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-dash-title leading-tight text-dash-ink">
          No confident path — needs surgeon review
        </p>
        {result.escalationCategory && (
          <Badge
            tone={escalationTone(result.escalationCategory)}
            className={
              result.escalationCategory === 'emergency'
                ? 'font-semibold uppercase tracking-wide'
                : ''
            }
          >
            {result.escalationCategory}
          </Badge>
        )}
      </div>
      {result.escalationReason && (
        <p className="mt-2 max-w-prose text-dash-body leading-relaxed text-dash-strong">
          {result.escalationReason}
        </p>
      )}
    </HeaderCard>
  )
}

function NeedsInfoHeader({ result }: { result: TreeResult }) {
  const missing = result.missingVariables[0]
  return (
    <HeaderCard>
      <p className="text-dash-title leading-tight text-dash-ink">
        Analysis paused — missing information
      </p>
      {missing && (
        <p className="mt-2 max-w-prose text-dash-body leading-relaxed text-dash-muted">
          Routing resumes automatically once{' '}
          <span className="font-medium text-dash-ink">{missing.question}</span> is answered.
        </p>
      )}
    </HeaderCard>
  )
}

/* ── Referrer-vs-tree mismatch strip — the product working out loud ───────── */

function conclusionSummary(result: TreeResult): string {
  if (!result.inScope) return `out of scope — suggested ${result.suggestedRedirect ?? 'redirect'}`
  if (result.escalated) return 'escalation for surgeon review'
  if (result.routedTo) return `${result.routedTo.specialistName} (${result.routedTo.specialty})`
  return 'a pause for missing information'
}

function MismatchStrip({
  referral,
  onChangeDestination,
}: {
  referral: ReviewableReferral
  onChangeDestination?: () => void
}) {
  return (
    <div className="rounded-dash-ctl bg-dash-accent-soft px-3 py-2 text-dash-body leading-relaxed text-dash-ink">
      <span className="font-semibold text-dash-accent-strong">Differs from referrer's ask:</span>{' '}
      referrer requested{' '}
      <span className="font-medium">“{referral.payload.reasonForReferral}”</span> — the tree
      concluded <span className="font-medium">{conclusionSummary(referral.result)}</span>.
      {onChangeDestination && (
        <>
          {' '}
          <button
            onClick={onChangeDestination}
            className="font-medium text-dash-accent-strong underline decoration-dash-accent/40 underline-offset-2 hover:decoration-dash-accent-strong"
          >
            Change destination
          </button>
        </>
      )}
    </div>
  )
}

/* ── The panel ────────────────────────────────────────────────────────────── */

export default function ConclusionPanel({
  referral,
  onOpenModal,
}: {
  referral: ReviewableReferral
  onOpenModal?: (mode: ActionModalMode) => void
}) {
  const { payload, result } = referral
  const header = !result.inScope ? (
    <OutOfScopeHeader result={result} />
  ) : result.escalated ? (
    <EscalatedHeader result={result} />
  ) : result.routedTo ? (
    <RoutedHeader result={result} />
  ) : (
    <NeedsInfoHeader result={result} />
  )

  return (
    <div className="space-y-3">
      {header}
      {result.flags.statedReasonMismatch && (
        <MismatchStrip
          referral={referral}
          onChangeDestination={onOpenModal && (() => onOpenModal('change_destination'))}
        />
      )}

      <SectionCard title="Decision path">
        <DecisionChain result={result} />
      </SectionCard>

      {result.missingVariables.map((info) => (
        <MissingVariableCard
          key={info.variableKey}
          info={info}
          onRequest={onOpenModal && (() => onOpenModal('request_info'))}
        />
      ))}

      <SectionCard title="Pre-visit workup">
        <WorkupList
          referralId={payload.referralId}
          items={result.requiredWorkup}
          withheld={result.resolvedWorkup?.withheld ?? []}
          visitDate={result.visitDate}
        />
      </SectionCard>

      <SectionCard title="Review activity">
        <AuditTrail referralId={payload.referralId} />
      </SectionCard>
    </div>
  )
}
