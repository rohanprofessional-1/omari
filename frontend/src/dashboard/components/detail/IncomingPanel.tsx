import type { ReactNode } from 'react'
import { ageFromDob, formatDate } from '../../lib/demoClock'
import type { EpicReferralPayload } from '../../types'
import ChannelBadge from '../shared/ChannelBadge'

/**
 * Dashboard detail, left column — "what came in": the referral as a document
 * stack. Everything here is the referrer's input verbatim (note, diagnoses,
 * attachments, structured data); the tree's reading of it lives in the right
 * column.
 */

const CHANNEL_LABELS: Record<EpicReferralPayload['channel'], string> = {
  epic: 'Epic',
  fax: 'Fax',
  phone: 'Phone',
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-canvas p-4 ${className}`}>
      {children}
    </section>
  )
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</p>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5 text-[12.5px]">
      <span className="w-24 shrink-0 text-[11.5px] text-muted">{label}</span>
      <span className="min-w-0 text-ink">{children}</span>
    </div>
  )
}

/* ── Attachment icons ─────────────────────────────────────────────────────── */

function AttachmentIcon({ type }: { type: EpicReferralPayload['attachments'][number]['type'] }) {
  const paths: Record<typeof type, ReactNode> = {
    note: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9 13h6M9 17h6" />
      </>
    ),
    imaging: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="M21 15l-5-5L5 21" />
      </>
    ),
    emg: <path d="M3 12h4l2-7 4 14 2-7h6" />,
    labs: (
      <>
        <path d="M9 3v7l-5 8a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-5-8V3" />
        <path d="M7 3h10M8.5 14h7" />
      </>
    ),
    photo: (
      <>
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-muted"
    >
      {paths[type]}
    </svg>
  )
}

/* ── The panel ────────────────────────────────────────────────────────────── */

export default function IncomingPanel({ payload }: { payload: EpicReferralPayload }) {
  const { patient, referredBy, structured } = payload
  const hasStructured =
    Boolean(structured.vitals && Object.keys(structured.vitals).length > 0) ||
    Boolean(structured.meds?.length) ||
    Boolean(structured.problems?.length)

  return (
    <div className="space-y-3">
      {/* REFERRAL header card */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <Kicker>Referral</Kicker>
          <ChannelBadge channel={payload.channel} />
        </div>
        <div className="mt-2">
          <Field label="Referred by">
            <span className="font-medium">{referredBy.provider}</span>
            <span className="text-muted"> — {referredBy.practice}</span>
          </Field>
          <Field label="NPI">
            <span className="tabular-nums">{referredBy.npi}</span>
          </Field>
          <Field label="Phone">
            {referredBy.phone}
            {referredBy.fax && <span className="text-muted"> · fax {referredBy.fax}</span>}
          </Field>
          <Field label="Received">
            {formatDate(payload.receivedAt)}
            <span className="text-muted"> via {CHANNEL_LABELS[payload.channel]}</span>
          </Field>
          <Field label="Priority">
            <span className={payload.priority === 'urgent' ? 'font-medium text-danger' : ''}>
              {payload.priority}
            </span>
            <span className="text-muted"> (referrer-stated)</span>
          </Field>
          <Field label="Referred to">{payload.referredToDepartment}</Field>
        </div>
      </Card>

      {/* Reason + clinical note as prose */}
      <Card className="border-l-2 border-l-accent/30 bg-canvas">
        <Kicker>Reason for referral</Kicker>
        <p className="mt-1.5 text-[13px] font-medium leading-snug text-ink">
          {payload.reasonForReferral}
        </p>
        <p className="mt-2.5 max-w-prose text-[13px] leading-relaxed text-ink">
          {payload.clinicalNote}
        </p>
        {payload.channel === 'fax' && (
          <span className="mt-2.5 inline-flex items-center gap-1 rounded border border-line bg-bg px-1.5 py-0.5 text-[10.5px] text-muted">
            Faxed document — limited structured data
          </span>
        )}
      </Card>

      {/* Diagnoses */}
      {payload.diagnoses.length > 0 && (
        <Card>
          <Kicker>Diagnoses (ICD-10)</Kicker>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {payload.diagnoses.map((dx) => (
              <span
                key={dx.icd10}
                className="inline-flex items-baseline gap-1.5 rounded border border-line bg-bg px-1.5 py-0.5 text-[11px]"
              >
                <span className="font-semibold tabular-nums text-ink">{dx.icd10}</span>
                <span className="text-muted">{dx.description}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Attachments */}
      {payload.attachments.length > 0 && (
        <Card>
          <Kicker>Attachments</Kicker>
          <ul className="mt-1.5">
            {payload.attachments.map((att) => (
              <li
                key={att.title}
                className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-bg"
              >
                <AttachmentIcon type={att.type} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={att.title}>
                  {att.title}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">
                  {formatDate(att.date)}
                  {att.pages !== undefined && ` · ${att.pages} pg`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Structured data */}
      {hasStructured && (
        <Card>
          <Kicker>Structured data</Kicker>
          <div className="mt-2">
            {structured.vitals &&
              Object.entries(structured.vitals).map(([key, value]) => (
                <Field key={key} label={key.toUpperCase()}>
                  <span className="tabular-nums">{value}</span>
                </Field>
              ))}
            {structured.meds && structured.meds.length > 0 && (
              <Field label="Meds">{structured.meds.join(' · ')}</Field>
            )}
            {structured.problems && structured.problems.length > 0 && (
              <Field label="Problems">{structured.problems.join(' · ')}</Field>
            )}
          </div>
        </Card>
      )}

      {/* Patient demographics */}
      <Card>
        <Kicker>Patient</Kicker>
        <div className="mt-2">
          <Field label="Name">
            <span className="font-medium">{patient.name}</span>
          </Field>
          <Field label="DOB">
            {formatDate(patient.dob)}
            <span className="text-muted"> ({ageFromDob(patient.dob)}y)</span>
          </Field>
          <Field label="Sex">{patient.sex}</Field>
          <Field label="Phone">{patient.phone}</Field>
          <Field label="MRN">
            <span className="tabular-nums">{patient.mrn}</span>
          </Field>
        </div>
      </Card>
    </div>
  )
}
