import { useEffect, useRef, useState } from 'react'
import { useTreeStore } from '../store/treeStore'
import { sampleTree } from '../data/sampleTree'
import { fetchTrees, fetchTree, startConversation, sendChatMessage } from '../lib/api'
import TreeMiniViz from '../components/TreeMiniViz'
import type { Tree } from '../types/tree'

const THINK_MS = 750

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const naturalPause = (): Promise<void> =>
  new Promise((r) => setTimeout(r, prefersReducedMotion() ? 0 : THINK_MS))

const INTRO =
  "Hi, I’m Omari — an AI care coordinator. I’ll ask you a few questions so we can get you to " +
  "exactly the right specialist. I’m not a doctor, so I won’t give medical advice, but I’ll make " +
  "sure the right person sees you. To start, just tell me what’s going on in your own words — " +
  "take your time."

const SAMPLE_CASES: { label: string; hint: string; text: string }[] = [
  {
    label: 'Clean case',
    hint: 'routes straight to a specialist',
    text: "I've had constant numbness and tingling in my right hand for the past eight months, and a nerve conduction study came back abnormal.",
  },
  {
    label: 'Vague case',
    hint: 'triggers follow-up questions',
    text: "Honestly it's hard to pin down — kind of a mix of everything, mostly in my hand. It's been bugging me for a while.",
  },
  {
    label: 'Red-flag case',
    hint: 'escalates for human review',
    text: 'I found a hard lump in my forearm that I can feel under the skin, and it’s been growing.',
  },
]



export type Phase = 'intro' | 'thinking' | 'awaiting' | 'done' | 'error'
export interface ChatMessage {
  id: number
  from: 'bot' | 'patient'
  text: string
}

function Runner() {
  const { savedTree, savedAt, saveTree } = useTreeStore()
  const [dbTree, setDbTree] = useState<Tree | null>(null)

  useEffect(() => {
    if (!savedTree && !dbTree) {
      fetchTrees()
        .then(async (trees) => {
          if (trees.length > 0) {
            const fetched = await fetchTree(trees[0].id)
            setDbTree(fetched)
            saveTree(fetched)
          }
        })
        .catch(console.error)
    }
  }, [savedTree, dbTree, saveTree])

  const tree = savedTree ?? dbTree ?? sampleTree

  return (
    <RunnerSession
      key={tree.treeId + (savedAt || 0)}
      tree={tree}
      usingFallback={!savedTree}
    />
  )
}

function RunnerSession({
  tree,
  usingFallback,
}: {
  tree: Tree
  usingFallback: boolean
}) {
  const idRef = useRef(0)
  const nextId = () => ++idRef.current

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: nextId(), from: 'bot', text: INTRO }])
  const [phase, setPhase] = useState<Phase>('intro')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [currentOptions, setCurrentOptions] = useState<string[]>([])
  
  // State from backend
  const [status, setStatus] = useState<string>('in_progress')
  const [filledVariables, setFilledVariables] = useState<Record<string, any>>({})
  const [pathTaken, setPathTaken] = useState<string[]>([])
  const [specialist, setSpecialist] = useState<any>(null)

  const reset = async () => {
    idRef.current = 0
    setMessages([{ id: nextId(), from: 'bot', text: INTRO }])
    setPhase('thinking')
    setError(null)
    setDraft('')
    setStatus('in_progress')
    setFilledVariables({})
    setPathTaken([])
    setSpecialist(null)
    setCurrentOptions([])

    try {
      const res = await startConversation(tree.treeId)
      setConversationId(res.id)
      setPhase('intro')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start conversation.')
      setPhase('error')
    }
  }

  // Initialize conversation on mount
  useEffect(() => {
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pushMessage = (from: ChatMessage['from'], text: string) =>
    setMessages((m) => [...m, { id: nextId(), from, text }])

  const handlePatientText = async (text: string) => {
    if (!conversationId) return
    setPhase('thinking')
    setError(null)
    pushMessage('patient', text)

    try {
      const response = await sendChatMessage(conversationId, text)
      await naturalPause()
      
      if (response.response) {
        pushMessage('bot', response.response)
      }
      
      setStatus(response.status)
      setFilledVariables(response.filled_variables || {})
      setPathTaken(response.path_taken || [])
      setSpecialist(response.specialist)
      setCurrentOptions(response.options || [])

      if (response.status === 'routed' || response.status === 'escalated') {
        setPhase('done')
      } else {
        setPhase('awaiting')
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process message.')
      setPhase('error')
    }
  }

  const submitInitial = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    handlePatientText(text)
  }

  const handleOptionClick = (optionText: string) => {
    handlePatientText(optionText)
  }

  return (
    <div className="mx-auto w-full px-6 max-w-6xl py-8">
      <PresenterBar
        onReset={reset}
        onLoadSample={setDraft}
        usingFallback={usingFallback}
        treeId={tree.treeId}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {/* Patient App Layer */}
        <div className="min-w-0 space-y-4">
          <PatientApp
            messages={messages}
            phase={phase}
            draft={draft}
            options={currentOptions}
            onDraft={setDraft}
            onSubmitInitial={submitInitial}
            onOption={handleOptionClick}
          />

          {phase === 'done' && status === 'routed' && specialist && (
            <ReferralSentCard specialist={specialist} />
          )}
          {phase === 'done' && status === 'escalated' && (
            <EscalatedCard />
          )}

          {phase === 'error' && (
            <div className="omari-reveal rounded-xl border border-danger/30 bg-danger/5 p-4">
              <p className="text-sm font-semibold text-danger">Something went wrong</p>
              <p className="mt-1 text-xs text-danger/80">{error}</p>
              <button
                onClick={reset}
                className="mt-3 rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                Reset Conversation
              </button>
            </div>
          )}
        </div>

        {/* Clinician App Layer */}
        <BehindScenes
          tree={tree}
          filledVariables={filledVariables}
          messages={messages}
          status={status}
          pathTaken={pathTaken}
        />
      </div>
    </div>
  )
}

function PresenterBar({
  onReset,
  onLoadSample,
  usingFallback,
  treeId,
}: {
  onReset: () => void
  onLoadSample: (text: string) => void
  usingFallback: boolean
  treeId: string
}) {
  return (
    <div className="omari-enter-bar rounded-xl border border-dashed border-line bg-bg/70 p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Demo controls
        </span>
        <span className="hidden text-[11px] text-muted sm:inline">
          Presenter apparatus — not part of the patient app.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button
          onClick={onReset}
          className="rounded-md border border-line bg-canvas px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-bg"
        >
          Reset conversation
        </button>

        <span className="mx-1 hidden h-5 w-px bg-line sm:inline-block" aria-hidden />

        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Sample patients
        </span>
        {SAMPLE_CASES.map((c) => (
          <button
            key={c.label}
            onClick={() => onLoadSample(c.text)}
            title={c.text}
            className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-left transition-all hover:-translate-y-px hover:border-accent/40 hover:bg-sky"
          >
            <span className="block text-xs font-medium text-ink">{c.label}</span>
            <span className="block text-[10px] leading-tight text-muted">{c.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-line/70 pt-2.5">
        {usingFallback ? (
          <p className="text-[11px] text-muted">
            <span className="font-medium text-ink">No saved tree yet</span> — using the seeded
            sample. Build &amp; save one in the Builder to route against your own logic.
          </p>
        ) : (
          <p className="text-[11px] text-muted">
            Routing against your saved tree{' '}
            <span className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink">
              {treeId}
            </span>
            .
          </p>
        )}
      </div>
    </div>
  )
}

function PatientApp({
  messages,
  phase,
  draft,
  options,
  onDraft,
  onSubmitInitial,
  onOption,
}: {
  messages: ChatMessage[]
  phase: Phase
  draft: string
  options: string[]
  onDraft: (text: string) => void
  onSubmitInitial: () => void
  onOption: (opt: string) => void
}) {
  const threadRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, phase])

  const showFooter = phase === 'intro' || phase === 'awaiting'

  return (
    <div className="omari-msg overflow-hidden rounded-2xl border border-line bg-canvas shadow-[0_1px_3px_rgba(22,32,46,0.07)]">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <img src="/omari-logo.png" alt="" aria-hidden className="h-8 w-8 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="font-display text-[13px] font-semibold leading-tight text-ink">Omari</p>
          <p className="truncate text-[11px] leading-tight text-muted">
            AI care coordinator · here to help you find the right specialist
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> Secure
        </span>
      </div>

      <div ref={threadRef} className="max-h-[54vh] space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m) => (
          <ChatBubble key={m.id} from={m.from} text={m.text} />
        ))}
        {phase === 'thinking' && <TypingBubble />}
      </div>

      {showFooter && (
        <div className="border-t border-line px-4 py-3">
          {phase === 'intro' && (
            <div>
              <textarea
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSubmitInitial()
                  }
                }}
                rows={3}
                placeholder="e.g. I've had numbness and tingling in my hand for a few months…"
                className="w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-muted">Enter to send · Shift+Enter for a new line</span>
                <SendButton onClick={onSubmitInitial} disabled={!draft.trim()} />
              </div>
            </div>
          )}

          {phase === 'awaiting' && (
            <div className="space-y-2.5">
              {options && options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => onOption(opt)}
                      className="rounded-full border border-line bg-canvas px-4 py-2 text-sm text-ink transition-all hover:-translate-y-px hover:border-accent hover:bg-sky hover:text-accent"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => onDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSubmitInitial()}
                  placeholder={options?.length > 0 ? '…or just tell me in your own words' : 'Type your answer'}
                  className="flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <SendButton onClick={onSubmitInitial} disabled={!draft.trim()} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SendButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="omari-grad omari-grad-hover rounded-md px-4 py-2 text-sm font-semibold text-white shadow-[0_1px_3px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0_2px_10px_rgba(37,99,235,0.3)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
    >
      Send
    </button>
  )
}

function ChatBubble({ from, text }: { from: 'bot' | 'patient'; text: string }) {
  const isBot = from === 'bot'
  return (
    <div className={`omari-msg flex ${isBot ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[82%] px-3.5 py-2 text-sm leading-snug ${
          isBot
            ? 'rounded-2xl rounded-tl-sm border border-line bg-bg text-ink'
            : 'omari-grad rounded-2xl rounded-tr-sm text-white shadow-[0_1px_3px_rgba(37,99,235,0.25)]'
        }`}
      >
        {text}
      </div>
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="omari-msg flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-line bg-bg px-3.5 py-2.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" />
        <span className="ml-1.5 text-xs text-muted">Omari is typing…</span>
      </div>
    </div>
  )
}

function ReferralSentCard({ specialist }: { specialist: any }) {
  return (
    <div className="omari-reveal overflow-hidden rounded-2xl border border-line bg-canvas shadow-[0_2px_12px_rgba(22,32,46,0.08)]">
      <div className="flex items-center gap-2 border-b border-line bg-nodespec/8 px-5 py-3">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-carolina-deep">
          Referral sent for review
        </span>
      </div>
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm leading-snug text-ink">
          I’ve sent your referral to <span className="font-semibold">{specialist.specialist_name || specialist.specialty}</span>’s team for review.
        </p>
      </div>
    </div>
  )
}

function EscalatedCard() {
  return (
    <div className="omari-reveal overflow-hidden rounded-2xl border border-nodeesc/40 bg-canvas shadow-[0_2px_12px_rgba(208,138,44,0.12)]">
      <div className="flex items-center gap-2 border-b border-line bg-nodeesc/10 px-5 py-3">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-nodeesc">
          Sent for clinical review
        </span>
      </div>
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm leading-snug text-ink">
          I’ve sent your information to our clinical team to review personally before anything is booked.
        </p>
      </div>
    </div>
  )
}

function BehindScenes({
  tree,
  filledVariables,
  messages,
  status,
  pathTaken,
}: {
  tree: Tree
  filledVariables: Record<string, any>
  messages: ChatMessage[]
  status: string
  pathTaken: string[]
}) {
  const entries = Object.entries(filledVariables)
  // Re-map format for TreeMiniViz
  const filledMock = Object.fromEntries(entries.map(([k, v]) => [k, {value: v.value, confidence: v.confidence || 1}]))
  // Provide step mock to TreeMiniViz
  const stepMock: any = status === 'routed' ? {kind: 'route', pathTaken} : status === 'escalated' ? {kind: 'escalate', pathTaken} : pathTaken.length > 0 ? {kind: 'ask', pathTaken} : null

  return (
    <aside className="omari-enter-side w-full shrink-0 space-y-3 rounded-xl border border-line bg-bg/80 p-3.5 lg:sticky lg:top-4">
      <div className="border-b border-line/70 pb-2.5">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          Behind the scenes · clinician view
        </p>
      </div>

      <TreeMiniViz tree={tree} filled={filledMock} candidates={{}} step={stepMock} />

      <div>
        <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Extracted variables
        </p>
        {entries.length === 0 ? (
          <p className="text-xs text-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map(([key, v]) => (
              <li key={key} className="rounded-md border border-line bg-canvas px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-muted">{key}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-accent/12 text-accent`}>
                    {Math.round((v.confidence || 1) * 100)}%
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-ink">{String(v.value)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line/70 pt-3">
        <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          Transcript
        </p>
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {messages.map((m) => (
            <li key={m.id} className="text-[11px] leading-snug">
              <span className={m.from === 'bot' ? 'text-muted' : 'font-medium text-accent'}>
                {m.from === 'bot' ? 'Q' : 'A'}:
              </span>{' '}
              <span className="text-ink">{m.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

export default Runner
