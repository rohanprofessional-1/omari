import type { MissingVariableInfo } from '../../types'

/**
 * Dashboard detail — the ONE variable blocking this referral's route: what is
 * missing, what hangs on each possible answer, and who can supply it. The
 * request action itself arrives in the next build step.
 */

export default function MissingVariableCard({ info }: { info: MissingVariableInfo }) {
  return (
    <section className="rounded-xl border border-danger/40 bg-danger/[0.04] p-4">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-danger">
        Missing information
      </p>
      <p className="mt-1.5 text-[13px] font-medium leading-snug text-ink">{info.clinicalPrompt}</p>

      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        Why it matters
      </p>
      <ul className="mt-1 space-y-1">
        {info.gates.map((gate) => (
          <li key={gate.answerLabel} className="flex items-baseline gap-1.5 text-[12.5px] leading-snug">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 self-start rounded-full bg-danger/60" />
            <span>
              <span className="text-muted">If </span>
              <span className="font-medium text-ink">{gate.answerLabel}</span>
              <span className="text-muted"> → {gate.leadsTo}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded border border-line bg-canvas px-1.5 py-0.5 text-[11px] text-muted">
          Who can supply: <span className="ml-1 font-medium text-ink">{info.whoCanSupply}</span>
        </span>
        <button
          disabled
          title="Actions arrive in the next step"
          className="ml-auto cursor-not-allowed rounded-md border border-line bg-canvas px-2.5 py-1 text-[12px] font-medium text-muted opacity-60"
        >
          Request information
        </button>
      </div>
    </section>
  )
}
