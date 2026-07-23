import { useMemo, useState } from 'react'
import type { Condition, Tree } from '../../types/tree'
import { detectThresholdCandidates, type ThresholdCandidate } from '../../lib/deltas/detectAmbiguous'

/**
 * Blume — threshold review (Reconcile stage: "Thresholds").
 *
 * Surfaces ONLY the conditions worth a surgeon's minute: vague qualitative
 * matches the CPG never quantified ("elevated", "severe") and every numeric
 * range. Each card shows the guideline's own words beside the condition;
 * the surgeon accepts it verbatim, replaces it with this clinic's number,
 * or splits an ambiguous branch into ordered numeric bands. Overrides that
 * contradict the guideline are recorded as deviations, never blocked.
 */

export interface ThresholdDecision {
  candidate: ThresholdCandidate
  action: 'replace' | 'split'
  replacement?: Condition
  bands?: Array<{ label: string; condition: Condition }>
  deviates: boolean
  rationale: string
}

interface BandDraft {
  label: string
  min: string
  max: string
}

export default function ThresholdQueue({
  tree,
  busy,
  onDecide,
}: {
  tree: Tree
  busy: boolean
  onDecide: (decision: ThresholdDecision) => void
}) {
  const candidates = useMemo(() => detectThresholdCandidates(tree), [tree])
  // Session-local: cards the surgeon accepted verbatim (no delta needed).
  const [accepted, setAccepted] = useState<Set<string>>(new Set())

  const keyOf = (c: ThresholdCandidate) => `${c.nodeId}#${c.branchIndex}`
  const queue = candidates.filter((c) => !accepted.has(keyOf(c)))

  if (candidates.length === 0) {
    return (
      <div className="px-5 py-6">
        <p className="text-[13px] text-muted">No ambiguous conditions or numeric thresholds to review in this tree.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-5">
      <p className="mb-1 text-[13px] leading-relaxed text-muted">
        {queue.length === 0
          ? `All ${candidates.length} thresholds reviewed.`
          : `${queue.length} of ${candidates.length} conditions need your number (or your confirmation).`}
      </p>
      <div className="mt-3 space-y-3">
        {queue.map((c) => (
          <ThresholdCard
            key={keyOf(c)}
            candidate={c}
            busy={busy}
            onAccept={() => setAccepted((s) => new Set(s).add(keyOf(c)))}
            onDecide={onDecide}
          />
        ))}
      </div>
    </div>
  )
}

function ThresholdCard({
  candidate,
  busy,
  onAccept,
  onDecide,
}: {
  candidate: ThresholdCandidate
  busy: boolean
  onAccept: () => void
  onDecide: (decision: ThresholdDecision) => void
}) {
  const [mode, setMode] = useState<'view' | 'replace' | 'split'>('view')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [bands, setBands] = useState<BandDraft[]>([
    { label: '', min: '', max: '' },
    { label: '', min: '', max: '' },
  ])
  const [deviates, setDeviates] = useState(false)
  const [rationale, setRationale] = useState('')

  const conditionText =
    candidate.kind === 'ambiguous_equals'
      ? `matches the text "${candidate.branchLabel}" — the guideline never gave a number`
      : 'numeric range from the guideline — confirm or adjust for this clinic'

  const num = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s))

  const submitReplace = () => {
    const lo = num(min)
    const hi = num(max)
    if (lo === undefined && hi === undefined) return
    onDecide({
      candidate,
      action: 'replace',
      replacement: { op: 'range', ...(lo !== undefined ? { min: lo } : {}), ...(hi !== undefined ? { max: hi } : {}) },
      deviates,
      rationale,
    })
  }

  const submitSplit = () => {
    const parsed = bands
      .filter((b) => b.label.trim() && (b.min.trim() !== '' || b.max.trim() !== ''))
      .map((b) => ({
        label: b.label.trim(),
        condition: {
          op: 'range' as const,
          ...(num(b.min) !== undefined ? { min: num(b.min)! } : {}),
          ...(num(b.max) !== undefined ? { max: num(b.max)! } : {}),
        },
      }))
    if (parsed.length < 2) return
    onDecide({ candidate, action: 'split', bands: parsed, deviates, rationale })
  }

  const numInput = 'w-24 rounded-md border border-line bg-bg px-2 py-1 text-[12.5px] text-ink'

  return (
    <div className="rounded-lg border border-line bg-canvas px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">
            {candidate.prompt} <span className="text-muted">→</span> {candidate.branchLabel}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted">{conditionText}</p>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
            candidate.kind === 'ambiguous_equals' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent-strong'
          }`}
        >
          {candidate.kind === 'ambiguous_equals' ? 'no number' : 'range'}
        </span>
      </div>

      {candidate.clinicalBasis && (
        <blockquote className="mt-2 border-l-2 border-line pl-2.5 text-[11.5px] italic leading-snug text-muted">
          “{candidate.clinicalBasis}”
        </blockquote>
      )}

      {mode === 'view' && (
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={onAccept}
            disabled={busy}
            className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:text-ink"
          >
            Accept as written
          </button>
          <button
            onClick={() => setMode('replace')}
            disabled={busy}
            className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:text-ink"
          >
            Use this clinic's number
          </button>
          {candidate.kind === 'ambiguous_equals' && (
            <button
              onClick={() => setMode('split')}
              disabled={busy}
              className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:text-ink"
            >
              Split into bands
            </button>
          )}
        </div>
      )}

      {mode === 'replace' && (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center gap-2 text-[12.5px] text-ink">
            <span>From</span>
            <input className={numInput} placeholder="min" value={min} onChange={(e) => setMin(e.target.value)} />
            <span>to</span>
            <input className={numInput} placeholder="max" value={max} onChange={(e) => setMax(e.target.value)} />
            <span className="text-[11px] text-muted">(leave one blank for an open bound)</span>
          </div>
          <DeviationRow deviates={deviates} setDeviates={setDeviates} rationale={rationale} setRationale={setRationale} />
          <div className="flex gap-2">
            <button
              onClick={submitReplace}
              disabled={busy || (min.trim() === '' && max.trim() === '') || (deviates && !rationale.trim())}
              className="rounded-md bg-accent-strong px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              Set threshold
            </button>
            <button onClick={() => setMode('view')} className="text-[12px] text-muted hover:text-ink">
              cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'split' && (
        <div className="mt-2.5 space-y-2">
          {bands.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="w-40 rounded-md border border-line bg-bg px-2 py-1 text-[12.5px] text-ink"
                placeholder={`Band ${i + 1} label`}
                value={b.label}
                onChange={(e) => setBands((bs) => bs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <input
                className={numInput}
                placeholder="min"
                value={b.min}
                onChange={(e) => setBands((bs) => bs.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))}
              />
              <input
                className={numInput}
                placeholder="max"
                value={b.max}
                onChange={(e) => setBands((bs) => bs.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))}
              />
            </div>
          ))}
          <button
            onClick={() => setBands((bs) => [...bs, { label: '', min: '', max: '' }])}
            className="text-[12px] text-muted hover:text-ink"
          >
            + another band
          </button>
          <p className="text-[11px] leading-snug text-muted">
            Bands are checked in order, first match wins. All bands keep this branch's current destination —
            rewire individual bands afterwards in the mapping stage or Builder if needed.
          </p>
          <DeviationRow deviates={deviates} setDeviates={setDeviates} rationale={rationale} setRationale={setRationale} />
          <div className="flex gap-2">
            <button
              onClick={submitSplit}
              disabled={busy || (deviates && !rationale.trim())}
              className="rounded-md bg-accent-strong px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              Split branch
            </button>
            <button onClick={() => setMode('view')} className="text-[12px] text-muted hover:text-ink">
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DeviationRow({
  deviates,
  setDeviates,
  rationale,
  setRationale,
}: {
  deviates: boolean
  setDeviates: (v: boolean) => void
  rationale: string
  setRationale: (v: string) => void
}) {
  return (
    <div>
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input type="checkbox" checked={deviates} onChange={(e) => setDeviates(e.target.checked)} />
        This differs from what the guideline recommends
      </label>
      {deviates && (
        <input
          className="mt-1.5 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-muted/60"
          placeholder="Why does this clinic do it differently? (required — goes in the sign-off record)"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      )}
    </div>
  )
}
