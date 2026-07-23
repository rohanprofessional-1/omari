import { useEffect, useMemo, useState } from 'react'
import type { SpecialistNode, Tree, VariableNode } from '../../types/tree'
import { generateCases, listCases, type GenRosterEntry } from '../../lib/genApi'
import type { GenCase } from '../../lib/generator/types'
import { runCase } from '../../lib/deltas/caseRunner'
import { anchorForBranch, anchorForNode } from '../../lib/deltas/resolve'
import type { BranchAnchor, NodeAnchor } from '../../lib/deltas/schema'

/**
 * Blume — case validation (Reconcile stage: "Validate").
 *
 * Synthetic cases run through the COMPILED tree via the real engine; the
 * surgeon confirms or corrects each routing. A correction localizes to the
 * responsible decision on the case's pathTaken and becomes a retarget_branch
 * delta — the tree recompiles live and every case re-runs against the fix.
 * The surgeon judges outcomes; the surgeon never edits the tree.
 */

export interface CaseCorrection {
  branch: BranchAnchor
  target: { kind: 'node'; anchor: NodeAnchor } | { kind: 'escalation'; reason: string }
  note: string
}

export default function CasePlayer({
  tree,
  subspecialty,
  roster,
  busy,
  onCorrect,
}: {
  tree: Tree
  subspecialty: string | null
  roster: GenRosterEntry[]
  busy: boolean
  onCorrect: (correction: CaseCorrection) => void
}) {
  const [cases, setCases] = useState<GenCase[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!subspecialty) return
    setLoading(true)
    listCases(subspecialty)
      .then(setCases)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [subspecialty])

  const generate = async () => {
    if (!subspecialty) return
    setLoading(true)
    setLoadError(null)
    try {
      const fresh = await generateCases({ subspecialty, count: 10, roster })
      setCases((prev) => [...prev, ...fresh])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const terminals = useMemo(
    () =>
      tree.nodes.filter(
        (n): n is SpecialistNode => n.type === 'specialist' && !n.specialistName.startsWith('[Assign'),
      ),
    [tree],
  )

  if (!subspecialty) {
    return (
      <div className="px-5 py-6">
        <p className="text-[13px] text-muted">
          This tree's base has no subspecialty recorded, so no case bank can be loaded. Regenerate from a
          guideline to enable validation.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-muted">
          {cases.length === 0
            ? 'Run realistic referrals through the tree and confirm each lands where you would send it.'
            : `${confirmed.size} of ${cases.length} routings confirmed.`}
        </p>
        <button
          onClick={() => void generate()}
          disabled={busy || loading}
          className="shrink-0 rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-ink disabled:opacity-50"
        >
          {loading ? 'Working…' : cases.length === 0 ? 'Generate 10 cases' : '+ 10 more cases'}
        </button>
      </div>
      {loadError && <p className="mb-3 text-[12.5px] text-danger">{loadError}</p>}
      {cases.length === 0 && !loading && !loadError && (
        <p className="text-[13px] text-muted">No cases in the bank for “{subspecialty}” yet — generate some.</p>
      )}
      <div className="space-y-3">
        {cases.map((c) => (
          <CaseCard
            key={c.id}
            tree={tree}
            genCase={c}
            terminals={terminals}
            confirmed={confirmed.has(c.id)}
            busy={busy}
            onConfirm={() => setConfirmed((s) => new Set(s).add(c.id))}
            onCorrect={onCorrect}
          />
        ))}
      </div>
    </div>
  )
}

/* ------------------------- one case ------------------------- */

interface PathStep {
  node: VariableNode
  branchIndex: number
  branchLabel: string
  value: unknown
}

function CaseCard({
  tree,
  genCase,
  terminals,
  confirmed,
  busy,
  onConfirm,
  onCorrect,
}: {
  tree: Tree
  genCase: GenCase
  terminals: SpecialistNode[]
  confirmed: boolean
  busy: boolean
  onConfirm: () => void
  onCorrect: (correction: CaseCorrection) => void
}) {
  const [correcting, setCorrecting] = useState(false)

  const outcome = useMemo(() => runCase(tree, genCase.groundTruth as Record<string, unknown>), [tree, genCase])
  const { result } = outcome

  // Decision steps: each variable on the path + the branch actually taken.
  const steps: PathStep[] = useMemo(() => {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]))
    const out: PathStep[] = []
    for (let i = 0; i < result.pathTaken.length - 1; i++) {
      const node = byId.get(result.pathTaken[i])
      if (!node || node.type !== 'variable') continue
      const nextId = result.pathTaken[i + 1]
      const branchIndex = node.branches.findIndex((b) => b.nextNodeId === nextId)
      if (branchIndex < 0) continue
      const value =
        (genCase.groundTruth as Record<string, unknown>)[node.variableKey] ?? outcome.autoFilled[node.variableKey]
      out.push({ node, branchIndex, branchLabel: node.branches[branchIndex].label, value })
    }
    return out
  }, [tree, result, genCase, outcome])

  const outcomeLine =
    result.outcome === 'routed'
      ? `→ ${result.specialist!.specialistName} (${result.specialist!.urgency})${
          result.resolvedWorkup && result.resolvedWorkup.ordered.length > 0
            ? ` · pre-visit: ${result.resolvedWorkup.ordered.map((w) => w.name).join(', ')}`
            : ' · no pre-visit workup'
        }`
      : result.outcome === 'escalated'
        ? `→ Human review — ${result.escalationReason}`
        : `Incomplete — case has no value for “${result.missingVariables.join(', ')}”`

  return (
    <div className={`rounded-lg border px-4 py-3 ${confirmed ? 'border-accent/40 bg-accent/5' : 'border-line bg-canvas'}`}>
      <p className="text-[13px] leading-relaxed text-ink">{genCase.narrative}</p>
      <p
        className={`mt-2 text-[13px] font-medium ${
          result.outcome === 'routed' ? 'text-accent-strong' : result.outcome === 'escalated' ? 'text-danger' : 'text-muted'
        }`}
      >
        {outcomeLine}
      </p>

      {!confirmed && !correcting && (
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md border border-line px-3 py-1 text-[12px] font-medium text-muted hover:text-accent-strong"
          >
            ✓ That's right
          </button>
          {steps.length > 0 && (
            <button
              onClick={() => setCorrecting(true)}
              disabled={busy}
              className="rounded-md border border-line px-3 py-1 text-[12px] font-medium text-muted hover:text-danger"
            >
              ✗ Wrong — fix it
            </button>
          )}
        </div>
      )}
      {confirmed && <p className="mt-2 text-[11.5px] font-medium text-accent-strong">Confirmed</p>}

      {correcting && (
        <CorrectionPanel
          steps={steps}
          terminals={terminals}
          busy={busy}
          onApply={(correction) => {
            onCorrect(correction)
            setCorrecting(false)
          }}
          onCancel={() => setCorrecting(false)}
        />
      )}
    </div>
  )
}

function CorrectionPanel({
  steps,
  terminals,
  busy,
  onApply,
  onCancel,
}: {
  steps: PathStep[]
  terminals: SpecialistNode[]
  busy: boolean
  onApply: (correction: CaseCorrection) => void
  onCancel: () => void
}) {
  // The LAST decision is the usual culprit — preselected.
  const [stepIndex, setStepIndex] = useState(steps.length - 1)
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')

  const apply = () => {
    const step = steps[stepIndex]
    const branch = anchorForBranch(step.node, step.branchIndex)
    if (destination === '__escalate__') {
      onApply({
        branch,
        target: { kind: 'escalation', reason: note.trim() || 'Surgeon flagged this routing during validation' },
        note,
      })
    } else {
      const terminal = terminals.find((t) => t.id === destination)
      if (!terminal) return
      onApply({ branch, target: { kind: 'node', anchor: anchorForNode(terminal) }, note })
    }
  }

  return (
    <div className="mt-2.5 space-y-2 rounded-md border border-line bg-bg p-3">
      <p className="text-[12px] font-medium text-ink">Which decision was wrong?</p>
      <div className="space-y-1">
        {steps.map((s, i) => (
          <label key={i} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
            <input type="radio" name="step" checked={stepIndex === i} onChange={() => setStepIndex(i)} />
            <span className="text-muted">{s.node.prompt}</span>
            <span>
              = {String(s.value)} → “{s.branchLabel}”
            </span>
          </label>
        ))}
      </div>
      <p className="text-[12px] font-medium text-ink">Patients matching “{steps[stepIndex]?.branchLabel}” should go to:</p>
      <select
        className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[12.5px] text-ink"
        value={destination}
        onChange={(e) => setDestination(e.target.value)}
      >
        <option value="">Choose destination…</option>
        {terminals.map((t) => (
          <option key={t.id} value={t.id}>
            {t.specialistName}
            {t.specialty ? ` — ${t.specialty}` : ''}
          </option>
        ))}
        <option value="__escalate__">Human review (escalate)</option>
      </select>
      <input
        className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-muted/60"
        placeholder="Why? (optional — goes in the decision record)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          onClick={apply}
          disabled={busy || !destination}
          className="rounded-md bg-accent-strong px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Fix routing
        </button>
        <button onClick={onCancel} className="text-[12px] text-muted hover:text-ink">
          cancel
        </button>
      </div>
    </div>
  )
}
