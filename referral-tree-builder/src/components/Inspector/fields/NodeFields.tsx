/**
 * Inspector field components — one per node type.
 * ─────────────────────────────────────────────────────────────────────────────
 * Each component receives the node's meta and an onChange callback.
 * They are co-located in one file for easy scanning, but split into named
 * exports so the Inspector can import only what it needs.
 *
 * To add fields for a new node type:
 *   1. Create a new export here following the same pattern.
 *   2. Register it in the FIELD_MAP in Inspector.tsx.
 *   That's it.
 */

import React from 'react'
import type {
  ConditionMeta, RoutingMeta, WorkupMeta, RedirectMeta, EscalationMeta,
  PriorTxMeta, LateralityMeta, ImagingGateMeta,
  AttrAgeMeta, AttrGenderMeta, AttrCustomMeta,
  NodeMeta,
} from '../../../types'
import styles from '../Inspector.module.css'

// ── Shared primitives ─────────────────────────────────────────────────────────

interface FieldProps { label: string; children: React.ReactNode }
export function Field({ label, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  )
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export function Input(props: InputProps) {
  return <input className={styles.input} {...props} />
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
export function Textarea(props: TextareaProps) {
  return <textarea className={styles.input} {...props} />
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<string | { value: string; label: string }>
}
export function Select({ options, ...rest }: SelectProps) {
  return (
    <select className={styles.select} {...rest}>
      <option value="">Select…</option>
      {options.map(o => {
        const val = typeof o === 'string' ? o : o.value
        const lbl = typeof o === 'string' ? o : o.label
        return <option key={val} value={val}>{lbl}</option>
      })}
    </select>
  )
}

// ─── Type-specific field panels ───────────────────────────────────────────────

type OnChange = (patch: Partial<NodeMeta>) => void

// ── Condition ────────────────────────────────────────────────────────────────

export function ConditionFields({ meta, onChange }: { meta: ConditionMeta; onChange: OnChange }) {
  return (
    <>
      <Field label="Question shown to patient">
        <Textarea rows={2} value={meta.question} onChange={e => onChange({ question: e.target.value } as any)} />
      </Field>
      <Field label="Input variable (used by engine)">
        <Input value={meta.inputVar} placeholder="e.g. emg_status" onChange={e => onChange({ inputVar: e.target.value } as any)} />
      </Field>
      <Field label="Description (optional)">
        <Input value={meta.description} placeholder="Internal note" onChange={e => onChange({ description: e.target.value } as any)} />
      </Field>
    </>
  )
}

// ── Routing ──────────────────────────────────────────────────────────────────

const URGENCY_OPTIONS = ['Routine', 'Soon (2–4 wks)', 'Urgent (< 2 wks)', 'Emergent']

export function RoutingFields({ meta, onChange }: { meta: RoutingMeta; onChange: OnChange }) {
  return (
    <>
      <Field label="Route to">
        <Input value={meta.routeTo} placeholder="e.g. Dr. Li / General hand surgeon" onChange={e => onChange({ routeTo: e.target.value } as any)} />
      </Field>
      <Field label="Urgency">
        <Select value={meta.urgency} options={URGENCY_OPTIONS} onChange={e => onChange({ urgency: e.target.value } as any)} />
      </Field>
      <Field label="Notes">
        <Textarea rows={2} value={meta.notes} placeholder="Optional clinical note" onChange={e => onChange({ notes: e.target.value } as any)} />
      </Field>
    </>
  )
}

// ── Workup ───────────────────────────────────────────────────────────────────

const ORDER_TYPES = ['EMG/NCS', 'MRI', 'X-ray', 'CT', 'CT myelogram', 'Ultrasound', 'Labs', 'PT referral', 'Other']
const TIMING_OPTIONS = ['Before visit', 'During wait', 'At visit', 'After visit']

export function WorkupFields({ meta, onChange }: { meta: WorkupMeta; onChange: OnChange }) {
  return (
    <>
      <Field label="Order type">
        <Select value={meta.orderType} options={ORDER_TYPES} onChange={e => onChange({ orderType: e.target.value } as any)} />
      </Field>
      <Field label="Specific order">
        <Input value={meta.orderSpec} placeholder="e.g. EMG right upper extremity" onChange={e => onChange({ orderSpec: e.target.value } as any)} />
      </Field>
      <Field label="Timing">
        <Select value={meta.timing} options={TIMING_OPTIONS} onChange={e => onChange({ timing: e.target.value as any } as any)} />
      </Field>
    </>
  )
}

// ── Redirect ─────────────────────────────────────────────────────────────────

export function RedirectFields({ meta, onChange }: { meta: RedirectMeta; onChange: OnChange }) {
  return (
    <>
      <Field label="Trigger condition">
        <Input value={meta.trigger} placeholder="e.g. When EMG returns abnormal" onChange={e => onChange({ trigger: e.target.value } as any)} />
      </Field>
      <Field label="Re-enter at node">
        <Input value={meta.reenterAt} placeholder="e.g. Severity assessment" onChange={e => onChange({ reenterAt: e.target.value } as any)} />
      </Field>
    </>
  )
}

// ── Escalation ───────────────────────────────────────────────────────────────

export function EscalationFields({ meta, onChange }: { meta: EscalationMeta; onChange: OnChange }) {
  return (
    <Field label="Reason / instructions">
      <Textarea rows={3} value={meta.reason} onChange={e => onChange({ reason: e.target.value } as any)} />
    </Field>
  )
}

// ── Prior treatment ───────────────────────────────────────────────────────────

const TREATMENT_OPTIONS = [
  'Physical therapy', 'Injections (steroid)', 'Injections (PRP)',
  'Bracing / splinting', 'NSAIDs / medication', 'Chiropractic',
  'Occupational therapy', 'Surgery (prior)', 'Other',
]

export function PriorTxFields({ meta, onChange }: { meta: PriorTxMeta; onChange: OnChange }) {
  const toggle = (tx: string, checked: boolean) => {
    const next = checked
      ? [...(meta.treatments ?? []), tx]
      : (meta.treatments ?? []).filter(t => t !== tx)
    onChange({ treatments: next } as any)
  }

  return (
    <>
      <Field label="Treatments to check">
        <div className={styles.checkList}>
          {TREATMENT_OPTIONS.map(tx => (
            <label key={tx} className={styles.checkItem}>
              <input type="checkbox" checked={(meta.treatments ?? []).includes(tx)} onChange={e => toggle(tx, e.target.checked)} />
              {tx}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Min. duration (weeks)">
        <Input type="number" min={1} value={meta.minDuration} placeholder="e.g. 6" onChange={e => onChange({ minDuration: e.target.value } as any)} />
      </Field>
      <Field label="Required outcome to route as 'tried'">
        <Select value={meta.outcomeRequired} options={['failed', 'completed', 'any']} onChange={e => onChange({ outcomeRequired: e.target.value as any } as any)} />
      </Field>
    </>
  )
}

// ── Laterality ────────────────────────────────────────────────────────────────

const SIDES   = ['Left', 'Right', 'Bilateral', 'N/A']
const REGIONS = ['Cervical spine', 'Lumbar spine', 'Shoulder', 'Elbow', 'Wrist / hand', 'Hip', 'Knee', 'Ankle / foot', 'Brachial plexus', 'Other']

export function LateralityFields({ meta, onChange }: { meta: LateralityMeta; onChange: OnChange }) {
  return (
    <>
      <Field label="Side">
        <Select value={meta.side} options={SIDES} onChange={e => onChange({ side: e.target.value } as any)} />
      </Field>
      <Field label="Region">
        <Select value={meta.region} options={REGIONS} onChange={e => onChange({ region: e.target.value } as any)} />
      </Field>
      <Field label="Specific anatomy">
        <Input value={meta.anatomy} placeholder="e.g. Carpal tunnel, C5-C6 disc" onChange={e => onChange({ anatomy: e.target.value } as any)} />
      </Field>
    </>
  )
}

// ── Imaging gate ──────────────────────────────────────────────────────────────

const IMAGING_TYPES   = ['MRI', 'MRI with contrast', 'CT', 'CT myelogram', 'X-ray', 'Nerve ultrasound', 'EMG/NCS', 'Any']
const IMAGING_REGIONS = ['Cervical spine', 'Lumbar spine', 'Brachial plexus', 'Upper extremity', 'Lower extremity', 'Brain', 'Any']

export function ImagingGateFields({ meta, onChange }: { meta: ImagingGateMeta; onChange: OnChange }) {
  return (
    <>
      <Field label="Required imaging type">
        <Select value={meta.requiredType} options={IMAGING_TYPES} onChange={e => onChange({ requiredType: e.target.value } as any)} />
      </Field>
      <Field label="Required body region">
        <Select value={meta.requiredRegion} options={IMAGING_REGIONS} onChange={e => onChange({ requiredRegion: e.target.value } as any)} />
      </Field>
      <label className={styles.checkItem} style={{ marginTop: 4 }}>
        <input type="checkbox" checked={meta.requiresReport} onChange={e => onChange({ requiresReport: e.target.checked } as any)} />
        Radiology report required
      </label>
      <p className={styles.hint}>
        Pass = correct type + region{meta.requiresReport ? ' + report available' : ''}. Fail = any missing.
      </p>
    </>
  )
}

// ── Attr: Age ────────────────────────────────────────────────────────────────

const AGE_OPS = ['<', '<=', '>', '>=', '=', 'between']

export function AttrAgeFields({ meta, onChange }: { meta: AttrAgeMeta; onChange: OnChange }) {
  const preview = meta.operator === 'between'
    ? `age between ${meta.value || '?'} and ${meta.value2 || '?'}`
    : `age ${meta.operator || '?'} ${meta.value || '?'}`

  return (
    <>
      <Field label="Build age condition">
        <div className={styles.attrRow}>
          <span className={styles.attrKeyword}>age</span>
          <Select style={{ flex: 1 }} value={meta.operator} options={AGE_OPS} onChange={e => onChange({ operator: e.target.value as any } as any)} />
        </div>
        <div className={styles.attrRow} style={{ marginTop: 4 }}>
          <Input type="number" min={0} max={120} placeholder="value" value={meta.value} onChange={e => onChange({ value: e.target.value } as any)} />
          {meta.operator === 'between' && (
            <>
              <span className={styles.attrKeyword}>–</span>
              <Input type="number" min={0} max={120} placeholder="max" value={meta.value2} onChange={e => onChange({ value2: e.target.value } as any)} />
            </>
          )}
        </div>
      </Field>
      <div className={styles.preview}>{preview}</div>
    </>
  )
}

// ── Attr: Gender ─────────────────────────────────────────────────────────────

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Other']
const GENDER_OPS     = ['=', '!=']

export function AttrGenderFields({ meta, onChange }: { meta: AttrGenderMeta; onChange: OnChange }) {
  return (
    <>
      <Field label="Build gender condition">
        <div className={styles.attrRow}>
          <span className={styles.attrKeyword}>gender</span>
          <Select style={{ width: 60 }} value={meta.operator} options={GENDER_OPS} onChange={e => onChange({ operator: e.target.value as any } as any)} />
          <Select style={{ flex: 1 }} value={meta.value} options={GENDER_OPTIONS} onChange={e => onChange({ value: e.target.value } as any)} />
        </div>
      </Field>
      <div className={styles.preview}>gender {meta.operator} {meta.value || '?'}</div>
    </>
  )
}

// ── Attr: Custom ─────────────────────────────────────────────────────────────

const CUSTOM_OPS = ['=', '!=', '<', '<=', '>', '>=', 'contains']

export function AttrCustomFields({ meta, onChange }: { meta: AttrCustomMeta; onChange: OnChange }) {
  const preview = `${meta.attribute || 'attr'} ${meta.operator} ${meta.value || '?'}`

  return (
    <>
      <Field label="Build custom condition">
        <Input placeholder="attribute name (e.g. insurance_type)" value={meta.attribute} onChange={e => onChange({ attribute: e.target.value } as any)} />
        <div className={styles.attrRow} style={{ marginTop: 4 }}>
          <Select style={{ width: 90 }} value={meta.operator} options={CUSTOM_OPS} onChange={e => onChange({ operator: e.target.value as any } as any)} />
          <Input style={{ flex: 1 }} placeholder="value" value={meta.value} onChange={e => onChange({ value: e.target.value } as any)} />
        </div>
      </Field>
      <div className={styles.preview}>{preview}</div>
    </>
  )
}
