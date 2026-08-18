/**
 * PatientHeaderBanner — the yellow/amber patient context strip that appears
 * below the Epic nav in any patient-scoped view. Shows name, MRN, DOB, sex,
 * and an optional alert badge.
 */

interface PatientHeaderBannerProps {
  name: string
  mrn: string
  dob?: string
  sex?: string
  alert?: string
}

export default function PatientHeaderBanner({ name, mrn, dob, sex, alert }: PatientHeaderBannerProps) {
  return (
    <div
      className="flex items-center gap-4 border-b px-5 py-2"
      style={{
        background: '#FEF9E7',
        borderColor: 'var(--epic-border)',
      }}
    >
      {/* Patient icon */}
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full"
        style={{ background: 'var(--epic-navy-700)' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
        </svg>
      </div>

      {/* Name + identifiers */}
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-bold" style={{ color: 'var(--epic-text-main)' }}>
            {name}
          </span>
          {alert && (
            <span className="epic-badge epic-badge-red">{alert}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--epic-text-muted)' }}>
          <span>MRN: {mrn}</span>
          {dob && <span>DOB: {dob}</span>}
          {sex && <span>Sex: {sex}</span>}
        </div>
      </div>
    </div>
  )
}
