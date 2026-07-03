import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import sproutLogo from '../assets/sprout-logo.png'
import type { Tree } from '../types/tree'
import { validateTreeGraph } from '../lib/buildTree'
import { sendTreeChat, type AssistantTurn } from '../lib/assistant/api'
import { applyOps, TreeOpsSchema, type TreeOp } from '../lib/assistant/ops'
import { diffTrees, type DiffEntry } from '../lib/assistant/diff'

/**
 * Blume — Builder assistant panel: a chat dock for editing the open tree
 * conversationally. The assistant is a scribe, not a clinical author — it
 * translates the clinician's stated edits into bounded, validated operations
 * and NOTHING touches the canvas until the clinician reviews the exact diff
 * and clicks Apply. Rejecting a proposal changes nothing.
 */

interface Proposal {
  ops: TreeOp[]
  /** Tree JSON at proposal time — staleness guard for the confirm gate. */
  beforeJson: string
  afterTree: Tree
  diff: DiffEntry[]
  /** Structural warnings the change would introduce (not present before). */
  newWarnings: string[]
  affectedIds: string[]
  status: 'pending' | 'applied' | 'dismissed' | 'stale'
}

interface PanelMsg {
  id: number
  role: 'user' | 'assistant'
  text: string
  proposal?: Proposal
}

const INTRO =
  'I can explain any part of this tree, or make edits you approve before they go live. You decide the medicine; I handle the busywork.'

/** Starter prompts — tapping one drops it into the composer to finish. */
const SUGGESTIONS = [
  'Which buckets are unwired?',
  'Reroute … patients to Dr. …',
  'Add an EMG to Dr. …’s workup',
]

let nextMsgId = 1

export default function BuilderChatPanel({
  getTree,
  onApply,
  onFocusNodes,
  onClose,
}: {
  /** The canvas as a Tree, read fresh (positions don't matter, wiring does). */
  getTree: () => Tree
  /** Commit a confirmed proposal to the canvas. */
  onApply: (tree: Tree, affectedIds: string[]) => void
  /** Highlight the nodes a reply refers to on the canvas ([] clears). */
  onFocusNodes: (ids: string[]) => void
  onClose: () => void
}) {
  // Starts empty: the welcome hero fills the thread until the first message.
  const [messages, setMessages] = useState<PanelMsg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages, busy])

  const push = (msg: Omit<PanelMsg, 'id'>) =>
    setMessages((cur) => [...cur, { ...msg, id: nextMsgId++ }])

  /** Chat history for the model — proposal outcomes included so it knows what stuck. */
  const historyFor = (msgs: PanelMsg[]): AssistantTurn[] =>
    msgs
      .filter((m) => m.text)
      .map((m) => ({
        role: m.role,
        content: m.proposal
          ? `${m.text}\n[proposed ${m.proposal.diff.length} change(s) — ${m.proposal.status}]`
          : m.text,
      }))

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    const priorMsgs = messages
    push({ role: 'user', text })
    setBusy(true)
    try {
      const tree = getTree()
      const warnings = validateTreeGraph(tree).map((w) => w.message)
      const resp = await sendTreeChat({
        tree,
        message: text,
        history: historyFor(priorMsgs.slice(-12)),
        warnings,
      })

      if (resp.mode !== 'propose') {
        push({ role: 'assistant', text: resp.message || '…' })
        // Point at what the reply is talking about (clears stale highlights).
        onFocusNodes(resp.focusNodeIds)
        return
      }

      // Proposal path: Zod gate → deterministic apply on a copy → diff.
      const parsedOps = TreeOpsSchema.safeParse(resp.operations)
      if (!parsedOps.success) {
        push({
          role: 'assistant',
          text: `That draft didn't pass validation, so nothing changed. Try rephrasing — ideally naming the exact node or bucket. (${parsedOps.error.issues[0]?.message ?? 'invalid operations'})`,
        })
        return
      }
      const result = applyOps(tree, parsedOps.data)
      if (!result.ok) {
        push({
          role: 'assistant',
          text: `That draft didn't apply cleanly, so nothing changed: ${result.errors.join('; ')}. Try rephrasing.`,
        })
        return
      }
      const diff = diffTrees(tree, result.tree)
      if (diff.length === 0) {
        push({ role: 'assistant', text: resp.message || 'The tree already says that — no change needed.' })
        return
      }
      const beforeWarnings = new Set(warnings)
      const newWarnings = validateTreeGraph(result.tree)
        .map((w) => w.message)
        .filter((w) => !beforeWarnings.has(w))
      push({
        role: 'assistant',
        text: resp.message,
        proposal: {
          ops: parsedOps.data,
          beforeJson: JSON.stringify(tree),
          afterTree: result.tree,
          diff,
          newWarnings,
          affectedIds: [...result.addedIds, ...result.changedIds],
          status: 'pending',
        },
      })
      // While the diff is under review, highlight the nodes it would touch
      // (added nodes don't exist on the canvas yet — changed ones do).
      onFocusNodes([...new Set([...resp.focusNodeIds, ...result.changedIds])])
    } catch (err) {
      push({
        role: 'assistant',
        text: err instanceof Error ? err.message : 'The assistant is unreachable right now.',
      })
    } finally {
      setBusy(false)
    }
  }, [draft, busy, messages, getTree, onFocusNodes])

  const setProposalStatus = (msgId: number, status: Proposal['status']) =>
    setMessages((cur) =>
      cur.map((m) => (m.id === msgId && m.proposal ? { ...m, proposal: { ...m.proposal, status } } : m)),
    )

  const applyProposal = (msg: PanelMsg) => {
    const p = msg.proposal
    if (!p || p.status !== 'pending') return
    const current = getTree()
    let finalTree = p.afterTree
    let affected = p.affectedIds
    if (JSON.stringify(current) !== p.beforeJson) {
      // Canvas changed since this was reviewed. Re-run the ops against the
      // CURRENT tree; proceed only if the result is exactly the diff the
      // clinician just read — otherwise the review no longer covers it.
      const redo = applyOps(current, p.ops)
      const sameDiff =
        redo.ok &&
        JSON.stringify(diffTrees(current, redo.tree).map((d) => d.text)) ===
          JSON.stringify(p.diff.map((d) => d.text))
      if (!sameDiff) {
        setProposalStatus(msg.id, 'stale')
        push({
          role: 'assistant',
          text: 'The canvas changed since I drafted this, so I didn\'t apply it. Ask again and I\'ll redraft against the current tree.',
        })
        return
      }
      finalTree = redo.tree
      affected = [...redo.addedIds, ...redo.changedIds]
    }
    onApply(finalTree, affected)
    setProposalStatus(msg.id, 'applied')
    push({
      role: 'assistant',
      text:
        `Applied ${p.diff.length} change${p.diff.length === 1 ? '' : 's'} to the canvas. ` +
        'Save to library when you\'re done' +
        (p.newWarnings.length ? ' — and note the new warnings this introduced.' : '.'),
    })
  }

  return (
    <aside className="omari-enter-side flex w-[360px] shrink-0 flex-col border-l border-[#cbd5e1] bg-canvas shadow-[-6px_0_16px_rgba(31,36,33,0.07)]">
      {/* ── Header — identity hides while the welcome hero is showing ──── */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        {messages.length > 0 ? (
          <div className="flex items-center gap-2">
            <img src={sproutLogo} alt="" aria-hidden className="h-6 w-6 rounded-full" />
            <div>
              <p className="font-display text-[12.5px] font-semibold leading-tight text-ink">Sprout</p>
              <p className="text-[10.5px] leading-tight text-muted">You approve every change</p>
            </div>
          </div>
        ) : (
          <span />
        )}
        <button
          onClick={onClose}
          aria-label="Close Sprout"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-bg hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Thread ─────────────────────────────────────────────────────── */}
      <div ref={threadRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="omari-msg flex h-full flex-col items-center justify-center px-4 text-center">
            <img
              src={sproutLogo}
              alt=""
              aria-hidden
              className="h-20 w-20 rounded-full shadow-[0_4px_16px_rgba(22,41,78,0.35)]"
            />
            <p className="mt-4 font-display text-[19px] font-semibold text-ink">Sprout</p>
            <p className="mt-1 font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-strong">
              AI assistant for the Builder
            </p>
            <p className="mt-3 max-w-[280px] text-[12.5px] leading-relaxed text-muted">{INTRO}</p>

            <div className="mt-5 flex w-full max-w-[280px] flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setDraft(s)
                    inputRef.current?.focus()
                  }}
                  className="rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-muted transition-all duration-150 hover:-translate-y-px hover:border-accent hover:bg-sky hover:text-accent hover:shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`omari-msg flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[94%] px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-2xl rounded-tr-sm bg-accent-strong text-white'
                  : 'rounded-2xl rounded-tl-sm border border-line bg-bg text-ink'
              }`}
            >
              {m.text && <FormattedText text={m.text} />}
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  onApply={() => applyProposal(m)}
                  onDismiss={() => {
                    setProposalStatus(m.id, 'dismissed')
                    onFocusNodes([])
                  }}
                />
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="omari-msg flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-line bg-bg px-3.5 py-2.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" />
            </div>
          </div>
        )}
      </div>

      {/* ── Composer ───────────────────────────────────────────────────── */}
      <div className="border-t border-line px-3 py-3">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder="Ask Sprout to edit, or ask about the tree…"
          className="w-full resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <p className="text-[10.5px] text-muted">Shift+Enter for a new line</p>
          <button
            onClick={() => void send()}
            disabled={!draft.trim() || busy}
            className="omari-grad omari-grad-hover rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-[0_1px_3px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0_2px_10px_rgba(37,99,235,0.3)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  )
}

/* -------------------------------------------------------------------------- */
/* Message text renderer                                                      */
/* -------------------------------------------------------------------------- */

/** Render `**bold**` spans (a fallback — the model is told plain text only). */
function inline(text: string): ReactNode[] {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    ),
  )
}

/**
 * Lightweight message formatting: paragraphs on blank lines, list-style lines
 * ("1. …", "- …") get their marker set off in muted text. No markdown engine —
 * just enough that a reply never shows raw asterisks or a cramped wall of text.
 */
function FormattedText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/)
  return (
    <div className="space-y-1.5">
      {blocks.map((block, bi) => (
        <div key={bi} className="space-y-0.5">
          {block.split('\n').map((line, li) => {
            const m = line.match(/^\s*(\d+[.)]|[-•*])\s+(.*)$/)
            if (m) {
              return (
                <p key={li} className="flex gap-1.5">
                  <span className="shrink-0 opacity-60">{/^\d/.test(m[1]) ? m[1].replace(')', '.') : '•'}</span>
                  <span>{inline(m[2])}</span>
                </p>
              )
            }
            return <p key={li}>{inline(line)}</p>
          })}
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Proposal card — the diff the clinician reviews before anything changes     */
/* -------------------------------------------------------------------------- */

const DIFF_MARK: Record<DiffEntry['kind'], { sym: string; cls: string }> = {
  add: { sym: '+', cls: 'text-emerald-600' },
  remove: { sym: '−', cls: 'text-danger' },
  change: { sym: '~', cls: 'text-amber-600' },
}

function ProposalCard({
  proposal,
  onApply,
  onDismiss,
}: {
  proposal: Proposal
  onApply: () => void
  onDismiss: () => void
}) {
  return (
    <div className="omari-reveal mt-2 rounded-lg border border-line bg-canvas p-2.5">
      <p className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-strong">
        {proposal.diff.length} proposed change{proposal.diff.length === 1 ? '' : 's'}
      </p>
      <ul className="mt-1.5 space-y-1">
        {proposal.diff.map((d, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-ink">
            <span className={`shrink-0 font-mono font-bold ${DIFF_MARK[d.kind].cls}`} aria-hidden>
              {DIFF_MARK[d.kind].sym}
            </span>
            <span>{d.text}</span>
          </li>
        ))}
      </ul>
      {proposal.newWarnings.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
          <p className="text-[11px] font-semibold text-amber-700">This would introduce:</p>
          <ul className="mt-0.5 space-y-0.5">
            {proposal.newWarnings.map((w, i) => (
              <li key={i} className="text-[11px] leading-snug text-amber-700">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposal.status === 'pending' ? (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            onClick={onApply}
            className="rounded-md bg-accent-strong px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Apply changes
          </button>
          <button
            onClick={onDismiss}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] font-medium text-muted">
          {proposal.status === 'applied' && '✓ Applied to the canvas'}
          {proposal.status === 'dismissed' && 'Dismissed — nothing was changed'}
          {proposal.status === 'stale' && 'Stale — the canvas changed before this was applied'}
        </p>
      )}
    </div>
  )
}
