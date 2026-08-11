import { useState, useEffect, useRef } from 'react'

/**
 * DemoFlow — A hardcoded 4-scene demo page for Omari.
 *
 * Scene 1: Admin view (decision tree overview)
 * Scene 2: Patient chat (numbness → EMG question → few days → Dr. Reyes)
 * Scene 3: Surgeon/Dr. Reyes view (approve referral + workups)
 * Scene 4: Epic/MyChart iframe (patient sees approved referral)
 *
 * Each scene auto-advances on user action or has a "Next" button.
 * No auth required — accessible at /demo.
 */

type Scene = 'admin' | 'patient-chat' | 'surgeon' | 'epic'

interface ChatMsg {
  id: number
  from: 'bot' | 'patient'
  text: string
}

export default function DemoFlow() {
  const [scene, setScene] = useState<Scene>('admin')
  const [approved, setApproved] = useState(false)

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      {/* Demo navigation bar */}
      <DemoNavBar scene={scene} onScene={setScene} />

      {/* Scene content */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {scene === 'admin' && <AdminScene onNext={() => setScene('patient-chat')} />}
        {scene === 'patient-chat' && <PatientChatScene onNext={() => setScene('surgeon')} />}
        {scene === 'surgeon' && (
          <SurgeonScene onApprove={() => { setApproved(true); setScene('epic') }} />
        )}
        {scene === 'epic' && <EpicScene approved={approved} />}
      </main>
    </div>
  )
}


/* ─── Demo Nav Bar ────────────────────────────────────────────────────────── */

function DemoNavBar({ scene, onScene }: { scene: Scene; onScene: (s: Scene) => void }) {
  const steps: { key: Scene; label: string }[] = [
    { key: 'admin', label: '1. Admin View' },
    { key: 'patient-chat', label: '2. Patient Intake' },
    { key: 'surgeon', label: '3. Surgeon Review' },
    { key: 'epic', label: '4. Epic Integration' },
  ]

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-canvas px-6">
      <div className="flex items-center gap-2">
        <img src="/omari-logo.png" alt="" className="h-8 w-8 object-contain" />
        <span className="font-serif text-lg font-semibold text-accent-strong">Omari Demo</span>
      </div>
      <nav className="ml-6 inline-flex rounded-lg border border-line bg-bg p-0.5">
        {steps.map((s) => (
          <button
            key={s.key}
            onClick={() => onScene(s.key)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              scene === s.key
                ? 'bg-accent-strong text-white shadow-subtle'
                : 'text-muted hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>
    </header>
  )
}


/* ─── Scene 1: Admin View ─────────────────────────────────────────────────── */

function AdminScene({ onNext }: { onNext: () => void }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h2 className="font-display text-2xl font-bold text-ink">Clinic Administration</h2>
      <p className="mt-1 text-sm text-muted">
        Peripheral Nerve Injury — Decision Tree &amp; Specialist Directory
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Decision tree card */}
        <div className="rounded-xl border border-line bg-canvas p-5 shadow-subtle">
          <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted">
            Active Decision Tree
          </p>
          <p className="mt-2 text-lg font-semibold text-ink">Peripheral Nerve Assessment</p>
          <p className="mt-1 text-sm text-muted">
            3 nodes · 1 variable · 1 specialist · 1 escalation
          </p>
          <div className="mt-4 rounded-lg border border-line bg-bg p-4">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-nodevar" />
              <span className="text-sm font-medium">Presentation type?</span>
            </div>
            <div className="ml-6 mt-2 border-l-2 border-line pl-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">→ Acute / trauma</span>
                <span className="h-2.5 w-2.5 rounded-full bg-nodespec" />
                <span className="text-xs font-medium text-accent">Dr. Reyes</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">→ Unclear / complex</span>
                <span className="h-2.5 w-2.5 rounded-full bg-nodeesc" />
                <span className="text-xs font-medium text-nodeesc">Escalation</span>
              </div>
            </div>
          </div>
        </div>

        {/* Specialists card */}
        <div className="rounded-xl border border-line bg-canvas p-5 shadow-subtle">
          <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted">
            Specialist Directory
          </p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent font-bold text-sm">
                DR
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">Dr. Reyes</p>
                <p className="text-xs text-muted">Peripheral Nerve Surgery · Expedited</p>
              </div>
              <span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                Active
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={onNext}
          className="omari-grad omari-grad-hover rounded-md px-5 py-2.5 text-sm font-semibold text-white shadow-subtle"
        >
          Next: Patient Intake →
        </button>
      </div>
    </div>
  )
}


/* ─── Scene 2: Patient Chat (hardcoded conversation) ──────────────────────── */

const DEMO_CONVERSATION: ChatMsg[] = [
  { id: 1, from: 'bot', text: "Hi, I'm Omari — an AI care coordinator. I'll ask you a few questions so we can get you to exactly the right specialist. I'm not a doctor, so I won't give medical advice, but I'll make sure the right person sees you. To start, just tell me what's going on in your own words — take your time." },
]

const PATIENT_MSG_1 = "I've been feeling numbness in my left hand after a fall I had recently. It's been tingling and I'm having trouble gripping things."
const BOT_MSG_1 = "Thank you for sharing that — I can see how that would be concerning. A fall causing numbness and grip issues in your hand is something we want to look into carefully. Have you ever had a nerve test done for this, like an EMG or nerve conduction study?"
const PATIENT_MSG_2 = "No, I haven't had any nerve tests done."
const BOT_MSG_2 = "Got it — no prior nerve testing. That's helpful to know. How long ago did this fall happen?"
const PATIENT_MSG_3 = "Just a few days ago."
const BOT_ROUTE = "Thank you for walking me through all of that. Based on what you've shared, I've matched you with Dr. Reyes's team — Peripheral Nerve Surgery — and I've sent your referral over for them to review and confirm. Someone from their team will follow up with you about next steps. You don't need to do anything else right now."

function PatientChatScene({ onNext }: { onNext: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([...DEMO_CONVERSATION])
  const [chatStep, setChatStep] = useState(0) // 0=waiting initial, 1=asked EMG, 2=asked timing, 3=routed
  const [typing, setTyping] = useState(false)
  const [done, setDone] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [messages.length, typing])

  const addBotMsg = (text: string) => {
    setTyping(true)
    setTimeout(() => {
      setTyping(false)
      setMessages((m) => [...m, { id: m.length + 1, from: 'bot', text }])
    }, 1200)
  }

  const handleSend = () => {
    if (chatStep === 0) {
      setMessages((m) => [...m, { id: m.length + 1, from: 'patient', text: PATIENT_MSG_1 }])
      setChatStep(1)
      setTimeout(() => addBotMsg(BOT_MSG_1), 600)
    } else if (chatStep === 1) {
      setMessages((m) => [...m, { id: m.length + 1, from: 'patient', text: PATIENT_MSG_2 }])
      setChatStep(2)
      setTimeout(() => addBotMsg(BOT_MSG_2), 600)
    } else if (chatStep === 2) {
      setMessages((m) => [...m, { id: m.length + 1, from: 'patient', text: PATIENT_MSG_3 }])
      setChatStep(3)
      setTimeout(() => {
        addBotMsg(BOT_ROUTE)
        setTimeout(() => setDone(true), 1500)
      }, 600)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="rounded-2xl border border-line bg-canvas shadow-subtle overflow-hidden">
        {/* Chat header */}
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
          <img src="/omari-logo.png" alt="" className="h-8 w-8 object-contain" />
          <div>
            <p className="font-display text-[13px] font-semibold text-ink">Omari</p>
            <p className="text-[11px] text-muted">AI care coordinator</p>
          </div>
          <span className="ml-auto text-[10px] font-medium text-muted flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Secure
          </span>
        </div>

        {/* Thread */}
        <div ref={threadRef} className="max-h-[50vh] space-y-3 overflow-y-auto px-5 py-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.from === 'bot' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[82%] px-3.5 py-2 text-sm leading-snug ${
                m.from === 'bot'
                  ? 'rounded-2xl rounded-tl-sm border border-line bg-bg text-ink'
                  : 'omari-grad rounded-2xl rounded-tr-sm text-white shadow-subtle'
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-line bg-bg px-3.5 py-2.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" />
                <span className="ml-1.5 text-xs text-muted">Omari is typing…</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        {!done && chatStep < 3 && (
          <div className="border-t border-line px-4 py-3">
            <button
              onClick={handleSend}
              disabled={typing}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-left text-sm text-muted hover:border-accent hover:bg-sky transition-colors disabled:opacity-50"
            >
              {chatStep === 0 && "Click to send: \"I've been feeling numbness in my left hand after a fall...\""}
              {chatStep === 1 && "Click to send: \"No, I haven't had any nerve tests done.\""}
              {chatStep === 2 && "Click to send: \"Just a few days ago.\""}
            </button>
          </div>
        )}

        {/* Referral card */}
        {done && (
          <div className="border-t border-line px-5 py-4">
            <div className="rounded-xl border border-accent/30 bg-sky p-4">
              <p className="text-sm font-semibold text-accent-strong">Referral Submitted</p>
              <p className="mt-1 text-xs text-muted">
                Routed to <span className="font-medium text-ink">Dr. Reyes</span> · Peripheral Nerve Surgery · Expedited
              </p>
              <div className="mt-3">
                <button
                  onClick={onNext}
                  className="omari-grad omari-grad-hover rounded-md px-4 py-2 text-sm font-semibold text-white shadow-subtle"
                >
                  Next: View as Dr. Reyes →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


/* ─── Scene 3: Surgeon / Dr. Reyes View ───────────────────────────────────── */

function SurgeonScene({ onApprove }: { onApprove: () => void }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent font-bold text-sm">
          DR
        </div>
        <div>
          <h2 className="font-display text-xl font-bold text-ink">Dr. Reyes — Referral Queue</h2>
          <p className="text-sm text-muted">Peripheral Nerve Surgery</p>
        </div>
      </div>

      {/* Referral card */}
      <div className="mt-6 rounded-xl border border-line bg-canvas p-6 shadow-subtle">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-nodeesc">New Referral · Expedited</p>
            <p className="mt-1 text-lg font-semibold text-ink">Patient: Demo Patient</p>
            <p className="text-sm text-muted">Submitted just now via Omari AI intake</p>
          </div>
          <span className="rounded-full bg-nodeesc/15 px-3 py-1 text-xs font-semibold text-nodeesc">
            Pending Review
          </span>
        </div>

        {/* Chief complaint */}
        <div className="mt-5 rounded-lg border border-line bg-bg p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Chief Complaint</p>
          <p className="mt-1 text-sm text-ink">
            Numbness and tingling in left hand after recent fall (few days ago). Difficulty gripping objects. No prior nerve testing (EMG/NCS).
          </p>
        </div>

        {/* Extracted variables */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-bg p-3">
            <p className="text-[10px] font-semibold uppercase text-muted">Presentation</p>
            <p className="mt-0.5 text-sm font-medium text-ink">Acute / Trauma</p>
          </div>
          <div className="rounded-lg border border-line bg-bg p-3">
            <p className="text-[10px] font-semibold uppercase text-muted">Prior EMG/NCS</p>
            <p className="mt-0.5 text-sm font-medium text-ink">No</p>
          </div>
          <div className="rounded-lg border border-line bg-bg p-3">
            <p className="text-[10px] font-semibold uppercase text-muted">Duration</p>
            <p className="mt-0.5 text-sm font-medium text-ink">Few days</p>
          </div>
        </div>

        {/* Recommended workups */}
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Recommended Workups</p>
          <div className="mt-2 space-y-2">
            {[
              { name: 'EMG / Nerve Conduction Study', rationale: 'Baseline nerve function assessment — no prior testing on file' },
              { name: 'MRI of Left Wrist/Hand', rationale: 'Evaluate structural damage from fall' },
              { name: 'X-ray Left Hand (2 views)', rationale: 'Rule out fracture contributing to nerve compression' },
            ].map((w, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-line bg-bg p-3">
                <input type="checkbox" defaultChecked className="mt-0.5 h-4 w-4 rounded border-line text-accent" />
                <div>
                  <p className="text-sm font-medium text-ink">{w.name}</p>
                  <p className="text-xs text-muted">{w.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Approve button */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={onApprove}
            className="rounded-md bg-success px-5 py-2.5 text-sm font-semibold text-white shadow-subtle transition-all hover:bg-success/90 active:translate-y-px"
          >
            ✓ Approve Referral &amp; Workups
          </button>
          <button className="rounded-md border border-line bg-canvas px-4 py-2.5 text-sm font-medium text-muted hover:bg-bg">
            Request Changes
          </button>
        </div>
      </div>
    </div>
  )
}


/* ─── Scene 4: Epic / MyChart Integration View ────────────────────────────── */

function EpicScene({ approved }: { approved: boolean }) {
  return (
    <div className="h-full">
      {/* MyChart-style shell */}
      <div className="flex h-full">
        {/* Sidebar */}
        <div className="w-56 shrink-0 border-r border-line bg-canvas">
          <div className="border-b border-line px-4 py-3">
            <p className="text-lg font-bold text-[#1a4d8f]">My<span className="text-[#7cb5ec]">Chart</span></p>
          </div>
          <nav className="p-2 space-y-0.5">
            {['Visits', 'Messages', 'Medications', 'Test Results'].map((item) => (
              <div key={item} className="rounded-md px-3 py-2 text-sm text-muted">{item}</div>
            ))}
            <div className="rounded-md bg-[#e8f0fe] px-3 py-2 text-sm font-semibold text-[#1a4d8f] border-l-3 border-[#1a4d8f]">
              My Referrals
            </div>
            <div className="rounded-md px-3 py-2 text-sm text-muted">Appointments</div>
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto bg-[#f9fafb] p-6">
          <h2 className="text-xl font-bold text-[#1a4d8f]">My Referrals</h2>
          <p className="mt-1 text-sm text-muted">Connected via Epic FHIR · Real-time status</p>

          {/* Approved referral card */}
          <div className="mt-6 rounded-xl border border-line bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-success">✓ Confirmed</p>
                <p className="mt-1 text-lg font-semibold text-ink">Peripheral Nerve Surgery</p>
                <p className="text-sm text-muted">Dr. Reyes's Team</p>
              </div>
              <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                {approved ? 'Approved' : 'Pending'}
              </span>
            </div>

            {/* Status stepper */}
            <div className="mt-5">
              <div className="flex items-center">
                {['Submitted', 'In Review', 'Confirmed', 'Scheduled'].map((label, i) => (
                  <div key={label} className="flex flex-1 items-center">
                    {i > 0 && (
                      <div className={`h-0.5 flex-1 ${i <= 2 ? 'bg-success' : 'bg-gray-200'}`} />
                    )}
                    <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                      i < 3 ? 'bg-success text-white' : 'border border-gray-300 text-gray-400'
                    }`}>
                      {i < 3 ? '✓' : '4'}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex">
                {['Submitted', 'In Review', 'Confirmed', 'Scheduled'].map((label, i) => (
                  <span key={label} className={`flex-1 text-center text-[10px] ${i < 3 ? 'font-medium text-ink' : 'text-muted'}`}>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Upcoming workups */}
            <div className="mt-5 rounded-lg border border-line bg-[#f9fafb] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Scheduled Workups</p>
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">EMG / Nerve Conduction Study</span>
                  <span className="text-xs text-muted">Aug 1, 2026 · 9:00 AM</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">MRI Left Wrist/Hand</span>
                  <span className="text-xs text-muted">Aug 3, 2026 · 2:00 PM</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">X-ray Left Hand</span>
                  <span className="text-xs text-muted">Aug 1, 2026 · 9:30 AM</span>
                </div>
              </div>
            </div>

            {/* Appointment */}
            <div className="mt-4 rounded-lg border border-accent/30 bg-sky p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">Upcoming Appointment</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                Dr. Reyes — Peripheral Nerve Surgery Consultation
              </p>
              <p className="text-xs text-muted">August 8, 2026 · 10:00 AM · EHS Outpatient Clinic</p>
            </div>
          </div>

          {/* Epic integration badge */}
          <div className="mt-4 flex items-center gap-2 text-xs text-muted">
            <span className="h-2 w-2 rounded-full bg-success" />
            Connected to Epic FHIR R4 · Patient data synced in real-time
          </div>
        </div>
      </div>
    </div>
  )
}
