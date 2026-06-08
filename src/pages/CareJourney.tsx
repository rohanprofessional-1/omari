import { useState } from 'react'
import {
  CheckCircle2,
  CalendarClock,
  CalendarPlus,
  Activity,
  ScanLine,
  Stethoscope,
  Info,
  ClipboardList,
  Lock,
  MapPin,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, PageHeader } from '../components/ui'
import { useToast } from '../components/Toast'
import BookingModal, { type BookingConfig } from '../components/BookingModal'

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const emgBooking: BookingConfig = {
  testName: 'EMG / Nerve Conduction Study',
  category: 'Neurodiagnostics',
  location: 'NerveRoute Clinic · Suite 200',
  duration: '~45 minutes',
  authStatus: 'verified',
  prep: [
    'Wear a short-sleeve shirt for easy arm access',
    'Skip lotions or oils on your arms that day',
    'Eat and take your medications normally',
    'Plan for about 45 minutes at the clinic',
  ],
}

type StepStatus = 'done' | 'current' | 'scheduled' | 'pending'

type Step = {
  id: string
  title: string
  icon: LucideIcon
  status: StepStatus
  date?: string
  why: string
  prep: string[]
}

const statusMeta: Record<
  StepStatus,
  { label: string; badge: string; node: string }
> = {
  done: {
    label: 'Completed',
    badge: 'bg-emerald-50 text-emerald-700',
    node: 'bg-emerald-500 text-white',
  },
  current: {
    label: 'Action needed',
    badge: 'bg-amber-50 text-amber-700',
    node: 'bg-blume-dark text-white ring-4 ring-blume-light/40',
  },
  scheduled: {
    label: 'Scheduled',
    badge: 'bg-blume-mist text-blume',
    node: 'bg-blume text-white',
  },
  pending: {
    label: 'Pending workup',
    badge: 'bg-slate-100 text-slate-500',
    node: 'bg-blume-mist text-blume-light',
  },
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function CareJourney() {
  const { showToast } = useToast()
  const [emgBooked, setEmgBooked] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const steps: Step[] = [
    {
      id: 'referral',
      title: 'Referral received',
      icon: Stethoscope,
      status: 'done',
      date: 'May 28, 2026',
      why: 'Your primary doctor flagged nerve symptoms in your arm and sent you to our specialty team for a closer look.',
      prep: ['Nothing needed — we took it from here.'],
    },
    {
      id: 'emg',
      title: 'Complete EMG nerve test',
      icon: Activity,
      status: emgBooked ? 'scheduled' : 'current',
      date: emgBooked ?? undefined,
      why: 'An EMG measures the electrical activity in your nerves and muscles. It pinpoints exactly where the nerve is being pinched so your specialist can plan the right care.',
      prep: [
        'Wear a short-sleeve shirt for easy arm access',
        'Skip lotions or oils on your arms that day',
        'Eat and take medications normally',
      ],
    },
    {
      id: 'mri',
      title: 'MRI of the neck & spine',
      icon: ScanLine,
      status: 'scheduled',
      date: 'Jun 18, 2026 · 2:15 PM',
      why: 'Detailed images show whether a disc or bone is pressing on the nerve root — the picture your surgeon needs alongside your EMG.',
      prep: [
        'Arrive 15 minutes early to check in',
        'Leave metal jewelry and watches at home',
        'Tell the tech about any implants or devices',
      ],
    },
    {
      id: 'surgical',
      title: 'See Dr. Li for surgical evaluation',
      icon: ClipboardList,
      status: 'pending',
      why: 'Dr. Li reviews your EMG and MRI together to decide whether a procedure can relieve the pressure and ease your symptoms.',
      prep: [
        'Unlocks once your EMG and MRI are complete',
        'Bring a list of questions and current medications',
      ],
    },
  ]

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="My Care Journey"
        subtitle="Your to-do list and care path, all in one place."
      />

      {/* Summary */}
      <Card className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.06em] text-slate-400">
            Current focus
          </p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-blume-dark">
            {emgBooked ? 'Workup in progress' : 'Schedule your EMG'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tracking-tight text-blume">
            {emgBooked ? '2' : '1'}
            <span className="text-slate-300">/4</span>
          </p>
          <p className="text-xs text-slate-400">steps moving</p>
        </div>
      </Card>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute bottom-8 left-[23px] top-8 w-0.5 bg-blume-mist" />
        <ul className="space-y-4">
          {steps.map((step) => {
            const meta = statusMeta[step.status]
            const isCurrent = step.status === 'current'
            const isPending = step.status === 'pending'
            return (
              <li key={step.id} className="relative flex gap-4">
                {/* node */}
                <span
                  className={`relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${meta.node}`}
                >
                  {step.status === 'done' ? (
                    <CheckCircle2 className="h-6 w-6" />
                  ) : isPending ? (
                    <Lock className="h-5 w-5" />
                  ) : (
                    <step.icon className="h-6 w-6" />
                  )}
                </span>

                {/* card */}
                <div
                  className={`flex-1 rounded-3xl border bg-white p-5 shadow-card transition-all duration-300 ${
                    isCurrent
                      ? 'border-blume-light/60 ring-1 ring-blume-light/30'
                      : 'border-slate-200/70'
                  } ${isPending ? 'opacity-75' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-blume-dark">
                      {step.title}
                    </h3>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${meta.badge}`}
                    >
                      {meta.label}
                    </span>
                  </div>

                  {/* date / booked row */}
                  {step.date && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-blume">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {step.date}
                    </p>
                  )}

                  {/* why this matters */}
                  <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-blume-cloud px-4 py-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-blume" />
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-blume">
                        Why this matters
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
                        {step.why}
                      </p>
                    </div>
                  </div>

                  {/* prep instructions */}
                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                      How to prepare
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {step.prep.map((p) => (
                        <li
                          key={p}
                          className="flex items-start gap-2.5 text-[13px] leading-relaxed text-slate-600"
                        >
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-blume-light" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* actions */}
                  {step.id === 'emg' && !emgBooked && (
                    <button
                      onClick={() => setModalOpen(true)}
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blume px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blume-dark hover:shadow-soft active:scale-[0.98]"
                    >
                      <CalendarPlus className="h-4 w-4" /> Book appointment
                    </button>
                  )}

                  {step.id === 'emg' && emgBooked && (
                    <div className="mt-5 space-y-2">
                      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
                        <CheckCircle2 className="h-4 w-4" /> Booked — see you{' '}
                        {emgBooked}
                      </div>
                      <button
                        onClick={() => {
                          setEmgBooked(null)
                          showToast('Appointment released — pick a new time.', 'info')
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
                      >
                        Reschedule
                      </button>
                    </div>
                  )}

                  {step.id === 'mri' && (
                    <button
                      onClick={() =>
                        showToast('Opening directions to the Imaging Center…', 'info')
                      }
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
                    >
                      <MapPin className="h-4 w-4" /> Get directions
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Reusable scheduling modal */}
      <BookingModal
        open={modalOpen}
        config={emgBooking}
        onClose={() => setModalOpen(false)}
        onBooked={(slot) => setEmgBooked(slot)}
      />
    </div>
  )
}
