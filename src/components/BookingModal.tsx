import { useEffect, useMemo, useState } from 'react'
import {
  X,
  MapPin,
  Clock,
  Check,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  ChevronDown,
  Stethoscope,
} from 'lucide-react'
import { useToast } from './Toast'

/* ------------------------------------------------------------------ */
/* Public config — reuse this modal anywhere in the app               */
/* ------------------------------------------------------------------ */

export type AuthStatus = 'verified' | 'pending' | 'not-required'

export type BookingConfig = {
  testName: string
  category?: string
  location?: string
  duration?: string
  authStatus: AuthStatus
  prep: string[]
}

type Props = {
  open: boolean
  config: BookingConfig
  onClose: () => void
  onBooked: (slot: string) => void
}

/* ------------------------------------------------------------------ */
/* Fake availability — deterministic so the calendar feels real       */
/* ------------------------------------------------------------------ */

const YEAR = 2026
const MONTH = 5 // June (0-indexed)
const TODAY = 6
const MONTH_LABEL = 'June 2026'
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ALL_TIMES = [
  '8:30 AM',
  '9:00 AM',
  '10:00 AM',
  '11:30 AM',
  '1:15 PM',
  '2:00 PM',
  '3:30 PM',
  '4:15 PM',
]

function slotsForDay(day: number): string[] {
  const date = new Date(YEAR, MONTH, day)
  const weekday = date.getDay()
  if (weekday === 0 || weekday === 6) return [] // weekend
  if (day <= TODAY) return [] // past
  if (day % 7 === 4) return [] // pretend fully booked
  return ALL_TIMES.filter((_, i) => (i + day) % 3 === 0)
}

const authMeta: Record<
  AuthStatus,
  { icon: typeof ShieldCheck; label: string; sub: string; cls: string }
> = {
  verified: {
    icon: ShieldCheck,
    label: 'Insurance verified ✓',
    sub: 'No prior authorization needed for this test.',
    cls: 'bg-emerald-50 text-emerald-700',
  },
  pending: {
    icon: ShieldAlert,
    label: 'Prior auth pending',
    sub: "We'll confirm coverage within 1 business day — you can still hold a slot now.",
    cls: 'bg-amber-50 text-amber-700',
  },
  'not-required': {
    icon: ShieldCheck,
    label: 'No referral needed',
    sub: 'You can self-schedule this visit directly.',
    cls: 'bg-blume-mist text-blume',
  },
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function BookingModal({ open, config, onClose, onBooked }: Props) {
  const { showToast } = useToast()
  const [step, setStep] = useState<'select' | 'success'>('select')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [prepOpen, setPrepOpen] = useState(false)

  // reset whenever the modal is (re)opened
  useEffect(() => {
    if (open) {
      setStep('select')
      setSelectedDay(null)
      setSelectedTime(null)
      setPrepOpen(false)
    }
  }, [open])

  // build the calendar grid for the month
  const weeks = useMemo(() => {
    const firstWeekday = new Date(YEAR, MONTH, 1).getDay()
    const daysInMonth = new Date(YEAR, MONTH + 1, 0).getDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < firstWeekday; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    const rows: (number | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [])

  if (!open) return null

  const auth = authMeta[config.authStatus]
  const times = selectedDay ? slotsForDay(selectedDay) : []
  const canConfirm = selectedDay !== null && selectedTime !== null

  const slotLabel =
    selectedDay !== null && selectedTime
      ? `${WEEKDAY_NAMES[new Date(YEAR, MONTH, selectedDay).getDay()]}, Jun ${selectedDay} · ${selectedTime}`
      : ''

  const confirm = () => {
    if (!canConfirm) return
    setStep('success')
    showToast(`${config.testName} booked ✓`)
    onBooked(slotLabel)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-blume-dark/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="animate-fade-up relative z-10 flex max-h-[90vh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        {/* ---- Success state ---- */}
        {step === 'success' ? (
          <div className="flex flex-col items-center px-6 pb-8 pt-6 text-center">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />
            <div className="relative mb-5">
              <span className="absolute -inset-3 animate-ping rounded-full bg-emerald-200/50" />
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-soft">
                <CheckCircle2 className="h-9 w-9" />
              </span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-blume-dark">
              You're booked
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              A confirmation has been sent to your phone.
            </p>

            <div className="mt-5 w-full space-y-2.5 rounded-2xl bg-blume-cloud p-5 text-left">
              <div className="flex items-center gap-2.5">
                <Stethoscope className="h-[18px] w-[18px] text-blume" />
                <span className="text-[14px] font-semibold text-blume-dark">
                  {config.testName}
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-sm text-slate-600">
                <CalendarPlus className="h-4 w-4 text-blume" />
                {slotLabel}
              </div>
              {config.location && (
                <div className="flex items-center gap-2.5 text-sm text-slate-600">
                  <MapPin className="h-4 w-4 text-blume" />
                  {config.location}
                </div>
              )}
            </div>

            <button
              onClick={() => showToast('Added to your calendar.', 'info')}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
            >
              <CalendarPlus className="h-4 w-4" /> Add to calendar
            </button>
            <button
              onClick={onClose}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-blume px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blume-dark hover:shadow-soft"
            >
              Done
            </button>
          </div>
        ) : (
          /* ---- Scheduling state ---- */
          <>
            {/* Header */}
            <div className="shrink-0 px-6 pt-4">
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  {config.category && (
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-blume">
                      {config.category}
                    </p>
                  )}
                  <h2 className="mt-0.5 text-xl font-semibold leading-tight tracking-tight text-blume-dark">
                    {config.testName}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                    {config.location && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-blume" />
                        {config.location}
                      </span>
                    )}
                    {config.duration && (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-blume" />
                        {config.duration}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Auth status */}
              <div
                className={`mt-4 flex items-start gap-2.5 rounded-xl px-4 py-3 ring-1 ring-inset ring-black/5 ${auth.cls}`}
              >
                <auth.icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-[13px] font-semibold">{auth.label}</p>
                  <p className="text-xs opacity-90">{auth.sub}</p>
                </div>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="no-scrollbar flex-1 overflow-y-auto px-6 py-4">
              {/* Calendar */}
              <div className="rounded-2xl border border-slate-200/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <button
                    disabled
                    className="rounded-full p-1.5 text-slate-300"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <p className="text-sm font-bold text-blume-dark">
                    {MONTH_LABEL}
                  </p>
                  <button
                    onClick={() =>
                      showToast('Showing the soonest available dates.', 'info')
                    }
                    className="rounded-full p-1.5 text-blume transition hover:bg-blume-mist"
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>

                <div className="mb-1 grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((d, i) => (
                    <div
                      key={i}
                      className="py-1 text-center text-xs font-bold text-slate-300"
                    >
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {weeks.flat().map((day, i) => {
                    if (day === null) return <div key={i} />
                    const available = slotsForDay(day).length > 0
                    const selected = selectedDay === day
                    return (
                      <button
                        key={i}
                        disabled={!available}
                        onClick={() => {
                          setSelectedDay(day)
                          setSelectedTime(null)
                        }}
                        className={`relative flex aspect-square items-center justify-center rounded-xl text-sm font-semibold transition ${
                          selected
                            ? 'bg-blume text-white shadow-soft'
                            : available
                              ? 'bg-blume-mist text-blume-dark hover:bg-blume-light/50'
                              : 'text-slate-300'
                        }`}
                      >
                        {day}
                        {available && !selected && (
                          <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-blume" />
                        )}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-blume" /> = days
                  with open appointments
                </p>
              </div>

              {/* Time slots */}
              {selectedDay !== null && (
                <div className="animate-fade-up mt-4">
                  <p className="mb-2.5 text-[13px] font-semibold text-blume-dark">
                    Available times ·{' '}
                    {WEEKDAY_NAMES[new Date(YEAR, MONTH, selectedDay).getDay()]},
                    Jun {selectedDay}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {times.map((time) => {
                      const active = selectedTime === time
                      return (
                        <button
                          key={time}
                          onClick={() => setSelectedTime(time)}
                          className={`rounded-xl border px-2 py-2.5 text-[13px] font-semibold transition-all duration-200 active:scale-95 ${
                            active
                              ? 'border-blume bg-blume text-white shadow-sm'
                              : 'border-slate-200 bg-white text-blume-dark hover:border-blume-light hover:bg-blume-cloud'
                          }`}
                        >
                          {time}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Prep instructions (collapsible) */}
              <button
                onClick={() => setPrepOpen((p) => !p)}
                className="mt-4 flex w-full items-center justify-between rounded-xl bg-blume-cloud px-4 py-3 text-left transition-colors duration-200 hover:bg-blume-mist"
              >
                <span className="text-[13px] font-semibold text-blume-dark">
                  How to prepare
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-blume transition-transform duration-200 ${
                    prepOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {prepOpen && (
                <ul className="animate-fade-up mt-2 space-y-1.5 px-1">
                  {config.prep.map((p) => (
                    <li
                      key={p}
                      className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-600"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-blume" />
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-100 px-6 py-4">
              <button
                onClick={confirm}
                disabled={!canConfirm}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blume px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blume-dark hover:shadow-soft active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-4 w-4" />
                {canConfirm ? `Confirm ${slotLabel}` : 'Select a date & time'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
