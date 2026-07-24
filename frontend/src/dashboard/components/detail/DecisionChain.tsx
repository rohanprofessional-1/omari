import { useState, type ReactNode } from 'react'
import { overrideInfoForNode } from '../../data/dashboardDeltas'
import type { DecisionStep, TreeResult, VariableSource } from '../../types'

/**
 * Dashboard detail — THE core surface: the tree's decision path rendered as
 * plain clinical reasoning a surgeon can scan in ten seconds. One compact row
 * per decision step on a vertical timeline, ending with the conclusion itself
 * so the chain reads complete. Citations (the node's clinical prompt) and
 * clinic-override provenance stay collapsed by default.
 */

const SOURCE_LABELS: Record<VariableSource | 'unknown', string> = {
  note: 'from referral note',
  attachment: 'from attached document',
  structured: 'from structured data',
  'referrer-stated': 'stated by referrer',
  unknown: 'source unknown',
}

/* ── Shared bits (also used by the conclusion header card) ────────────────── */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

/** Ghost 'guideline' button toggling an inset quote of the clinical prompt. */
export function CitationToggle({ quote, label = 'guideline' }: { quote: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-muted transition-colors hover:bg-bg hover:text-ink"
      >
        <Chevron open={open} />
        {label}
      </button>
      {open && (
        <blockquote className="mt-1 border-l-2 border-line pl-2 text-[12px] italic leading-snug text-muted">
          {quote}
        </blockquote>
      )}
    </>
  )
}

/** Tiny 'Clinic override' pill — solid so a deviation from the CPG pops. */
export function OverrideBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-accent-strong px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-white">
      Clinic override
    </span>
  )
}

/**
 * Expandable provenance for a clinic-overridden node: who changed it, why,
 * and the struck-through CPG text the clinic's rule replaced.
 */
export function OverrideDetails({ nodeId }: { nodeId: string }) {
  const [open, setOpen] = useState(false)
  const info = overrideInfoForNode(nodeId)
  if (!info) return null
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-accent-strong transition-colors hover:bg-sky"
      >
        <Chevron open={open} />
        why the clinic overrode this
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-line bg-bg px-2.5 py-2">
          <p className="text-[12px] leading-snug text-ink">
            <span className="font-medium">{info.author}:</span> {info.rationale}
          </p>
          {info.cpgBasis && (
            <p className="text-[11px] leading-snug text-muted line-through decoration-muted/60">
              CPG: {info.cpgBasis}
            </p>
          )}
          <p className="text-[11px] font-medium leading-snug text-accent-strong">
            Clinic rule: {info.opSummary}
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Timeline scaffolding ─────────────────────────────────────────────────── */

function ChainRow({
  last,
  dot,
  children,
}: {
  last: boolean
  dot: ReactNode
  children: ReactNode
}) {
  return (
    <li className="relative flex gap-2.5 pb-3 last:pb-0">
      {/* hairline connector down to the next node dot */}
      {!last && <span aria-hidden className="absolute left-[4.5px] top-3 bottom-0 w-px bg-line" />}
      <span className="relative mt-[5px] flex h-2.5 w-2.5 shrink-0 items-center justify-center">
        {dot}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  )
}

function StepDot({ overridden }: { overridden: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-2 w-2 rounded-full border ${
        overridden ? 'border-accent-strong bg-accent-strong' : 'border-accent bg-canvas'
      }`}
    />
  )
}

/* ── One decision step ────────────────────────────────────────────────────── */

function StepRow({ step, last }: { step: DecisionStep; last: boolean }) {
  return (
    <ChainRow last={last} dot={<StepDot overridden={step.overridden} />}>
      <p className="text-[13px] leading-snug text-ink">
        {step.label} — <span className="font-semibold">{step.answer}</span>
        {step.overridden && (
          <span className="ml-1.5 align-[1px]">
            <OverrideBadge />
          </span>
        )}
      </p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted">
        <span>{SOURCE_LABELS[step.source]}</span>
        {typeof step.confidence === 'number' && (
          <>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{Math.round(step.confidence * 100)}%</span>
          </>
        )}
        {step.citation && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-block">
              <CitationToggle quote={step.citation} />
            </span>
          </>
        )}
      </div>
      {step.overridden && <OverrideDetails nodeId={step.nodeId} />}
    </ChainRow>
  )
}

/* ── The conclusion as the final row, so the chain reads complete ─────────── */

function conclusionFor(result: TreeResult): {
  tone: 'accent' | 'danger'
  primary: ReactNode
  secondary?: string
} {
  if (!result.inScope) {
    return {
      tone: 'danger',
      primary: (
        <>
          Flagged <span className="font-semibold">likely out of scope</span>
          {result.suggestedRedirect && <> — suggested {result.suggestedRedirect}</>}
        </>
      ),
      secondary: result.scopeReason,
    }
  }
  if (result.escalated) {
    return {
      tone: 'danger',
      primary: (
        <>
          Escalated — <span className="font-semibold">needs surgeon review</span>
        </>
      ),
      secondary: result.escalationReason,
    }
  }
  if (result.routedTo) {
    return {
      tone: 'accent',
      primary: (
        <>
          Routed to <span className="font-semibold">{result.routedTo.specialistName}</span> —{' '}
          {result.routedTo.specialty}
        </>
      ),
    }
  }
  const missing = result.missingVariables[0]
  return {
    tone: 'danger',
    primary: (
      <>
        Paused — <span className="font-semibold">awaiting information</span>
      </>
    ),
    secondary: missing ? `Waiting on: ${missing.question}` : undefined,
  }
}

export default function DecisionChain({ result }: { result: TreeResult }) {
  const steps = result.pathTaken
  const conclusion = conclusionFor(result)
  const terminalNodeId = result.terminalOverridden ? result.routedTo?.nodeId : undefined

  if (steps.length === 0 && !result.escalated) {
    return <p className="text-[12.5px] text-muted">No decision steps recorded.</p>
  }

  return (
    <ol className="list-none">
      {steps.map((step, i) => (
        <StepRow key={`${step.nodeId}-${i}`} step={step} last={false} />
      ))}
      <ChainRow
        last
        dot={
          <span
            aria-hidden
            className={`h-2.5 w-2.5 rounded-full ${
              conclusion.tone === 'danger' ? 'bg-danger' : 'bg-accent-strong'
            }`}
          />
        }
      >
        <p className="text-[13px] leading-snug text-ink">
          {conclusion.primary}
          {terminalNodeId && (
            <span className="ml-1.5 align-[1px]">
              <OverrideBadge />
            </span>
          )}
        </p>
        {conclusion.secondary && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted">{conclusion.secondary}</p>
        )}
        {terminalNodeId && <OverrideDetails nodeId={terminalNodeId} />}
      </ChainRow>
    </ol>
  )
}
