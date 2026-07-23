import { useMemo, useState } from 'react'
import type { KeyedCondition, SpecialistNode, Tree } from '../../types/tree'
import { anchorForNode } from '../../lib/deltas/resolve'
import type { NodeAnchor } from '../../lib/deltas/schema'

/**
 * Blume — workup overrides (Reconcile stage: "Workup").
 *
 * Pre-visit tests grouped by specialist, presented as chips to accept,
 * remove, guard, or add to. This is the first structured authoring surface
 * for path-conditioned workup ("only when…") and over-ordering guards
 * ("don't order unless…") — the old Builder never had one. Driven by local
 * resource reality: no in-house EMG, imaging backlog, payer rules.
 */

export interface WorkupChange {
  anchor: NodeAnchor
  specialistName: string
  kind: 'add' | 'remove' | 'guard'
  itemName: string
  protocol?: string
  rationale?: string
  when?: KeyedCondition
}

export default function WorkupReview({
  tree,
  busy,
  onChange,
}: {
  tree: Tree
  busy: boolean
  onChange: (change: WorkupChange) => void
}) {
  const terminals = useMemo(
    () =>
      tree.nodes
        .filter((n): n is SpecialistNode => n.type === 'specialist')
        .sort((a, b) => {
          const aPh = a.specialistName.startsWith('[Assign') ? 1 : 0
          const bPh = b.specialistName.startsWith('[Assign') ? 1 : 0
          return aPh - bPh || a.specialistName.localeCompare(b.specialistName)
        }),
    [tree],
  )

  const variableKeys = useMemo(
    () =>
      tree.nodes
        .filter((n) => n.type === 'variable')
        .map((n) => (n.type === 'variable' ? n.variableKey : ''))
        .filter((k) => k && k !== 'master_cpg_root' && !k.endsWith('cpg_section')),
    [tree],
  )

  if (terminals.length === 0) {
    return (
      <div className="px-5 py-6">
        <p className="text-[13px] text-muted">This tree has no specialist endpoints yet.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-5">
      <p className="mb-4 text-[13px] leading-relaxed text-muted">
        The tests each specialist wants BEFORE the visit. Remove what your clinic can't get, guard what's
        over-ordered, add what's missing. Conditional rules reference any question on the patient's path.
      </p>
      <div className="space-y-4">
        {terminals.map((node) => (
          <SpecialistWorkupCard
            key={node.id}
            node={node}
            variableKeys={variableKeys}
            busy={busy}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  )
}

function SpecialistWorkupCard({
  node,
  variableKeys,
  busy,
  onChange,
}: {
  node: SpecialistNode
  variableKeys: string[]
  busy: boolean
  onChange: (change: WorkupChange) => void
}) {
  const [adding, setAdding] = useState(false)
  const [guarding, setGuarding] = useState<string | null>(null)
  const anchor = anchorForNode(node)
  const placeholder = node.specialistName.startsWith('[Assign')
  const emit = (change: Omit<WorkupChange, 'anchor' | 'specialistName'>) =>
    onChange({ ...change, anchor, specialistName: node.specialistName })

  return (
    <div className={`rounded-lg border border-line px-4 py-3 ${placeholder ? 'bg-bg' : 'bg-canvas'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={`text-[13.5px] font-semibold ${placeholder ? 'italic text-muted' : 'text-ink'}`}>
          {node.specialistName}
          {node.specialty && <span className="ml-2 text-[11.5px] font-normal text-muted">{node.specialty}</span>}
        </h3>
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted">{node.urgency}</span>
      </div>

      {/* Always-ordered chips */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {node.workup.always.map((item) => (
          <span
            key={item.name}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg px-2.5 py-1 text-[12px] text-ink"
            title={[item.protocol, item.rationale].filter(Boolean).join(' — ')}
          >
            {item.name}
            <button
              onClick={() => setGuarding(guarding === item.name ? null : item.name)}
              disabled={busy}
              className="text-[10.5px] text-muted hover:text-accent-strong"
              title="Don't order unless a condition holds"
            >
              guard
            </button>
            <button
              onClick={() => emit({ kind: 'remove', itemName: item.name })}
              disabled={busy}
              className="text-muted hover:text-danger"
              title="Stop ordering this test"
            >
              ✕
            </button>
          </span>
        ))}
        {node.workup.conditional.map((c) => (
          <span
            key={`cond-${c.item.name}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line bg-bg px-2.5 py-1 text-[12px] text-ink"
            title={`Only when ${c.when.key} ${describeKeyed(c.when)}${c.reason ? ` — ${c.reason}` : ''}`}
          >
            {c.item.name} <em className="not-italic text-[10.5px] text-muted">when {c.when.key}</em>
            <button
              onClick={() => emit({ kind: 'remove', itemName: c.item.name })}
              disabled={busy}
              className="text-muted hover:text-danger"
            >
              ✕
            </button>
          </span>
        ))}
        {node.workup.doNotOrderUnless.map((g) => (
          <span
            key={`guard-${g.item}`}
            className="inline-flex items-center rounded-full border border-danger/30 bg-danger/5 px-2.5 py-1 text-[11.5px] text-danger"
            title={`Withheld unless ${g.requiredCondition.key} ${describeKeyed(g.requiredCondition)} (undo the delta in the rail to remove)`}
          >
            {g.item}: only if {g.requiredCondition.key} {describeKeyed(g.requiredCondition)}
          </span>
        ))}
        {node.workup.always.length + node.workup.conditional.length === 0 && (
          <span className="text-[12px] italic text-muted">No pre-visit tests yet.</span>
        )}
        <button
          onClick={() => setAdding((a) => !a)}
          disabled={busy}
          className="rounded-full border border-dashed border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:border-accent/50 hover:text-accent-strong"
        >
          + Add test
        </button>
      </div>

      {guarding && (
        <ConditionForm
          title={`Don't order ${guarding} unless…`}
          variableKeys={variableKeys}
          busy={busy}
          onSubmit={(when) => {
            emit({ kind: 'guard', itemName: guarding, when })
            setGuarding(null)
          }}
          onCancel={() => setGuarding(null)}
        />
      )}

      {adding && (
        <AddTestForm
          variableKeys={variableKeys}
          busy={busy}
          onSubmit={(change) => {
            emit(change)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  )
}

/* ------------------------- small forms ------------------------- */

const input = 'rounded-md border border-line bg-bg px-2 py-1 text-[12.5px] text-ink placeholder:text-muted/60'

function AddTestForm({
  variableKeys,
  busy,
  onSubmit,
  onCancel,
}: {
  variableKeys: string[]
  busy: boolean
  onSubmit: (change: { kind: 'add'; itemName: string; protocol?: string; rationale?: string; when?: KeyedCondition }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState('')
  const [rationale, setRationale] = useState('')
  const [conditional, setConditional] = useState(false)
  const [when, setWhen] = useState<KeyedCondition | null>(null)

  return (
    <div className="mt-2.5 space-y-2 rounded-md border border-line bg-bg p-2.5">
      <div className="flex flex-wrap gap-2">
        <input className={`${input} w-44`} placeholder="Test name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={`${input} w-40`} placeholder="Protocol (optional)" value={protocol} onChange={(e) => setProtocol(e.target.value)} />
        <input className={`${input} flex-1`} placeholder="Why this test (optional)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input type="checkbox" checked={conditional} onChange={(e) => setConditional(e.target.checked)} />
        Only order when a condition holds
      </label>
      {conditional && <KeyedConditionEditor variableKeys={variableKeys} onChange={setWhen} />}
      <div className="flex gap-2">
        <button
          onClick={() => onSubmit({ kind: 'add', itemName: name.trim(), protocol, rationale, when: conditional ? when ?? undefined : undefined })}
          disabled={busy || !name.trim() || (conditional && !when)}
          className="rounded-md bg-accent-strong px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Add
        </button>
        <button onClick={onCancel} className="text-[12px] text-muted hover:text-ink">
          cancel
        </button>
      </div>
    </div>
  )
}

function ConditionForm({
  title,
  variableKeys,
  busy,
  onSubmit,
  onCancel,
}: {
  title: string
  variableKeys: string[]
  busy: boolean
  onSubmit: (when: KeyedCondition) => void
  onCancel: () => void
}) {
  const [when, setWhen] = useState<KeyedCondition | null>(null)
  return (
    <div className="mt-2.5 space-y-2 rounded-md border border-line bg-bg p-2.5">
      <p className="text-[12px] font-medium text-ink">{title}</p>
      <KeyedConditionEditor variableKeys={variableKeys} onChange={setWhen} />
      <div className="flex gap-2">
        <button
          onClick={() => when && onSubmit(when)}
          disabled={busy || !when}
          className="rounded-md bg-accent-strong px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Add guard
        </button>
        <button onClick={onCancel} className="text-[12px] text-muted hover:text-ink">
          cancel
        </button>
      </div>
    </div>
  )
}

function KeyedConditionEditor({
  variableKeys,
  onChange,
}: {
  variableKeys: string[]
  onChange: (cond: KeyedCondition | null) => void
}) {
  const [key, setKey] = useState('')
  const [op, setOp] = useState<'equals' | 'range'>('equals')
  const [value, setValue] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')

  const emit = (k: string, o: 'equals' | 'range', v: string, lo: string, hi: string) => {
    if (!k) return onChange(null)
    if (o === 'equals') {
      if (v.trim() === '') return onChange(null)
      const n = Number(v)
      onChange({ op: 'equals', key: k, value: Number.isFinite(n) && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? n : v })
    } else {
      const loN = lo.trim() === '' ? undefined : Number(lo)
      const hiN = hi.trim() === '' ? undefined : Number(hi)
      if (loN === undefined && hiN === undefined) return onChange(null)
      onChange({ op: 'range', key: k, ...(loN !== undefined ? { min: loN } : {}), ...(hiN !== undefined ? { max: hiN } : {}) })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={input}
        value={key}
        onChange={(e) => {
          setKey(e.target.value)
          emit(e.target.value, op, value, min, max)
        }}
      >
        <option value="">Which question…</option>
        {variableKeys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <select
        className={input}
        value={op}
        onChange={(e) => {
          const o = e.target.value as 'equals' | 'range'
          setOp(o)
          emit(key, o, value, min, max)
        }}
      >
        <option value="equals">is exactly</option>
        <option value="range">is in range</option>
      </select>
      {op === 'equals' ? (
        <input
          className={`${input} w-32`}
          placeholder="value"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            emit(key, op, e.target.value, min, max)
          }}
        />
      ) : (
        <>
          <input
            className={`${input} w-20`}
            placeholder="min"
            value={min}
            onChange={(e) => {
              setMin(e.target.value)
              emit(key, op, value, e.target.value, max)
            }}
          />
          <input
            className={`${input} w-20`}
            placeholder="max"
            value={max}
            onChange={(e) => {
              setMax(e.target.value)
              emit(key, op, value, min, e.target.value)
            }}
          />
        </>
      )}
    </div>
  )
}

function describeKeyed(c: KeyedCondition): string {
  if (c.op === 'equals') return `= ${String(c.value)}`
  if (c.op === 'range') {
    if (c.min !== undefined && c.max !== undefined) return `${c.min}–${c.max}`
    return c.min !== undefined ? `≥ ${c.min}` : `≤ ${c.max}`
  }
  return `in [${c.values.join(', ')}]`
}
