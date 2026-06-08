import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  CheckCircle2,
  CalendarPlus,
  ArrowRight,
  ClipboardCheck,
  ShieldCheck,
  Stethoscope,
  FileText,
  ChevronRight,
  BookOpen,
  Settings as SettingsIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, Pill, SectionHeader } from '../components/ui'
import { useToast } from '../components/Toast'
import BookingModal, { type BookingConfig } from '../components/BookingModal'

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

/* ---- Care path stepper ---- */
type Stage = { label: string; caption: string; status: 'done' | 'current' | 'upcoming' }

const stages: Stage[] = [
  { label: 'Referral', caption: 'Received & reviewed', status: 'done' },
  { label: 'Workup', caption: 'EMG nerve study', status: 'current' },
  { label: 'Surgical Eval', caption: 'Specialist visit', status: 'upcoming' },
]

/* ---- Recent activity feed ---- */
type ActivityItem = {
  icon: LucideIcon
  text: string
  time: string
  tone: 'blue' | 'green'
}

const activity: ActivityItem[] = [
  {
    icon: ClipboardCheck,
    text: 'Your care team reviewed your intake',
    time: 'Today · 8:40 AM',
    tone: 'blue',
  },
  {
    icon: FileText,
    text: 'EMG order is ready to schedule',
    time: 'Today · 8:41 AM',
    tone: 'blue',
  },
  {
    icon: CheckCircle2,
    text: 'Intake completed',
    time: 'Jun 2',
    tone: 'green',
  },
  {
    icon: ShieldCheck,
    text: 'Insurance verified — Blue Shield PPO',
    time: 'May 30',
    tone: 'green',
  },
  {
    icon: Stethoscope,
    text: 'Referral received from Dr. Lin',
    time: 'May 28',
    tone: 'green',
  },
]

export default function Home() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [bookingOpen, setBookingOpen] = useState(false)
  const [emgBooked, setEmgBooked] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <p className="text-[13px] font-medium text-slate-400">Good morning</p>
        <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-tight text-blume-dark">
          Sarah Chen
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
      {/* Status banner — one clear current state */}
      <Card>
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blume-mist text-blume">
            <Activity className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <Pill tone="info">Referral in progress</Pill>
            <h2 className="mt-3 text-xl font-semibold tracking-tight text-blume-dark">
              Your referral is being processed
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
              You're being seen for{' '}
              <span className="font-medium text-blume-dark">
                numbness &amp; tingling in your right arm
              </span>
              . Next step: get your EMG nerve study so your specialist can plan
              your care.
            </p>
            <button
              onClick={() => navigate('/referral')}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blume transition-colors duration-200 hover:text-blume-dark"
            >
              View referral status <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Card>

      {/* Progress tracker */}
      <Card>
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight text-blume-dark">
            Your path to a surgical visit
          </h3>
          <span className="text-xs font-medium text-slate-400">Step 2 of 3</span>
        </div>

        <div className="flex items-start">
          {stages.map((s, i) => {
            const isLast = i === stages.length - 1
            return (
              <div key={s.label} className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  {/* left connector */}
                  <span
                    className={`h-1 flex-1 rounded-full ${
                      i === 0
                        ? 'bg-transparent'
                        : s.status === 'upcoming'
                          ? 'bg-blume-mist'
                          : 'bg-blume'
                    }`}
                  />
                  {/* node */}
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
                      s.status === 'done'
                        ? 'bg-blume text-white'
                        : s.status === 'current'
                          ? 'bg-blume-dark text-white ring-4 ring-blume-light/40'
                          : 'bg-blume-mist text-blume-light'
                    }`}
                  >
                    {s.status === 'done' ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  {/* right connector */}
                  <span
                    className={`h-1 flex-1 rounded-full ${
                      isLast
                        ? 'bg-transparent'
                        : stages[i + 1].status === 'upcoming'
                          ? 'bg-blume-mist'
                          : 'bg-blume'
                    }`}
                  />
                </div>
                <p
                  className={`mt-2.5 text-center text-[13px] font-semibold ${
                    s.status === 'upcoming' ? 'text-slate-400' : 'text-blume-dark'
                  }`}
                >
                  {s.label}
                </p>
                <p className="text-center text-[11px] leading-tight text-slate-400">
                  {s.caption}
                </p>
                {s.status === 'current' && (
                  <span className="mt-2 rounded-full bg-blume-mist px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-blume">
                    You are here
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* What you need to do next */}
      <div>
        <SectionHeader
          title={emgBooked ? "You're on track" : 'What you need to do next'}
        />

        {emgBooked ? (
          <Card className="ring-1 ring-emerald-100">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold text-blume-dark">
                  EMG nerve study booked
                </h3>
                <p className="mt-1 text-sm font-medium text-emerald-700">
                  {emgBooked}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                  We'll send a reminder and prep tips before your visit. Next up:
                  your MRI on Jun 18.
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate('/journey')}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
            >
              View my care journey <ArrowRight className="h-4 w-4" />
            </button>
          </Card>
        ) : (
          <Card className="ring-1 ring-blume-light/30">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blume-mist text-blume">
                <CalendarPlus className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold text-blume-dark">
                  Schedule your EMG nerve study
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                  This quick test measures the nerves in your arm. Your
                  specialist needs the results before your surgical evaluation.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill>~45 minutes</Pill>
                  <Pill>Covered by insurance</Pill>
                </div>
              </div>
            </div>

            <button
              onClick={() => setBookingOpen(true)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blume px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blume-dark hover:shadow-soft active:scale-[0.98]"
            >
              <CalendarPlus className="h-4 w-4" />
              Schedule EMG
            </button>
            <button
              onClick={() =>
                showToast('A care coordinator will call you shortly.', 'info')
              }
              className="mt-2 w-full rounded-xl px-5 py-2.5 text-sm font-medium text-slate-500 transition-colors duration-200 hover:text-blume"
            >
              Prefer we call you? Request a callback
            </button>
          </Card>
        )}
      </div>

        </div>

        {/* Right rail */}
        <div className="space-y-6">
      {/* Explore */}
      <div>
        <SectionHeader title="More from your front desk" />
        <div className="grid grid-cols-2 gap-3">
          <Card onClick={() => navigate('/resources')} className="flex flex-col gap-3 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blume-mist text-blume">
              <BookOpen className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-blume-dark">
                Learn about your condition
              </p>
              <p className="mt-0.5 text-xs text-slate-400">Guides for you</p>
            </div>
          </Card>
          <Card onClick={() => navigate('/settings')} className="flex flex-col gap-3 p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blume-mist text-blume">
              <SettingsIcon className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-blume-dark">
                Settings &amp; access
              </p>
              <p className="mt-0.5 text-xs text-slate-400">Language, caregivers</p>
            </div>
          </Card>
        </div>
      </div>

      {/* Recent activity feed */}
      <div>
        <SectionHeader
          title="Recent activity"
          action={
            <button
              onClick={() => navigate('/journey')}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-blume transition-colors duration-200 hover:text-blume-dark"
            >
              View journey <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
        />

        <Card className="divide-y divide-slate-100 p-0">
          {activity.map((item, i) => (
            <button
              key={i}
              onClick={() => navigate('/journey')}
              className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors duration-200 hover:bg-slate-50/70"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  item.tone === 'blue'
                    ? 'bg-blume-mist text-blume'
                    : 'bg-emerald-50 text-emerald-600'
                }`}
              >
                <item.icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-blume-dark">
                  {item.text}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{item.time}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </button>
          ))}
        </Card>
      </div>

        </div>
      </div>

      {/* Reusable scheduling modal */}
      <BookingModal
        open={bookingOpen}
        config={emgBooking}
        onClose={() => setBookingOpen(false)}
        onBooked={(slot) => setEmgBooked(slot)}
      />
    </div>
  )
}
