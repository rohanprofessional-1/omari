import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  UploadCloud,
  FileCheck2,
  Loader2,
  Route as RouteIcon,
  CheckCircle2,
  X,
  Home as HomeIcon,
  MessageCircle,
} from 'lucide-react'
import { useToast } from '../components/Toast'
import Logo from '../components/Logo'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Option = {
  value: string
  label: string
  emoji?: string
  exclusive?: boolean // for multi-select "none" answers
}

type Answers = Record<string, string | string[]>

type BaseQuestion = {
  id: string
  section: string
  prompt: string
  subtitle?: string
  branched?: boolean
  becauseOf?: string
}

type Question =
  | (BaseQuestion & { type: 'single'; options: Option[] })
  | (BaseQuestion & { type: 'multi'; options: Option[] })
  | (BaseQuestion & {
      type: 'text'
      placeholder: string
      multiline?: boolean
      optional?: boolean
    })
  | (BaseQuestion & { type: 'upload' })

/* ------------------------------------------------------------------ */
/* Branching flow definition (hardcoded for the demo)                  */
/* ------------------------------------------------------------------ */

const concernOptions: Option[] = [
  { value: 'nerve', label: 'Numbness or tingling in my arm', emoji: '🖐️' },
  { value: 'spine', label: 'Neck or back pain', emoji: '🦴' },
  { value: 'head', label: 'Headaches or migraines', emoji: '🤕' },
  { value: 'joint', label: 'Joint or muscle pain', emoji: '💪' },
  { value: 'other', label: 'Something else', emoji: '💬' },
]

function buildFlow(answers: Answers): Question[] {
  const flow: Question[] = [
    {
      id: 'concern',
      section: 'Symptoms',
      prompt: "What's bothering you today?",
      subtitle: 'Pick the option that fits best — we\'ll take it from there.',
      type: 'single',
      options: concernOptions,
    },
  ]

  const c = answers.concern

  // ---- Branch: nerve-related (numbness / tingling) ----
  if (c === 'nerve') {
    flow.push(
      {
        id: 'nerve_radiate',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'numbness or tingling in your arm',
        prompt: 'Does the pain radiate from your neck down into your arm?',
        type: 'single',
        options: [
          { value: 'yes', label: 'Yes, it travels down my arm', emoji: '⚡' },
          { value: 'no', label: "No, it stays in one spot", emoji: '📍' },
          { value: 'unsure', label: "I'm not sure", emoji: '🤔' },
        ],
      },
      {
        id: 'nerve_side',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'arm symptoms',
        prompt: 'Which side is affected?',
        type: 'single',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'both', label: 'Both sides' },
        ],
      },
      {
        id: 'nerve_weak',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'arm symptoms',
        prompt: 'Have you noticed weakness or trouble gripping objects?',
        type: 'single',
        options: [
          { value: 'yes', label: 'Yes, my grip feels weaker' },
          { value: 'no', label: 'No, strength feels normal' },
        ],
      },
    )
  }

  // ---- Branch: neck / back pain ----
  if (c === 'spine') {
    flow.push(
      {
        id: 'spine_location',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'neck or back pain',
        prompt: 'Where is the pain mostly located?',
        type: 'single',
        options: [
          { value: 'neck', label: 'Neck', emoji: '🧣' },
          { value: 'upper', label: 'Upper back', emoji: '🔼' },
          { value: 'lower', label: 'Lower back', emoji: '🔽' },
        ],
      },
      {
        id: 'spine_leg',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'neck or back pain',
        prompt: 'Does the pain shoot down into your leg or buttock?',
        type: 'single',
        options: [
          { value: 'yes', label: 'Yes, it shoots down my leg', emoji: '⚡' },
          { value: 'no', label: 'No, it stays in my back' },
        ],
      },
    )
  }

  // ---- Branch: headaches ----
  if (c === 'head') {
    flow.push(
      {
        id: 'head_freq',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'headaches or migraines',
        prompt: 'How often do you get them?',
        type: 'single',
        options: [
          { value: 'daily', label: 'Almost every day' },
          { value: 'weekly', label: 'A few times a week' },
          { value: 'monthly', label: 'A few times a month' },
          { value: 'rarely', label: 'Rarely' },
        ],
      },
      {
        id: 'head_aura',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'headaches or migraines',
        prompt: 'Do any of these happen with your headaches?',
        subtitle: 'Select all that apply.',
        type: 'multi',
        options: [
          { value: 'aura', label: 'Visual aura', emoji: '✨' },
          { value: 'light', label: 'Light sensitivity', emoji: '💡' },
          { value: 'nausea', label: 'Nausea', emoji: '🤢' },
          { value: 'none', label: 'None of these', exclusive: true },
        ],
      },
    )
  }

  // ---- Branch: joint / muscle ----
  if (c === 'joint') {
    flow.push(
      {
        id: 'joint_which',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'joint or muscle pain',
        prompt: 'Which joint is bothering you most?',
        type: 'single',
        options: [
          { value: 'knee', label: 'Knee' },
          { value: 'shoulder', label: 'Shoulder' },
          { value: 'hip', label: 'Hip' },
          { value: 'hand', label: 'Hand or wrist' },
        ],
      },
      {
        id: 'joint_swell',
        section: 'Symptoms',
        branched: true,
        becauseOf: 'joint or muscle pain',
        prompt: 'Any swelling, redness, or warmth around it?',
        type: 'single',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      },
    )
  }

  // ---- Branch: other ----
  if (c === 'other') {
    flow.push({
      id: 'other_desc',
      section: 'Symptoms',
      branched: true,
      becauseOf: 'you chose “Something else”',
      prompt: 'Tell us a little more about what\'s bothering you.',
      type: 'text',
      multiline: true,
      placeholder: 'Describe your symptoms in your own words…',
    })
  }

  // ---- Shared steps (every path) ----
  if (c) {
    flow.push(
      {
        id: 'duration',
        section: 'Symptoms',
        prompt: 'How long have you had these symptoms?',
        type: 'single',
        options: [
          { value: 'days', label: 'Less than a week' },
          { value: 'weeks', label: '1–4 weeks' },
          { value: 'months', label: '1–6 months' },
          { value: 'chronic', label: 'More than 6 months' },
        ],
      },
      {
        id: 'history',
        section: 'Medical history',
        prompt: 'Do any of these apply to your medical history?',
        subtitle: 'Select all that apply.',
        type: 'multi',
        options: [
          { value: 'diabetes', label: 'Diabetes' },
          { value: 'bp', label: 'High blood pressure' },
          { value: 'surgery', label: 'Previous surgery' },
          { value: 'arthritis', label: 'Arthritis' },
          { value: 'thyroid', label: 'Thyroid condition' },
          { value: 'none', label: 'None of these', exclusive: true },
        ],
      },
      {
        id: 'medications',
        section: 'Medications',
        prompt: 'Are you currently taking any medications?',
        subtitle: 'List them below, or leave blank if none.',
        type: 'text',
        multiline: true,
        optional: true,
        placeholder: 'e.g. Sumatriptan 50mg as needed, Vitamin D3…',
      },
      {
        id: 'allergies',
        section: 'Allergies',
        prompt: 'Do you have any known allergies?',
        subtitle: 'Select all that apply.',
        type: 'multi',
        options: [
          { value: 'penicillin', label: 'Penicillin' },
          { value: 'sulfa', label: 'Sulfa drugs' },
          { value: 'latex', label: 'Latex' },
          { value: 'contrast', label: 'Contrast dye' },
          { value: 'nka', label: 'No known allergies', exclusive: true },
        ],
      },
      {
        id: 'dob',
        section: 'About you',
        prompt: "What's your date of birth?",
        type: 'text',
        placeholder: 'MM / DD / YYYY',
      },
      {
        id: 'sex',
        section: 'About you',
        prompt: 'What is your biological sex?',
        type: 'single',
        options: [
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
          { value: 'intersex', label: 'Intersex' },
          { value: 'na', label: 'Prefer not to say' },
        ],
      },
      {
        id: 'insurance_provider',
        section: 'Insurance',
        prompt: "Who's your insurance provider?",
        type: 'single',
        options: [
          { value: 'blueshield', label: 'Blue Shield' },
          { value: 'aetna', label: 'Aetna' },
          { value: 'united', label: 'UnitedHealthcare' },
          { value: 'kaiser', label: 'Kaiser' },
          { value: 'self', label: 'Other / Self-pay' },
        ],
      },
      {
        id: 'insurance_member',
        section: 'Insurance',
        prompt: "What's your member ID?",
        subtitle: 'You can find this on the front of your insurance card.',
        type: 'text',
        optional: true,
        placeholder: 'e.g. XEG-482-019',
      },
      {
        id: 'upload',
        section: 'Documents',
        prompt: 'Upload any relevant records',
        subtitle:
          'Referral letters, prior imaging, or lab results help us route you faster.',
        type: 'upload',
      },
    )
  }

  return flow
}

/* ------------------------------------------------------------------ */
/* Routing logic (drives the visible "adapting" banner)               */
/* ------------------------------------------------------------------ */

function routeFor(answers: Answers): { team: string; reason: string } {
  switch (answers.concern) {
    case 'nerve':
      return answers.nerve_radiate === 'yes'
        ? {
            team: 'Neurology · Cervical Spine',
            reason: 'arm symptoms radiating from the neck',
          }
        : { team: 'Neurology', reason: 'nerve-related arm symptoms' }
    case 'spine':
      return answers.spine_leg === 'yes'
        ? {
            team: 'Spine & Orthopedics',
            reason: 'pain radiating into the leg (possible sciatica)',
          }
        : { team: 'Spine & Pain Management', reason: 'neck or back pain' }
    case 'head':
      return {
        team: 'Neurology · Headache Clinic',
        reason: 'recurring headaches',
      }
    case 'joint':
      return { team: 'Orthopedics', reason: 'joint or muscle pain' }
    default:
      return { team: 'General Triage', reason: 'your described symptoms' }
  }
}

const labelOf = (options: Option[], value?: string) =>
  options.find((o) => o.value === value)?.label ?? '—'

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Intake() {
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [answers, setAnswers] = useState<Answers>({})
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)

  // upload sub-state
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done'>(
    'idle',
  )

  const flow = buildFlow(answers)
  const question = flow[Math.min(index, flow.length - 1)]
  const progress = done ? 100 : Math.round(((index + 1) / flow.length) * 100)
  const route = routeFor(answers)

  /* ---- answer helpers ---- */
  const setAnswer = (id: string, value: string | string[]) =>
    setAnswers((a) => ({ ...a, [id]: value }))

  const isAnswered = (q: Question): boolean => {
    if (q.type === 'upload') return uploadState === 'done'
    const v = answers[q.id]
    if (q.type === 'multi') return Array.isArray(v) && v.length > 0
    if (q.type === 'text') return Boolean(q.optional) || Boolean((v as string)?.trim())
    return Boolean(v)
  }

  const goNext = (flowArg: Question[] = flow) => {
    if (index >= flowArg.length - 1) {
      setDone(true)
      return
    }
    setIndex(index + 1)
  }

  const goBack = () => {
    if (done) {
      setDone(false)
      return
    }
    setIndex((i) => Math.max(0, i - 1))
  }

  const selectSingle = (q: Question, value: string) => {
    const updated = { ...answers, [q.id]: value }
    setAnswers(updated)
    // auto-advance for a conversational feel; recompute flow with new answer
    const nextFlow = buildFlow(updated)
    window.setTimeout(() => {
      if (index >= nextFlow.length - 1) setDone(true)
      else setIndex(index + 1)
    }, 340)
  }

  const toggleMulti = (q: Question, opt: Option) => {
    const prev = (answers[q.id] as string[]) ?? []
    let nextVals: string[]
    if (opt.exclusive) {
      nextVals = prev.includes(opt.value) ? [] : [opt.value]
    } else {
      const withoutExclusive = prev.filter(
        (v) => !(q as { options: Option[] }).options.find((o) => o.value === v)?.exclusive,
      )
      nextVals = withoutExclusive.includes(opt.value)
        ? withoutExclusive.filter((v) => v !== opt.value)
        : [...withoutExclusive, opt.value]
    }
    setAnswer(q.id, nextVals)
  }

  const simulateUpload = () => {
    if (uploadState !== 'idle') return
    setUploadState('uploading')
    window.setTimeout(() => {
      setUploadState('done')
      showToast('Document uploaded securely ✓')
    }, 1300)
  }

  /* ---- Confirmation screen ---- */
  if (done) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col">
        <div className="animate-fade-up flex flex-1 flex-col items-center justify-center text-center">
          <div className="relative mb-6">
            <span className="absolute -inset-4 animate-ping rounded-full bg-emerald-200/50" />
            <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white shadow-soft">
              <CheckCircle2 className="h-10 w-10" />
            </span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-blume-dark">
            Thanks, you're all set
          </h1>
          <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-slate-500">
            We're routing your referral to the right specialist.
          </p>

          <div className="mt-7 w-full rounded-3xl border border-slate-200/70 bg-white p-5 text-left shadow-card">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
              <RouteIcon className="h-3.5 w-3.5 text-blume" /> Routed to
            </div>
            <p className="mt-1.5 text-lg font-semibold tracking-tight text-blume-dark">
              {route.team}
            </p>
            <p className="mt-0.5 text-[13px] text-slate-500">
              Based on {route.reason}.
            </p>
          </div>

          {/* recap */}
          <div className="mt-3 w-full space-y-1 rounded-3xl border border-slate-200/70 bg-white p-5 text-left shadow-card">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
              Your intake summary
            </p>
            {[
              ['Primary concern', labelOf(concernOptions, answers.concern as string)],
              [
                'Duration',
                labelOf(
                  [
                    { value: 'days', label: 'Less than a week' },
                    { value: 'weeks', label: '1–4 weeks' },
                    { value: 'months', label: '1–6 months' },
                    { value: 'chronic', label: 'More than 6 months' },
                  ],
                  answers.duration as string,
                ),
              ],
              [
                'Allergies',
                ((answers.allergies as string[]) ?? []).length
                  ? `${(answers.allergies as string[]).length} noted`
                  : 'None provided',
              ],
              ['Documents', uploadState === 'done' ? '1 uploaded' : 'None'],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-0"
              >
                <span className="text-[13px] text-slate-400">{k}</span>
                <span className="text-right text-[13px] font-medium text-blume-dark">
                  {v}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-7 flex w-full gap-3">
            <button
              onClick={() => navigate('/messages')}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
            >
              <MessageCircle className="h-4 w-4" /> Message us
            </button>
            <button
              onClick={() => navigate('/')}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blume px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blume-dark hover:shadow-soft"
            >
              <HomeIcon className="h-4 w-4" /> Home
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ---- Question screen ---- */
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      {/* Progress header */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-[13px] font-medium">
          <span className="text-blume">{question.section}</span>
          <span className="text-slate-400">
            {index + 1} of {flow.length}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blume transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Live routing banner — visibly adapts to answers */}
      {answers.concern && (
        <div className="animate-fade-up mb-6 flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-card">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blume-mist text-blume">
            <RouteIcon className="h-[18px] w-[18px]" />
          </span>
          <p className="text-[13px] leading-snug text-slate-500">
            Adapting your intake — routing toward{' '}
            <span className="font-semibold text-blume-dark">{route.team}</span>
          </p>
        </div>
      )}

      {/* Question (keyed for entry animation) */}
      <div key={question.id} className="animate-fade-up flex flex-1 flex-col">
        {/* Branch indicator */}
        {question.branched && (
          <div className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-blume-mist px-2.5 py-1 text-[11px] font-medium text-blume ring-1 ring-inset ring-blume-light/30">
            <Sparkles className="h-3 w-3" />
            Personalized follow-up
          </div>
        )}

        {/* Assistant bubble */}
        <div className="flex gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blume-dark">
            <Logo className="h-5 w-5" dark="#ffffff" />
          </span>
          <div className="flex-1">
            <div className="rounded-3xl rounded-tl-md border border-slate-200/70 bg-white p-4 shadow-card">
              <h2 className="text-lg font-semibold leading-snug tracking-tight text-blume-dark">
                {question.prompt}
              </h2>
              {question.subtitle && (
                <p className="mt-1 text-[14px] leading-relaxed text-slate-500">
                  {question.subtitle}
                </p>
              )}
            </div>
            {question.branched && question.becauseOf && (
              <p className="mt-2 pl-1 text-xs font-medium text-blume">
                Because you mentioned {question.becauseOf}.
              </p>
            )}
          </div>
        </div>

        {/* Answer controls */}
        <div className="mt-5 space-y-2.5">
          {question.type === 'single' &&
            question.options.map((opt) => {
              const selected = answers[question.id] === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => selectSingle(question, opt.value)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-[14px] font-medium transition-all duration-200 active:scale-[0.99] ${
                    selected
                      ? 'border-blume bg-blume text-white shadow-sm'
                      : 'border-slate-200 bg-white text-blume-dark hover:border-blume-light hover:bg-blume-cloud'
                  }`}
                >
                  {opt.emoji && <span className="text-lg">{opt.emoji}</span>}
                  <span className="flex-1">{opt.label}</span>
                  {selected && <Check className="h-4 w-4" />}
                </button>
              )
            })}

          {question.type === 'multi' &&
            question.options.map((opt) => {
              const vals = (answers[question.id] as string[]) ?? []
              const selected = vals.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  onClick={() => toggleMulti(question, opt)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-[14px] font-medium transition-all duration-200 active:scale-[0.99] ${
                    selected
                      ? 'border-blume-light bg-blume-cloud text-blume-dark'
                      : 'border-slate-200 bg-white text-blume-dark hover:border-blume-light'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200 ${
                      selected
                        ? 'border-blume bg-blume text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </span>
                  {opt.emoji && <span className="text-lg">{opt.emoji}</span>}
                  <span className="flex-1">{opt.label}</span>
                </button>
              )
            })}

          {question.type === 'text' &&
            (question.multiline ? (
              <textarea
                rows={4}
                value={(answers[question.id] as string) ?? ''}
                onChange={(e) => setAnswer(question.id, e.target.value)}
                placeholder={question.placeholder}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-[14px] text-blume-dark outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-blume-light focus:ring-2 focus:ring-blume-light/25"
              />
            ) : (
              <input
                value={(answers[question.id] as string) ?? ''}
                onChange={(e) => setAnswer(question.id, e.target.value)}
                placeholder={question.placeholder}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-[14px] text-blume-dark outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-blume-light focus:ring-2 focus:ring-blume-light/25"
              />
            ))}

          {question.type === 'upload' && (
            <div>
              {uploadState === 'done' ? (
                <div className="flex items-center gap-3.5 rounded-2xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500 text-white">
                    <FileCheck2 className="h-5 w-5" />
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-emerald-800">
                      referral-notes.pdf
                    </p>
                    <p className="text-xs font-medium text-emerald-600">
                      Uploaded ✓ · 482 KB
                    </p>
                  </div>
                  <button
                    onClick={() => setUploadState('idle')}
                    className="rounded-lg p-2 text-emerald-700 transition-colors hover:bg-emerald-100"
                    aria-label="Remove"
                  >
                    <X className="h-[18px] w-[18px]" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={simulateUpload}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    simulateUpload()
                  }}
                  disabled={uploadState === 'uploading'}
                  className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center transition-all duration-300 hover:border-blume-light hover:bg-blume-cloud"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blume-mist text-blume">
                    {uploadState === 'uploading' ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <UploadCloud className="h-6 w-6" />
                    )}
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold text-blume-dark">
                      {uploadState === 'uploading'
                        ? 'Uploading…'
                        : 'Drag & drop a file here'}
                    </p>
                    <p className="mt-1 text-[13px] text-slate-400">
                      {uploadState === 'uploading'
                        ? 'Encrypting your document'
                        : 'or click to browse · PDF, JPG, PNG'}
                    </p>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer nav */}
      <div className="mt-8 flex gap-3 border-t border-slate-100 pt-5">
        {(index > 0 || done) && (
          <button
            onClick={goBack}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
        <button
          onClick={() => goNext()}
          disabled={!isAnswered(question)}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blume px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blume-dark hover:shadow-soft active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {index === flow.length - 1 ? 'Submit intake' : 'Next'}
          {index === flow.length - 1 ? (
            <Check className="h-4 w-4" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* optional skip for text/upload steps */}
      {((question.type === 'text' && question.optional) ||
        question.type === 'upload') &&
        !isAnswered(question) && (
          <button
            onClick={() => goNext()}
            className="mt-3 text-center text-sm font-semibold text-slate-400 transition hover:text-blume"
          >
            Skip for now
          </button>
        )}
    </div>
  )
}
