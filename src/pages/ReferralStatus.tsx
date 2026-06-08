import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Circle,
  Copy,
  Stethoscope,
  ShieldCheck,
  UserRound,
  Clock,
  MessageCircle,
} from 'lucide-react'
import { Card, Pill, SectionHeader } from '../components/ui'
import { useToast } from '../components/Toast'

type Stage = {
  label: string
  detail: string
  status: 'done' | 'current' | 'pending'
}

const stages: Stage[] = [
  {
    label: 'Referral received',
    detail: 'Submitted by Dr. Lin on May 28',
    status: 'done',
  },
  {
    label: 'Insurance verified',
    detail: 'Blue Shield PPO · no prior auth needed',
    status: 'done',
  },
  {
    label: 'Triaged to specialist',
    detail: 'Routed to Neurology · Cervical Spine',
    status: 'done',
  },
  {
    label: 'Diagnostic workup',
    detail: 'EMG to be booked · MRI on Jun 18',
    status: 'current',
  },
  {
    label: 'Specialist review',
    detail: 'Dr. Li reviews EMG + MRI results',
    status: 'pending',
  },
  {
    label: 'Surgical evaluation scheduled',
    detail: 'Booked once workup is complete',
    status: 'pending',
  },
]

const caseDetails = [
  { icon: Stethoscope, label: 'Reason', value: 'Numbness & tingling, right arm' },
  { icon: UserRound, label: 'Referring provider', value: 'Dr. Marcus Lin' },
  { icon: ShieldCheck, label: 'Specialty', value: 'Neurology · Cervical Spine' },
  { icon: UserRound, label: 'Care coordinator', value: 'Maya Rivera' },
]

export default function ReferralStatus() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const refNumber = 'NR-2026-04821'

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 transition-colors duration-200 hover:text-blume-dark"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Status hero */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Pill tone="info">
              <Loader2 className="h-3 w-3 animate-spin" /> Active · In workup
            </Pill>
            <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-blume-dark">
              Referral Status
            </h1>
            <p className="mt-1.5 text-[15px] leading-relaxed text-slate-500">
              Your case is moving — workup is underway before your specialist
              visit.
            </p>
          </div>
          <button
            onClick={() => showToast('Reference number copied.', 'info')}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 transition-all duration-200 hover:border-slate-300 hover:text-blume-dark"
          >
            #{refNumber}
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </Card>

      {/* Next update */}
      <Card className="flex items-center gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blume-mist text-blume">
          <Clock className="h-[18px] w-[18px]" />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-blume-dark">
            Next update
          </p>
          <p className="text-[13px] text-slate-500">
            After your EMG is booked — typically within 2 business days.
          </p>
        </div>
      </Card>

      {/* Detailed progress */}
      <div>
        <SectionHeader title="Where your case stands" />
        <Card className="p-0">
          <div className="relative px-6 py-6">
            <div className="absolute bottom-10 left-[35px] top-10 w-px bg-slate-200" />
            <ul className="space-y-5">
              {stages.map((s) => (
                <li key={s.label} className="relative flex gap-3.5">
                  <span
                    className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      s.status === 'done'
                        ? 'bg-emerald-500 text-white'
                        : s.status === 'current'
                          ? 'bg-blume text-white ring-4 ring-blume-light/25'
                          : 'border border-slate-200 bg-white text-slate-300'
                    }`}
                  >
                    {s.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : s.status === 'current' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Circle className="h-2.5 w-2.5" />
                    )}
                  </span>
                  <div className="-mt-0.5">
                    <div className="flex items-center gap-2">
                      <p
                        className={`text-[13px] font-semibold ${
                          s.status === 'pending'
                            ? 'text-slate-400'
                            : 'text-blume-dark'
                        }`}
                      >
                        {s.label}
                      </p>
                      {s.status === 'current' && (
                        <span className="rounded-full bg-blume-mist px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-blume">
                          Now
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {/* Case details */}
      <div>
        <SectionHeader title="Case details" />
        <Card className="divide-y divide-slate-100 p-0">
          {caseDetails.map((d) => (
            <div key={d.label} className="flex items-center gap-3 px-6 py-3.5">
              <d.icon className="h-[18px] w-[18px] shrink-0 text-slate-400" />
              <span className="text-[13px] text-slate-400">{d.label}</span>
              <span className="ml-auto text-right text-[13px] font-medium text-blume-dark">
                {d.value}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <button
        onClick={() => navigate('/messages')}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blume px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blume-dark hover:shadow-soft active:scale-[0.98]"
      >
        <MessageCircle className="h-4 w-4" /> Message your coordinator
      </button>
    </div>
  )
}
