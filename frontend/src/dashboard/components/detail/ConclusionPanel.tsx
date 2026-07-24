import type { ReactNode } from 'react'
import type { ReviewableReferral, TreeResult } from '../../types'
import ConfidencePill from '../shared/ConfidencePill'
import SectionCard from '../shared/SectionCard'
import UrgencyBadge from '../shared/UrgencyBadge'
import AuditTrail from './AuditTrail'
import DecisionChain, { CitationToggle, OverrideBadge, OverrideDetails } from './DecisionChain'
import MissingVariableCard from './MissingVariableCard'
import WorkupList from './WorkupList'

/**
 * Dashboard detail, right column — "what the tree concluded and why": the
 * conclusion header (routed / out-of-scope / escalated / paused), the decision
 * chain as plain clinical reasoning, the blocking variable when there is one,
 * the resolved workup, and the review audit trail. The ten-second surface.
 */

/* ── Conclusion header variants ───────────────────────────────────────────── */

function HeaderCard({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-xl border p-4 ${className}`}>{children}</section>
}

function RoutedHeader({ result }: { result: TreeResult }) {
  const routed = result.routedTo!
  return (
    <HeaderCard className="border-line bg-canvas">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="font-serif text-[19px] font-semibold leading-tight text-ink">
          → {routed.specialistName}
        </p>
        {result.terminalOverridden && <OverrideBadge />}
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted">{routed.specialty}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {result.urgency && <UrgencyBadge urgency={result.urgency} />}
        <ConfidencePill level={result.confidence} />
        {result.confirmWithDrLi && (
          <span className="inline-flex rounded bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium text-accent-strong">
            Confirm with Dr. Li
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-muted">{result.confidenceReason}</p>
      {result.terminalCitation && (
        <div className="mt-1.5">
          <CitationToggle quote={result.terminalCitation} label="clinical basis" />
        </div>
      )}
      {result.terminalOverridden && <OverrideDetails nodeId={routed.nodeId} />}
    </HeaderCard>
  )
}

function OutOfScopeHeader({ result }: { result: TreeResult }) {
  return (
    <HeaderCard className="border-danger/40 bg-canvas">
      <p className="font-serif text-[17px] font-semibold leading-tight text-ink">
        Likely out of scope for this clinic
      </p>
      {result.scopeReason && (
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{result.scopeReason}</p>
      )}
      {result.suggestedRedirect && (
        <p className="mt-1.5 text-[13px] text-ink">
          Suggested: <span className="font-medium">{result.suggestedRedirect}</span>
        </p>
      )}
      <p className="mt-2 border-t border-line pt-2 text-[11.5px] leading-snug text-muted">
        Requires human confirmation — never auto-rejected.
      </p>
    </HeaderCard>
  )
}

const ESCALATION_CHIP: Record<'emergency' | 'ambiguous' | 'complex', string> = {
  emergency: 'bg-danger/10 font-semibold uppercase tracking-[0.05em] text-danger',
  ambiguous: 'bg-accent/10 font-medium text-accent-strong',
  complex: 'bg-accent/10 font-medium text-accent-strong',
}

function EscalatedHeader({ result }: { result: TreeResult }) {
  return (
    <HeaderCard className="border-danger/40 bg-canvas">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="font-serif text-[17px] font-semibold leading-tight text-ink">
          No confident path — needs surgeon review
        </p>
        {result.escalationCategory && (
          <span
            className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10.5px] ${ESCALATION_CHIP[result.escalationCategory]}`}
          >
            {result.escalationCategory}
          </span>
        )}
      </div>
      {result.escalationReason && (
        <p className="mt-1.5 text-[12.5px] leading-snug text-ink">{result.escalationReason}</p>
      )}
    </HeaderCard>
  )
}

function NeedsInfoHeader({ result }: { result: TreeResult }) {
  const missing = result.missingVariables[0]
  return (
    <HeaderCard className="border-line bg-canvas">
      <p className="font-serif text-[17px] font-semibold leading-tight text-ink">
        Analysis paused — missing information
      </p>
      {missing && (
        <p className="mt-1.5 text-[12.5px] leading-snug text-muted">
          Routing resumes automatically once{' '}
          <span className="font-medium text-ink">{missing.question}</span> is answered.
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

function MismatchStrip({ referral }: { referral: ReviewableReferral }) {
  return (
    <div className="rounded-lg bg-accent/10 px-3 py-2 text-[12px] leading-snug text-ink">
      <span className="font-semibold text-accent-strong">Differs from referrer's ask:</span>{' '}
      referrer requested{' '}
      <span className="font-medium">“{referral.payload.reasonForReferral}”</span> — the tree
      concluded <span className="font-medium">{conclusionSummary(referral.result)}</span>.
    </div>
  )
}

/* ── The panel ────────────────────────────────────────────────────────────── */

export default function ConclusionPanel({ referral }: { referral: ReviewableReferral }) {
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
      {result.flags.statedReasonMismatch && <MismatchStrip referral={referral} />}

      <SectionCard title="Decision path">
        <DecisionChain result={result} />
      </SectionCard>

      {result.missingVariables.map((info) => (
        <MissingVariableCard key={info.variableKey} info={info} />
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
