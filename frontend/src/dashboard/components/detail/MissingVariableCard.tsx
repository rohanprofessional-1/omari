import type { MissingVariableInfo } from '../../types'
import SignalDot from '../shared/SignalDot'

/**
 * Dashboard detail — the ONE variable blocking this referral's route: what is
 * missing, what hangs on each possible answer, and who can supply it. Amber
 * (needs attention) — the colour lives in the 2px rail and the kicker's dot,
 * never in the words. The request button opens the request-info modal.
 */

export default function MissingVariableCard({
  info,
  onRequest,
}: {
  info: MissingVariableInfo
  onRequest?: () => void
}) {
  return (
    <section className="rounded-dash-card border border-l-2 border-dash-line border-l-dash-amber bg-dash-surface p-4 shadow-dash-card">
      <p className="flex items-center gap-2 text-dash-micro font-semibold uppercase tracking-wide text-dash-ink">
        <SignalDot tone="amber" />
        Missing information
      </p>
      <p className="mt-2 text-dash-body font-medium leading-snug text-dash-ink">
        {info.clinicalPrompt}
      </p>

      <p className="mt-3 text-dash-micro font-semibold uppercase tracking-wide text-dash-muted">
        Why it matters
      </p>
      <ul className="mt-1 space-y-1">
        {info.gates.map((gate) => (
          <li key={gate.answerLabel} className="flex items-baseline gap-2 text-dash-body leading-snug">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 self-start rounded-full bg-dash-amber" />
            <span>
              <span className="text-dash-muted">If </span>
              <span className="font-medium text-dash-ink">{gate.answerLabel}</span>
              <span className="text-dash-muted"> → {gate.leadsTo}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-dash-ctl bg-dash-neutral-soft px-2 py-1 text-dash-micro text-dash-muted">
          Who can supply: <span className="ml-1 font-medium text-dash-ink">{info.whoCanSupply}</span>
        </span>
        <button
          onClick={onRequest}
          disabled={!onRequest}
          className="ml-auto rounded-dash-ctl border border-dash-line bg-dash-surface px-3 py-1 text-dash-micro font-medium text-dash-ink transition-colors hover:bg-dash-bg disabled:cursor-not-allowed disabled:text-dash-muted disabled:opacity-60"
        >
          Request information
        </button>
      </div>
    </section>
  )
}
