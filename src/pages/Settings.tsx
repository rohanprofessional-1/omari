import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Type,
  Volume2,
  Contrast,
  Globe,
  MessageSquare,
  Mail,
  Bell,
  Users,
  UserPlus,
  Shield,
  ChevronRight,
  LogOut,
  Clock,
  Check,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '../components/ui'
import { useToast } from '../components/Toast'

/* ---- Reusable toggle (visual only) ---- */
function Toggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
        on ? 'bg-blume' : 'bg-slate-200'
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  )
}

function SettingRow({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: LucideIcon
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blume-mist text-blume">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-blume-dark">{title}</p>
        {desc && <p className="text-xs text-slate-400">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 ml-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
      {children}
    </h2>
  )
}

type Caregiver = {
  name: string
  email: string
  role: string
  status: 'active' | 'pending'
}

export default function Settings() {
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [largeText, setLargeText] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [language, setLanguage] = useState('en')

  const [sms, setSms] = useState(true)
  const [email, setEmail] = useState(true)
  const [push, setPush] = useState(false)

  const [caregivers, setCaregivers] = useState<Caregiver[]>([
    {
      name: 'David Chen',
      email: 'david.chen@email.com',
      role: 'Spouse · Full access',
      status: 'active',
    },
  ])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('Family member · View only')

  const sendInvite = () => {
    const e = inviteEmail.trim()
    if (!e) return
    setCaregivers((prev) => [
      ...prev,
      { name: e.split('@')[0], email: e, role: inviteRole, status: 'pending' },
    ])
    setInviteEmail('')
    showToast(`Invite sent to ${e} ✓`)
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 transition-colors duration-200 hover:text-blume-dark"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Profile */}
      <Card className="flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blume-mist text-lg font-semibold text-blume">
          SC
        </span>
        <div>
          <p className="text-lg font-semibold tracking-tight text-blume-dark">
            Sarah Chen
          </p>
          <p className="text-[13px] text-slate-500">Patient · Blue Shield PPO</p>
          <p className="mt-0.5 text-xs text-slate-400">
            MRN 00482190 · DOB 04/18/1990
          </p>
        </div>
      </Card>

      {/* Accessibility */}
      <div>
        <SectionTitle>Accessibility</SectionTitle>
        <Card className="divide-y divide-slate-100 p-0">
          <SettingRow
            icon={Type}
            title="Large text"
            desc="Increase font size across the app"
          >
            <Toggle on={largeText} onChange={setLargeText} />
          </SettingRow>
          <SettingRow
            icon={Volume2}
            title="Voice mode"
            desc="Read screens aloud"
          >
            <Toggle on={voiceMode} onChange={setVoiceMode} />
          </SettingRow>
          <SettingRow
            icon={Contrast}
            title="High contrast"
            desc="Boost color contrast for readability"
          >
            <Toggle on={highContrast} onChange={setHighContrast} />
          </SettingRow>
          <SettingRow
            icon={Globe}
            title="Language"
            desc="Choose your preferred language"
          >
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-blume-dark outline-none focus:border-blume"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="zh">中文</option>
              <option value="vi">Tiếng Việt</option>
              <option value="ar">العربية</option>
              <option value="tl">Tagalog</option>
            </select>
          </SettingRow>
        </Card>
      </div>

      {/* Notifications */}
      <div>
        <SectionTitle>Reminders</SectionTitle>
        <Card className="divide-y divide-slate-100 p-0">
          <SettingRow icon={MessageSquare} title="SMS text reminders">
            <Toggle on={sms} onChange={setSms} />
          </SettingRow>
          <SettingRow icon={Mail} title="Email updates">
            <Toggle on={email} onChange={setEmail} />
          </SettingRow>
          <SettingRow icon={Bell} title="Push notifications">
            <Toggle on={push} onChange={setPush} />
          </SettingRow>
        </Card>
      </div>

      {/* Family / Caregiver access */}
      <div>
        <SectionTitle>Family &amp; Caregiver Access</SectionTitle>
        <Card className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blume-mist text-blume">
              <Users className="h-5 w-5" />
            </span>
            <p className="text-sm leading-relaxed text-slate-600">
              Invite a family member or caregiver to help manage appointments
              and view your care journey.
            </p>
          </div>

          {/* Existing people */}
          <div className="space-y-2">
            {caregivers.map((c) => (
              <div
                key={c.email}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-blume-cloud px-4 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blume text-[11px] font-semibold uppercase text-white">
                  {c.name.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-blume-dark">
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-slate-400">{c.role}</p>
                </div>
                {c.status === 'active' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    <Check className="h-3 w-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    <Clock className="h-3 w-3" /> Pending
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Invite form */}
          <div className="space-y-2 rounded-2xl border border-dashed border-blume-light bg-white p-4">
            <p className="text-sm font-semibold text-blume-dark">
              Invite someone new
            </p>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email address"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-blume-dark outline-none transition placeholder:text-slate-300 focus:border-blume"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-blume-dark outline-none focus:border-blume"
            >
              <option>Family member · View only</option>
              <option>Caregiver · Manage appointments</option>
              <option>Spouse · Full access</option>
            </select>
            <button
              onClick={sendInvite}
              disabled={!inviteEmail.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blume px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blume-dark hover:shadow-soft active:scale-[0.98] disabled:opacity-40"
            >
              <UserPlus className="h-4 w-4" /> Send invite
            </button>
          </div>
        </Card>
      </div>

      {/* Account */}
      <div>
        <SectionTitle>Account</SectionTitle>
        <Card className="divide-y divide-slate-100 p-0">
          <button
            onClick={() => showToast('Privacy & security — coming soon.', 'info')}
            className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-blume-cloud"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blume-mist text-blume">
              <Shield className="h-5 w-5" />
            </span>
            <span className="flex-1 text-sm font-semibold text-blume-dark">
              Privacy &amp; security
            </span>
            <ChevronRight className="h-5 w-5 text-slate-300" />
          </button>
          <button
            onClick={() => showToast('Signed out (demo).', 'info')}
            className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-blume-cloud"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <LogOut className="h-5 w-5" />
            </span>
            <span className="flex-1 text-sm font-semibold text-red-500">
              Sign out
            </span>
          </button>
        </Card>
      </div>

      <p className="pb-2 text-center text-xs text-slate-300">
        Blume · NerveRoute · v0.1 (prototype)
      </p>
    </div>
  )
}
