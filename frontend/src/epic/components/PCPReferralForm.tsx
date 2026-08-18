import { useState } from 'react'
import EpicContainer from './EpicContainer'
import PatientHeaderBanner from './PatientHeaderBanner'
import { createReferral } from '../../lib/api'

/**
 * Act 1 — PCP Referral Order Entry
 *
 * Looks like an Epic order form where the PCP composes and signs a referral
 * to a specialty clinic. On "Accept & Sign", it POSTs to the backend which
 * auto-routes via the Omari engine.
 */

interface PCPReferralFormProps {
  /** Called after the referral is successfully submitted */
  onSubmitted?: (result: { id: string; display_id: string }) => void
}

/** Pre-filled patient for the demo (matches seeded Marla Testfield) */
const DEMO_PATIENT = {
  name: 'Testfield, Marla',
  mrn: 'MRN-4839201',
  dob: '03/12/1974',
  sex: 'F',
}

interface FormState {
  serviceRequested: string
  targetDepartment: string
  priority: 'routine' | 'urgent'
  primaryDx: string
  clinicalNotes: string
  attachments: { id: string; name: string; checked: boolean }[]
  isSubmitting: boolean
  isSigned: boolean
}

const INITIAL_STATE: FormState = {
  serviceRequested: 'Referral to Peripheral Nerve / Hand Surgery',
  targetDepartment: 'Duke Nerve Center',
  priority: 'routine',
  primaryDx: 'G56.01 - Carpal tunnel syndrome, right upper limb',
  clinicalNotes:
    'Patient with 4 months of numbness/tingling in right thumb, index, and long fingers. ' +
    'Worse at night. EMG confirms moderate median neuropathy at wrist. Failed 8 weeks of splinting.',
  attachments: [
    { id: 'emg', name: 'EMG/NCS Report — Right Upper Extremity (06/30/2026)', checked: true },
    { id: 'note', name: 'Office Visit Note (07/15/2026)', checked: true },
  ],
  isSubmitting: false,
  isSigned: false,
}

export default function PCPReferralForm({ onSubmitted }: PCPReferralFormProps) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE)

  const handleSign = async () => {
    setForm((f) => ({ ...f, isSubmitting: true }))

    try {
      const result = await createReferral({
        patient: {
          first_name: 'Marla',
          last_name: 'Testfield',
          mrn: 'MRN-4839201',
          dob: '1974-03-12',
          sex: 'F',
          phone: '(919) 555-0182',
        },
        referred_by: {
          provider_name: 'Dr. Alan Pemberly',
          practice_name: 'Cary Family Medicine',
          npi: '1740283915',
          phone: '(919) 555-0114',
          fax: '(919) 555-0115',
        },
        channel: 'epic',
        priority: form.priority,
        reason_for_referral: `${form.primaryDx} — ${form.serviceRequested}`,
        clinical_note: form.clinicalNotes,
        tree_id: 'duke-nerve-center-v1',
        extraction: {
          variables: {
            urgentRedFlag: { value: 'none', confidence: 0.97 },
            presentationCategory: { value: 'compression', confidence: 0.95 },
            laterality: { value: 'one_side', confidence: 0.94 },
            primarySymptom: { value: 'numbness_tingling', confidence: 0.92 },
            symptomRegion: { value: 'wrist', confidence: 0.93 },
            nerveStudyStatus: { value: 'done_abnormal', confidence: 0.9 },
          },
        },
        structured_data: {
          diagnoses: [{ icd10: 'G56.01', description: 'Carpal tunnel syndrome, right upper limb' }],
        },
      })

      setForm((f) => ({ ...f, isSubmitting: false, isSigned: true }))
      onSubmitted?.(result)
    } catch (err) {
      console.error('Failed to submit referral:', err)
      setForm((f) => ({ ...f, isSubmitting: false }))
    }
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const inputClass =
    'w-full rounded border px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--epic-blue)]/30 focus:border-[var(--epic-blue)]'

  return (
    <EpicContainer
      title="Orders — Referral"
      subtitle="Cary Family Medicine"
      headerRight={
        <span className="text-[12px] text-white/80">Dr. Alan Pemberly</span>
      }
    >
      <PatientHeaderBanner
        name={DEMO_PATIENT.name}
        mrn={DEMO_PATIENT.mrn}
        dob={DEMO_PATIENT.dob}
        sex={DEMO_PATIENT.sex}
      />

      <div className="mx-auto max-w-3xl p-6">
        {form.isSigned ? (
          <SignedConfirmation />
        ) : (
          <div className="epic-card p-6">
            {/* Order search header */}
            <div className="mb-5 flex items-center gap-2 border-b pb-4" style={{ borderColor: 'var(--epic-border-light)' }}>
              <SearchIcon />
              <span className="text-[13px] font-medium" style={{ color: 'var(--epic-text-muted)' }}>
                Order:
              </span>
              <span className="text-[14px] font-semibold" style={{ color: 'var(--epic-text-main)' }}>
                {form.serviceRequested}
              </span>
            </div>

            {/* Form fields */}
            <div className="space-y-4">
              <FormGroup label="Service Requested">
                <input
                  className={inputClass}
                  style={{ borderColor: 'var(--epic-border)' }}
                  value={form.serviceRequested}
                  onChange={(e) => update('serviceRequested', e.target.value)}
                />
              </FormGroup>

              <FormGroup label="To Department">
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    style={{ borderColor: 'var(--epic-border)' }}
                    value={form.targetDepartment}
                    onChange={(e) => update('targetDepartment', e.target.value)}
                  />
                  <OmariRouteBadge />
                </div>
              </FormGroup>

              <FormGroup label="Priority">
                <div className="flex gap-4">
                  {(['routine', 'urgent'] as const).map((p) => (
                    <label key={p} className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input
                        type="radio"
                        name="priority"
                        checked={form.priority === p}
                        onChange={() => update('priority', p)}
                        className="accent-[var(--epic-blue)]"
                      />
                      <span className="capitalize">{p}</span>
                    </label>
                  ))}
                </div>
              </FormGroup>

              <FormGroup label="Primary Diagnosis">
                <input
                  className={inputClass}
                  style={{ borderColor: 'var(--epic-border)' }}
                  value={form.primaryDx}
                  onChange={(e) => update('primaryDx', e.target.value)}
                />
              </FormGroup>

              <FormGroup label="Clinical Reason / Notes">
                <textarea
                  className={`${inputClass} min-h-[100px] resize-y`}
                  style={{ borderColor: 'var(--epic-border)' }}
                  value={form.clinicalNotes}
                  onChange={(e) => update('clinicalNotes', e.target.value)}
                />
              </FormGroup>

              <FormGroup label="Attached Documents">
                <div className="space-y-2">
                  {form.attachments.map((att) => (
                    <label key={att.id} className="flex items-center gap-2 text-[13px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={att.checked}
                        onChange={() => {
                          setForm((f) => ({
                            ...f,
                            attachments: f.attachments.map((a) =>
                              a.id === att.id ? { ...a, checked: !a.checked } : a
                            ),
                          }))
                        }}
                        className="accent-[var(--epic-blue)]"
                      />
                      <PaperclipIcon />
                      <span>{att.name}</span>
                    </label>
                  ))}
                </div>
              </FormGroup>
            </div>

            {/* Action footer */}
            <div className="mt-6 flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--epic-border-light)' }}>
              <OmariRouteBadge />
              <div className="flex gap-3">
                <button className="epic-btn epic-btn-secondary">Cancel</button>
                <button
                  className="epic-btn epic-btn-primary"
                  onClick={handleSign}
                  disabled={form.isSubmitting}
                >
                  {form.isSubmitting ? 'Signing…' : 'Accept & Sign'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EpicContainer>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function FormGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-semibold" style={{ color: 'var(--epic-text-muted)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function OmariRouteBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: 'var(--epic-green-light)', color: '#065F46' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--epic-green)' }} />
      Omari Auto-Route Enabled
    </span>
  )
}

function SignedConfirmation() {
  return (
    <div className="epic-card mx-auto max-w-md p-8 text-center">
      <div
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'var(--epic-green-light)' }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 className="text-[18px] font-bold" style={{ color: 'var(--epic-text-main)' }}>
        Referral Signed & Dispatched
      </h2>
      <p className="mt-2 text-[13px]" style={{ color: 'var(--epic-text-muted)' }}>
        Your referral has been sent to Duke Nerve Center. Omari will automatically
        route it to the appropriate specialist and notify you when it's been reviewed.
      </p>
      <div className="mt-4 inline-flex items-center gap-2">
        <OmariRouteBadge />
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--epic-text-muted)" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--epic-text-muted)" strokeWidth="2">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  )
}
