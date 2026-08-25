import { useState, type ReactNode } from 'react'
import { useActiveTree } from '../../lib/activeTreeStore'
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
      className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
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
        className="inline-flex items-center gap-1 rounded-dash-ctl px-1 text-dash-micro text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink"
      >
        <Chevron open={open} />
        {label}
      </button>
      {open && (
        <blockquote className="mt-1 border-l-2 border-dash-line pl-2 text-dash-micro italic leading-snug text-dash-muted">
          {quote}
        </blockquote>
      )}
    </>
  )
}

/** Tiny 'Clinic override' pill — solid so a deviation from the CPG pops. */
export function OverrideBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-dash-ctl bg-dash-accent-strong px-2 py-1 text-dash-micro font-semibold uppercase leading-none tracking-wide text-white">
      Clinic override
    </span>
  )
}

/**
 * Expandable provenance for a clinic-overridden node: who changed it, why,
 * and the struck-through CPG text the clinic's rule replaced.
 */
export function OverrideDetails({ nodeId }: { nodeId: string }) {
  const { overrideInfoByNode } = useActiveTree()
  const info = overrideInfoByNode.get(nodeId)
  const [open, setOpen] = useState(false)

  if (!info) return null

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-dash-ctl px-1 text-dash-micro font-medium text-dash-accent-strong transition-colors hover:bg-dash-accent-soft"
      >
        <Chevron open={open} />
        why the clinic overrode this
      </button>
      {open && (
        <div className="mt-1 space-y-2 rounded-dash-ctl border border-dash-line bg-dash-bg px-3 py-2">
          <p className="text-dash-micro leading-snug text-dash-ink">
            <span className="font-medium">{info.author}:</span> {info.rationale}
          </p>
          {info.cpgBasis && (
            <p className="text-dash-micro leading-snug text-dash-muted line-through decoration-dash-muted/60">
              CPG: {info.cpgBasis}
            </p>
          )}
          <p className="text-dash-micro font-medium leading-snug text-dash-accent-strong">
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
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {/* hairline connector down to the next node dot */}
      {!last && <span aria-hidden className="absolute left-1 top-3 bottom-0 w-px bg-dash-line" />}
      <span className="relative mt-1 flex h-2 w-2 shrink-0 items-center justify-center">{dot}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  )
}

function StepDot({ overridden }: { overridden: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-2 w-2 rounded-full border ${
        overridden ? 'border-dash-accent-strong bg-dash-accent-strong' : 'border-dash-accent bg-dash-surface'
      }`}
    />
  )
}

/* ── One decision step ────────────────────────────────────────────────────── */

function StepRow({ step, last }: { step: DecisionStep; last: boolean }) {
  return (
    <ChainRow last={last} dot={<StepDot overridden={step.overridden} />}>
      <p className="text-dash-body leading-snug text-dash-ink">
        {step.label} — <span className="font-semibold">{step.answer}</span>
        {step.overridden && (
          <span className="ml-2 align-[1px]">
            <OverrideBadge />
          </span>
        )}
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-dash-micro text-dash-muted">
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
    return <p className="text-dash-body text-dash-muted">No decision steps recorded.</p>
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
            className={`h-2 w-2 rounded-full ${
              conclusion.tone === 'danger' ? 'bg-dash-red' : 'bg-dash-accent-strong'
            }`}
          />
        }
      >
        <p className="text-dash-body leading-snug text-dash-ink">
          {conclusion.primary}
          {terminalNodeId && (
            <span className="ml-2 align-[1px]">
              <OverrideBadge />
            </span>
          )}
        </p>
        {conclusion.secondary && (
          <p className="mt-1 text-dash-micro leading-snug text-dash-muted">{conclusion.secondary}</p>
        )}
        {terminalNodeId && <OverrideDetails nodeId={terminalNodeId} />}
      </ChainRow>
    </ol>
  )
}
