import type { ReactNode } from 'react'
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

/**
 * Blume — node editor side panel.
 *
 * Edits write back through `onUpdate` on every change, so the canvas `nodes`
 * state stays the single source of truth and edits persist after you click
 * away. There is intentionally NO local draft state to get out of sync.
 */
interface EditorPanelProps {
  treeNode: TreeNode
  onUpdate: (updater: (node: TreeNode) => TreeNode) => void
  onClose: () => void
}

const DATA_SOURCES: DataSource[] = ['patient', 'referral', 'record']
const URGENCIES: Urgency[] = ['routine', 'expedited', 'urgent']
const CONDITION_OPS: Condition['op'][] = ['equals', 'range', 'in']

function EditorPanel({ treeNode, onUpdate, onClose }: EditorPanelProps) {
  return (
    <aside className="omari-panel flex h-full w-80 shrink-0 flex-col border-l border-line bg-canvas">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Editing {treeNode.type}
          </p>
          <p className="font-mono text-xs text-muted">{treeNode.id}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-muted hover:bg-bg hover:text-ink"
          aria-label="Close editor"
        >
          ✕
        </button>
      </header>

      <div className="omari-panel-content flex-1 overflow-y-auto px-4 py-4">
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

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
      className={inputClass + ' resize-y'}
      rows={props.rows ?? 3}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

function Select<T extends string>(props: {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}) {
  return (
    <select
      className={inputClass}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

function SectionButton(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className="w-full rounded-md border border-dashed border-line py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-accent"
    >
      {props.children}
    </button>
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
        { label: 'New bucket', condition: { op: 'equals', value: '' }, nextNodeId: '' },
      ],
    })

  const removeBranch = (index: number) =>
    patch({ branches: node.branches.filter((_, i) => i !== index) })

  return (
    <div>
      <Field label="Variable key">
        <TextInput value={node.variableKey} onChange={(v) => patch({ variableKey: v })} />
      </Field>
      <Field label="Prompt">
        <TextArea value={node.prompt} onChange={(v) => patch({ prompt: v })} />
      </Field>
      <Field label="Data source">
        <Select
          value={node.dataSource}
          options={DATA_SOURCES}
          onChange={(v) => patch({ dataSource: v })}
        />
      </Field>

      <div className="mt-4 mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Branches / buckets
        </span>
        <span className="text-[10px] text-muted">{node.branches.length}</span>
      </div>

      <div className="space-y-3">
        {node.branches.map((branch, i) => (
          <div key={i} className="rounded-lg border border-line bg-bg p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase text-muted">
                Bucket {i + 1}
              </span>
              <button
                onClick={() => removeBranch(i)}
                className="text-xs text-danger hover:text-danger"
              >
                Remove
              </button>
            </div>
            <div className="mb-2">
              <TextInput
                value={branch.label}
                placeholder="Label (e.g. 65+)"
                onChange={(v) => setBranch(i, { ...branch, label: v })}
              />
            </div>
            <ConditionEditor
              condition={branch.condition}
              onChange={(condition) => setBranch(i, { ...branch, condition })}
            />
          </div>
        ))}
      </div>

      <div className="mt-3">
        <SectionButton onClick={addBranch}>+ Add bucket</SectionButton>
      </div>
    </div>
  )
}

function ConditionEditor({
  condition,
  onChange,
}: {
  condition: Condition
  onChange: (c: Condition) => void
}) {
  const onOpChange = (op: Condition['op']) => {
    if (op === condition.op) return
    if (op === 'equals') onChange({ op: 'equals', value: '' })
    else if (op === 'range') onChange({ op: 'range' })
    else onChange({ op: 'in', values: [] })
  }

  return (
    <div className="rounded-md border border-line bg-canvas p-2">
      <div className="mb-2">
        <Select value={condition.op} options={CONDITION_OPS} onChange={onOpChange} />
      </div>

      {condition.op === 'equals' && (
        <TextInput
          value={String(condition.value)}
          placeholder="Equals value"
          onChange={(v) => onChange({ op: 'equals', value: v })}
        />
      )}

      {condition.op === 'range' && (
        <div className="flex gap-2">
          <input
            type="number"
            className={inputClass}
            placeholder="min"
            value={condition.min ?? ''}
            onChange={(e) =>
              onChange({
                op: 'range',
                min: e.target.value === '' ? undefined : Number(e.target.value),
                max: condition.max,
              })
            }
          />
          <input
            type="number"
            className={inputClass}
            placeholder="max"
            value={condition.max ?? ''}
            onChange={(e) =>
              onChange({
                op: 'range',
                min: condition.min,
                max: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
        </div>
      )}

      {condition.op === 'in' && (
        <TextInput
          value={condition.values.join(', ')}
          placeholder="comma, separated, values"
          onChange={(v) =>
            onChange({
              op: 'in',
              values: v
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      )}
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
      <Field label="Specialist name">
        <TextInput value={node.specialistName} onChange={(v) => patch({ specialistName: v })} />
      </Field>
      <Field label="Specialty">
        <TextInput value={node.specialty} onChange={(v) => patch({ specialty: v })} />
      </Field>
      <Field label="Urgency">
        <Select
          value={node.urgency}
          options={URGENCIES}
          onChange={(v) => patch({ urgency: v })}
        />
      </Field>
      <Field label="Reasoning template">
        <TextArea
          value={node.reasoningTemplate}
          onChange={(v) => patch({ reasoningTemplate: v })}
        />
      </Field>

      <div className="mt-4 mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Workup
        </span>
        <span className="text-[10px] text-muted">{node.workup.length}</span>
      </div>

      <div className="space-y-3">
        {node.workup.map((item, i) => (
          <div key={i} className="rounded-lg border border-line bg-bg p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase text-muted">
                Test {i + 1}
              </span>
              <button
                onClick={() => removeWorkup(i)}
                className="text-xs text-danger hover:text-danger"
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
                placeholder="Rationale"
                onChange={(v) => setWorkup(i, { ...item, rationale: v })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <SectionButton onClick={addWorkup}>+ Add test</SectionButton>
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
    <Field label="Escalation reason">
      <TextArea value={node.reason} rows={5} onChange={(v) => patch({ reason: v })} />
    </Field>
  )
}

export default EditorPanel
