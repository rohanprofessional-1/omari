import { useState, type ReactNode } from 'react'
import type {
  Branch,
  Condition,
  DataSource,
  EscalationNode,
  Node as TreeNode,
  SpecialistNode,
  Urgency,
  VariableNode,
  WorkupItem,
} from '../types/tree'
import { shortBranchLabel } from '../lib/treeToFlow'

/**
 * Blume — node editor side panel.
 *
 * Speaks plain CLINICIAN language by default ("Editing question", "How Omari
 * asks it", "Answers", "is exactly / is one of") and tucks the technical data
 * model (raw variable key, node id, matching operator, code values) behind a
 * collapsed "Advanced" disclosure. This is presentation only: every friendly
 * field writes back to the SAME underlying data the engine reads (key, prompt,
 * dataSource, branches' condition + value). There is intentionally NO local
 * draft state for the data — edits flow straight through `onUpdate` so the
 * canvas `nodes` stay the single source of truth and persist after clicking away.
 */
interface EditorPanelProps {
  treeNode: TreeNode
  onUpdate: (updater: (node: TreeNode) => TreeNode) => void
  onClose: () => void
}

/* ── Plain-language maps (friendly phrase ⇄ underlying value) ──────────────── */

/** Clinician phrase shown in the panel header per node kind. */
const PANEL_EYEBROW: Record<TreeNode['type'], string> = {
  variable: 'Editing question',
  specialist: 'Editing specialist',
  escalation: 'Editing escalation',
}

/** "Where this comes from" — friendly phrasing for each underlying data source. */
const DATA_SOURCE_OPTIONS: { value: DataSource; label: string }[] = [
  { value: 'patient', label: 'From the patient' },
  { value: 'referral', label: 'From the referral' },
  { value: 'record', label: 'From their records' },
]

/** Matching rule — plain phrase for each underlying condition operator. */
const OP_OPTIONS: { value: Condition['op']; label: string }[] = [
  { value: 'equals', label: 'is exactly' },
  { value: 'range', label: 'is in the range' },
  { value: 'in', label: 'is one of' },
]

const URGENCY_OPTIONS: { value: Urgency; label: string }[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'expedited', label: 'Expedited' },
  { value: 'urgent', label: 'Urgent' },
]

/**
 * Turn a snake_case / camelCase key into a friendly human name for display.
 * `symptomRegion` → "Symptom region", `nerve_test_result` → "Nerve test result".
 * Display only — the raw key stays the editable source of truth (under Advanced).
 */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function EditorPanel({ treeNode, onUpdate, onClose }: EditorPanelProps) {
  return (
    <aside className="omari-panel flex h-full w-[340px] shrink-0 flex-col border-l border-line bg-canvas">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
          {PANEL_EYEBROW[treeNode.type]}
        </p>
        <button
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-sm text-muted transition-colors hover:bg-bg hover:text-ink"
          aria-label="Close editor"
        >
          ✕
        </button>
      </header>

      <div className="omari-panel-content flex-1 overflow-y-auto px-5 py-5">
        {treeNode.type === 'variable' && (
          <VariableEditor node={treeNode} onUpdate={onUpdate} />
        )}
        {treeNode.type === 'specialist' && (
          <SpecialistEditor node={treeNode} onUpdate={onUpdate} />
        )}
        {treeNode.type === 'escalation' && (
          <EscalationEditor node={treeNode} onUpdate={onUpdate} />
        )}
      </div>
    </aside>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared field primitives                                                    */
/* -------------------------------------------------------------------------- */

const inputClass =
  'w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink transition-colors placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15'

/** A calm section with a quiet uppercase heading and optional count. */
function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <section className="mt-7 first:mt-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
          {title}
        </h3>
        {count != null && <span className="text-[10px] font-medium text-muted">{count}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="mb-4 block last:mb-0">
      <span className="mb-1 block text-[11.5px] font-medium text-ink/75">{label}</span>
      {hint && <span className="mb-1.5 block text-[10.5px] leading-snug text-muted">{hint}</span>}
      {children}
    </label>
  )
}

/** Read-only friendly value shown like a field (e.g. the humanized question name). */
function ReadonlyValue({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <span className="mb-1 block text-[11.5px] font-medium text-ink/75">{label}</span>
      {hint && <span className="mb-1.5 block text-[10.5px] leading-snug text-muted">{hint}</span>}
      <p className="rounded-lg border border-line bg-sky/40 px-2.5 py-2 text-[13px] font-medium text-ink">
        {children}
      </p>
    </div>
  )
}

function TextInput(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      className={inputClass}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

function TextArea(props: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      className={inputClass + ' resize-y leading-snug'}
      rows={props.rows ?? 3}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

/** Select that shows a friendly label but stores the underlying value. */
function FriendlySelect<T extends string>(props: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <select
      className={inputClass}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** "+ Add …" affordance at the end of a list. */
function AddButton(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className="w-full rounded-lg border border-dashed border-line py-2 text-[12px] font-medium text-muted transition-colors hover:border-accent hover:bg-sky/40 hover:text-accent"
    >
      {props.children}
    </button>
  )
}

/**
 * Collapsed-by-default disclosure for the technical data model. Sits at the
 * bottom of the panel (and inside each answer card). Lives in local state, and
 * since EditorPanel is keyed by node id it resets to collapsed for every node.
 */
function Advanced({ children, label = 'Advanced' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-muted transition-colors hover:text-ink"
      >
        <span
          aria-hidden
          className={`inline-block text-[9px] leading-none transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        {label}
      </button>
      {open && <div className="mt-3 space-y-3 border-l-2 border-line/70 pl-3">{children}</div>}
    </div>
  )
}

/** A small read-only technical value (shown inside Advanced). */
function RawValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1 block text-[10.5px] font-medium text-muted">{label}</span>
      <p className="break-all rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[11px] text-ink/80">
        {value || '—'}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Variable editor                                                            */
/* -------------------------------------------------------------------------- */

function VariableEditor({
  node,
  onUpdate,
}: {
  node: VariableNode
  onUpdate: EditorPanelProps['onUpdate']
}) {
  // Typed write-back: only mutates the node when it is still a variable node.
  const patch = (partial: Partial<VariableNode>) =>
    onUpdate((n) => (n.type === 'variable' ? { ...n, ...partial } : n))

  const setBranch = (index: number, branch: Branch) =>
    patch({ branches: node.branches.map((b, i) => (i === index ? branch : b)) })

  const addBranch = () =>
    patch({
      branches: [
        ...node.branches,
        { label: 'New answer', condition: { op: 'equals', value: '' }, nextNodeId: '' },
      ],
    })

  const removeBranch = (index: number) =>
    patch({ branches: node.branches.filter((_, i) => i !== index) })

  return (
    <div>
      <Section title="Question details">
        <ReadonlyValue label="What this asks">{humanizeKey(node.variableKey)}</ReadonlyValue>
        <Field label="How Omari asks it" hint="The wording the patient hears.">
          <TextArea value={node.prompt} onChange={(v) => patch({ prompt: v })} />
        </Field>
      </Section>

      <Section title="Where this comes from">
        <FriendlySelect
          value={node.dataSource}
          options={DATA_SOURCE_OPTIONS}
          onChange={(v) => patch({ dataSource: v })}
        />
      </Section>

      <Section title="Answers" count={node.branches.length}>
        <div className="space-y-3">
          {node.branches.map((branch, i) => (
            <AnswerCard
              key={i}
              index={i}
              branch={branch}
              onChange={(b) => setBranch(i, b)}
              onRemove={() => removeBranch(i)}
            />
          ))}
        </div>
        <div className="mt-3">
          <AddButton onClick={addBranch}>+ Add answer</AddButton>
        </div>
      </Section>

      <div className="mt-7 border-t border-line pt-4">
        <Advanced>
          <Field label="Question identifier (key)">
            <TextInput value={node.variableKey} onChange={(v) => patch({ variableKey: v })} />
          </Field>
          <RawValue label="Node ID" value={node.id} />
        </Advanced>
      </div>
    </div>
  )
}

/** Switch the matching rule, resetting the value to the new shape's default. */
function changeOp(op: Condition['op']): Condition {
  if (op === 'equals') return { op: 'equals', value: '' }
  if (op === 'range') return { op: 'range' }
  return { op: 'in', values: [] }
}

/** Human-readable rendering of a condition's matched value for a raw-display. */
function rawConditionValue(condition: Condition): string {
  if (condition.op === 'equals') return String(condition.value)
  if (condition.op === 'in') return condition.values.join(', ')
  const lo = condition.min ?? '−∞'
  const hi = condition.max ?? '+∞'
  return `${lo} … ${hi}`
}

/**
 * One answer as a clean card: the plain answer label (prominent, arrow-stripped),
 * the matching rule as a friendly phrase, friendly numeric range inputs when
 * relevant, and an Advanced disclosure for the raw operator + code value(s).
 */
function AnswerCard({
  index,
  branch,
  onChange,
  onRemove,
}: {
  index: number
  branch: Branch
  onChange: (b: Branch) => void
  onRemove: () => void
}) {
  const condition = branch.condition
  const setCondition = (c: Condition) => onChange({ ...branch, condition: c })

  return (
    <div className="rounded-[11px] border border-line bg-bg/60 p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          Answer {index + 1}
        </span>
        <button
          onClick={onRemove}
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        >
          Remove
        </button>
      </div>

      {/* Plain answer label — show the answer only (no "→ destination"). */}
      <input
        type="text"
        className={inputClass + ' font-medium'}
        value={shortBranchLabel(branch)}
        placeholder="e.g. Neck, radiating down the arm"
        onChange={(e) => onChange({ ...branch, label: e.target.value })}
      />

      {/* Matching rule — plain phrase. Friendly numeric inputs for a range. */}
      <div className="mt-2.5 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-muted">Matches when answer</span>
        <FriendlySelect
          value={condition.op}
          options={OP_OPTIONS}
          onChange={(op) => op !== condition.op && setCondition(changeOp(op))}
        />
      </div>

      {condition.op === 'range' && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            className={inputClass}
            placeholder="Lowest"
            value={condition.min ?? ''}
            onChange={(e) =>
              setCondition({
                op: 'range',
                min: e.target.value === '' ? undefined : Number(e.target.value),
                max: condition.max,
              })
            }
          />
          <span className="text-[11px] text-muted">to</span>
          <input
            type="number"
            className={inputClass}
            placeholder="Highest"
            value={condition.max ?? ''}
            onChange={(e) =>
              setCondition({
                op: 'range',
                min: condition.min,
                max: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </div>
      )}

      <Advanced>
        {condition.op === 'equals' && (
          <Field label="Code value">
            <TextInput
              value={String(condition.value)}
              placeholder="e.g. neck_radiating"
              onChange={(v) => setCondition({ op: 'equals', value: v })}
            />
          </Field>
        )}
        {condition.op === 'in' && (
          <Field label="Code values (comma-separated)">
            <TextInput
              value={condition.values.join(', ')}
              placeholder="e.g. neck_radiating, shoulder"
              onChange={(v) =>
                setCondition({
                  op: 'in',
                  values: v
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        )}
        {condition.op === 'range' && (
          <RawValue label="Matched range" value={rawConditionValue(condition)} />
        )}
        <RawValue label="Matching operator" value={condition.op} />
      </Advanced>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Specialist editor                                                          */
/* -------------------------------------------------------------------------- */

function SpecialistEditor({
  node,
  onUpdate,
}: {
  node: SpecialistNode
  onUpdate: EditorPanelProps['onUpdate']
}) {
  const patch = (partial: Partial<SpecialistNode>) =>
    onUpdate((n) => (n.type === 'specialist' ? { ...n, ...partial } : n))

  const setWorkup = (index: number, item: WorkupItem) =>
    patch({ workup: node.workup.map((w, i) => (i === index ? item : w)) })

  const addWorkup = () =>
    patch({ workup: [...node.workup, { name: '', protocol: '', rationale: '' }] })

  const removeWorkup = (index: number) =>
    patch({ workup: node.workup.filter((_, i) => i !== index) })

  return (
    <div>
      <Section title="Specialist details">
        <Field label="Who they see">
          <TextInput value={node.specialistName} onChange={(v) => patch({ specialistName: v })} />
        </Field>
        <Field label="Specialty">
          <TextInput value={node.specialty} onChange={(v) => patch({ specialty: v })} />
        </Field>
        <Field label="How soon">
          <FriendlySelect
            value={node.urgency}
            options={URGENCY_OPTIONS}
            onChange={(v) => patch({ urgency: v })}
          />
        </Field>
      </Section>

      <Section title="Recommended workup" count={node.workup.length}>
        <div className="space-y-3">
          {node.workup.map((item, i) => (
            <div key={i} className="rounded-[11px] border border-line bg-bg/60 p-3">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Test {i + 1}
                </span>
                <button
                  onClick={() => removeWorkup(i)}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  Remove
                </button>
              </div>
              <div className="space-y-2">
                <TextInput
                  value={item.name}
                  placeholder="Test name"
                  onChange={(v) => setWorkup(i, { ...item, name: v })}
                />
                <TextInput
                  value={item.protocol}
                  placeholder="Protocol"
                  onChange={(v) => setWorkup(i, { ...item, protocol: v })}
                />
                <TextInput
                  value={item.rationale}
                  placeholder="Why this test"
                  onChange={(v) => setWorkup(i, { ...item, rationale: v })}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <AddButton onClick={addWorkup}>+ Add test</AddButton>
        </div>
      </Section>

      <div className="mt-7 border-t border-line pt-4">
        <Advanced>
          <Field label="How Omari explains the routing" hint="May include placeholders like {specialistName}.">
            <TextArea
              value={node.reasoningTemplate}
              onChange={(v) => patch({ reasoningTemplate: v })}
            />
          </Field>
          <RawValue label="Node ID" value={node.id} />
        </Advanced>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Escalation editor                                                          */
/* -------------------------------------------------------------------------- */

function EscalationEditor({
  node,
  onUpdate,
}: {
  node: EscalationNode
  onUpdate: EditorPanelProps['onUpdate']
}) {
  const patch = (partial: Partial<EscalationNode>) =>
    onUpdate((n) => (n.type === 'escalation' ? { ...n, ...partial } : n))

  return (
    <div>
      <Section title="Human review">
        <Field label="Why this needs a person" hint="Shown when the tree hands off instead of routing automatically.">
          <TextArea value={node.reason} rows={5} onChange={(v) => patch({ reason: v })} />
        </Field>
      </Section>

      <div className="mt-7 border-t border-line pt-4">
        <Advanced>
          <RawValue label="Node ID" value={node.id} />
        </Advanced>
      </div>
    </div>
  )
}

export default EditorPanel
