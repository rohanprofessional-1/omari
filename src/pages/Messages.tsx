import { useEffect, useRef, useState } from 'react'
import {
  Send,
  ShieldCheck,
  ArrowLeft,
  ChevronRight,
  MessageSquare,
  Mail,
  Bell,
  CheckCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

type Message = { id: number; from: 'me' | 'them'; text: string; time: string }

type Thread = {
  id: string
  name: string
  role: string
  initials: string
  color: string
  unread: number
  messages: Message[]
}

const initialThreads: Thread[] = [
  {
    id: 'coordinator',
    name: 'Maya Rivera',
    role: 'Care Coordinator',
    initials: 'MR',
    color: 'bg-blume',
    unread: 1,
    messages: [
      {
        id: 1,
        from: 'them',
        text: "Hi Sarah! I'm Maya, your care coordinator. I'll be with you through your whole journey. 💙",
        time: 'Mon · 9:02 AM',
      },
      {
        id: 2,
        from: 'them',
        text: 'Your EMG order is ready — you can book it right from your Home screen whenever you are.',
        time: 'Mon · 9:03 AM',
      },
      {
        id: 3,
        from: 'me',
        text: 'Thank you! Is the EMG covered by my insurance?',
        time: 'Mon · 9:15 AM',
      },
      {
        id: 4,
        from: 'them',
        text: 'Yes — your Blue Shield PPO is verified and no prior authorization is needed. 👍',
        time: 'Mon · 9:17 AM',
      },
    ],
  },
  {
    id: 'scheduling',
    name: 'Neurodiagnostics Desk',
    role: 'EMG Scheduling',
    initials: 'ND',
    color: 'bg-violet-500',
    unread: 0,
    messages: [
      {
        id: 1,
        from: 'them',
        text: 'This is the NerveRoute scheduling desk. Your EMG / Nerve Conduction Study is not yet booked.',
        time: 'Tue · 8:30 AM',
      },
      {
        id: 2,
        from: 'them',
        text: 'Tap “Book appointment” on your Care Journey to choose a time that works for you.',
        time: 'Tue · 8:30 AM',
      },
    ],
  },
  {
    id: 'billing',
    name: 'Billing & Insurance',
    role: 'Patient Accounts',
    initials: '$',
    color: 'bg-emerald-500',
    unread: 0,
    messages: [
      {
        id: 1,
        from: 'them',
        text: 'Good news — your estimated out-of-pocket cost for the EMG is $0 after insurance.',
        time: 'Tue · 11:40 AM',
      },
      {
        id: 2,
        from: 'me',
        text: 'That’s a relief, thank you for confirming!',
        time: 'Tue · 12:05 PM',
      },
    ],
  },
]

/* ---- Multi-channel reminders ---- */
type Reminder = {
  channel: 'SMS' | 'Email' | 'Push'
  title: string
  body: string
  time: string
  status: 'Delivered' | 'Opened' | 'Scheduled'
}

const reminders: Reminder[] = [
  {
    channel: 'SMS',
    title: 'Complete your EMG nerve study',
    body: 'Hi Sarah, your EMG isn’t booked yet. Tap to choose a time: blume.health/emg',
    time: 'Today · 8:45 AM',
    status: 'Delivered',
  },
  {
    channel: 'Email',
    title: 'Appointment confirmed — MRI',
    body: 'Your MRI is scheduled for Jun 18 at 2:15 PM. Prep instructions attached.',
    time: 'Yesterday · 4:10 PM',
    status: 'Opened',
  },
  {
    channel: 'Push',
    title: 'Your pre-op instructions are ready',
    body: 'New document available in your vault: Pre-op Instructions.',
    time: 'Yesterday · 1:20 PM',
    status: 'Delivered',
  },
  {
    channel: 'SMS',
    title: 'Insurance verified',
    body: 'Your Blue Shield PPO coverage is confirmed. No prior auth needed.',
    time: 'May 30 · 9:18 AM',
    status: 'Delivered',
  },
  {
    channel: 'Email',
    title: 'Reminder: surgical evaluation prep',
    body: 'Once your EMG & MRI are complete, we’ll book your visit with Dr. Li.',
    time: 'Scheduled for Jun 19',
    status: 'Scheduled',
  },
]

const channelMeta: Record<
  Reminder['channel'],
  { icon: LucideIcon; cls: string; label: string }
> = {
  SMS: { icon: MessageSquare, cls: 'bg-blume-mist text-blume', label: 'SMS sent' },
  Email: { icon: Mail, cls: 'bg-violet-50 text-violet-600', label: 'Email' },
  Push: { icon: Bell, cls: 'bg-amber-50 text-amber-600', label: 'Push' },
}

const statusCls: Record<Reminder['status'], string> = {
  Delivered: 'text-emerald-600',
  Opened: 'text-blume',
  Scheduled: 'text-slate-400',
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Messages() {
  const [tab, setTab] = useState<'inbox' | 'reminders'>('inbox')
  const [threads, setThreads] = useState<Thread[]>(initialThreads)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const openThread = threads.find((t) => t.id === openId) ?? null

  useEffect(() => {
    if (openThread) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [openThread])

  const totalUnread = threads.reduce((n, t) => n + t.unread, 0)

  const open = (id: string) => {
    setOpenId(id)
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, unread: 0 } : t)),
    )
  }

  const send = () => {
    const text = draft.trim()
    if (!text || !openId) return
    const now = new Date().toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })
    setThreads((prev) =>
      prev.map((t) =>
        t.id === openId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { id: Date.now(), from: 'me', text, time: `Now · ${now}` },
              ],
            }
          : t,
      ),
    )
    setDraft('')
  }

  /* ---------------- Conversation pane ---------------- */
  const conversationPane = openThread ? (
    <>
      <div className="flex items-center gap-3 border-b border-slate-100 p-4">
        <button
          onClick={() => setOpenId(null)}
          className="rounded-full p-2 text-blume transition hover:bg-blume-mist md:hidden"
          aria-label="Back to inbox"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white ${openThread.color}`}
        >
          {openThread.initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-blume-dark">
            {openThread.name}
          </p>
          <p className="truncate text-xs text-slate-400">{openThread.role}</p>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
          <ShieldCheck className="h-4 w-4" /> Secure
        </span>
      </div>

      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto bg-blume-cloud/50 p-4">
        {openThread.messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${
              m.from === 'me' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[75%] rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-card ${
                m.from === 'me'
                  ? 'rounded-br-md bg-blume text-white'
                  : 'rounded-bl-md bg-white text-blume-dark'
              }`}
            >
              {m.text}
            </div>
            <span className="mt-1 px-1 text-[11px] text-slate-300">
              {m.time}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="flex items-center gap-2 border-t border-slate-100 p-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a secure message…"
          className="min-w-0 flex-1 rounded-2xl bg-slate-50 px-4 py-3 text-base text-blume-dark outline-none transition placeholder:text-slate-300 focus:bg-white focus:ring-2 focus:ring-blume-light/50"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blume text-white transition hover:bg-blume-dark active:scale-95 disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>
    </>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-blume-mist text-blume">
        <MessageSquare className="h-8 w-8" />
      </span>
      <p className="mt-4 text-base font-semibold text-blume-dark">
        Select a conversation
      </p>
      <p className="mt-1 max-w-xs text-sm text-slate-400">
        Choose a thread on the left to view and reply to messages from your care
        team.
      </p>
    </div>
  )

  /* ---------------- Render ---------------- */
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-blume-dark">
            Messages
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Secure messaging with your care team.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-blume-mist px-3 py-1.5 text-xs font-semibold text-blume">
          <ShieldCheck className="h-4 w-4" /> End-to-end encrypted · HIPAA-secure
        </span>
      </div>

      {/* Segmented control */}
      <div className="mt-4 flex max-w-sm gap-1 rounded-2xl bg-blume-mist p-1">
        {(['inbox', 'reminders'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition ${
              tab === t ? 'bg-white text-blume-dark shadow-card' : 'text-blume'
            }`}
          >
            {t === 'inbox' ? 'Messages' : 'Reminders'}
            {t === 'inbox' && totalUnread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blume px-1.5 text-[11px] font-semibold text-white">
                {totalUnread}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Reminders feed */}
      {tab === 'reminders' ? (
        <div className="no-scrollbar mt-4 flex-1 overflow-y-auto">
          <p className="mb-3 text-sm leading-relaxed text-slate-500">
            We keep you on track across SMS, email, and push so nothing slips
            through the cracks.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {reminders.map((r, i) => {
              const meta = channelMeta[r.channel]
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-3xl bg-white p-4 shadow-card"
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${meta.cls}`}
                  >
                    <meta.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                        {meta.label}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {r.time}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-blume-dark">
                      {r.title}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-500">
                      {r.body}
                    </p>
                    <span
                      className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold ${statusCls[r.status]}`}
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> {r.status}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* Two-pane inbox */
        <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[340px_1fr]">
          {/* Thread list */}
          <div
            className={`${
              openThread ? 'hidden md:flex' : 'flex'
            } min-h-0 flex-col`}
          >
            <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
              {threads.map((t) => {
                const last = t.messages[t.messages.length - 1]
                const selected = openId === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => open(t.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition active:scale-[0.99] ${
                      selected
                        ? 'bg-blume-mist ring-2 ring-blume/30'
                        : 'bg-white shadow-card hover:shadow-soft'
                    }`}
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white ${t.color}`}
                    >
                      {t.initials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-blume-dark">
                          {t.name}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {last.time.replace('Now · ', '')}
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold text-blume">
                        {t.role}
                      </p>
                      <p
                        className={`mt-0.5 truncate text-sm ${
                          t.unread > 0
                            ? 'font-semibold text-blume-dark'
                            : 'text-slate-400'
                        }`}
                      >
                        {last.from === 'me' && 'You: '}
                        {last.text}
                      </p>
                    </div>
                    {t.unread > 0 ? (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blume px-1.5 text-[11px] font-semibold text-white">
                        {t.unread}
                      </span>
                    ) : (
                      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Conversation */}
          <div
            className={`${
              openThread ? 'flex' : 'hidden md:flex'
            } min-h-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white`}
          >
            {conversationPane}
          </div>
        </div>
      )}
    </div>
  )
}
