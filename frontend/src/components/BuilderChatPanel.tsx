import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import sproutLogo from '../assets/sprout-logo.png'
import type { Node as TreeNode, Tree } from '../types/tree'
import { validateTreeGraph } from '../lib/buildTree'
import { sendTreeChat, type AssistantTurn } from '../lib/assistant/api'
import { applyOps, TreeOpsSchema, type TreeOp } from '../lib/assistant/ops'
import { diffTrees, type DiffEntry } from '../lib/assistant/diff'
import { diffRouting, type RoutingImpact } from '../lib/assistant/impact'
import { detectBuilderGaps, type BuilderGap } from '../lib/assistant/gaps'

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
  /** Nodes the proposal deletes — shown faded in the canvas preview. */
  removedIds: string[]
  /** Deterministic "who ends up somewhere else" analysis (path enumeration). */
  impact: RoutingImpact
  status: 'pending' | 'stepping' | 'applied' | 'dismissed' | 'stale' | 'stopped'
  /** Step-through state (multi-op proposals reviewed one op at a time). */
  stepIndex?: number
  stepsApplied?: number
  stepDiff?: DiffEntry[]
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
  selectedNodeIds,
  onClearSelection,
  onApply,
  onPreview,
  onEndPreview,
  onFocusNodes,
  onClose,
}: {
  /** The canvas as a Tree, read fresh (positions don't matter, wiring does). */
  getTree: () => Tree
  /** Live canvas selection — scopes the conversation to "these nodes". */
  selectedNodeIds: string[]
  onClearSelection: () => void
  /** Commit a confirmed proposal to the canvas. */
  onApply: (tree: Tree, affectedIds: string[]) => void
  /** Show a proposal's candidate tree on the canvas without applying it. */
  onPreview: (tree: Tree, affectedIds: string[], removedIds: string[]) => void
  onEndPreview: () => void
  /** Highlight the nodes a reply refers to on the canvas ([] clears). */
  onFocusNodes: (ids: string[]) => void
  onClose: () => void
}) {
  // Starts empty: the welcome hero fills the thread until the first message.
  const [messages, setMessages] = useState<PanelMsg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  // Which message's proposal is being previewed on the canvas, if any.
  const [previewMsgId, setPreviewMsgId] = useState<number | null>(null)
  // Guided gap-fixing: Sprout walks the clinician through the tree's
  // deterministically-detected holes, one decision at a time.
  const [gapMode, setGapMode] = useState(false)
  const skippedGapsRef = useRef<Set<string>>(new Set())
  const currentGapRef = useRef<BuilderGap | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Cheap on a Builder-sized tree; recomputed per render so it tracks edits.
  const gapCount = detectBuilderGaps(getTree()).length

  /* ------------------------------ Voice input ---------------------------- */
  // Click-to-talk via the browser's SpeechRecognition (Chrome). The live
  // transcript streams into the composer — NOT auto-sent — so the clinician
  // can fix mis-heard clinical terms before Sprout acts on anything.
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<any>(null)
  const speechBaseRef = useRef('') // draft text present when recording started
  const speechFinalRef = useRef('') // finalized speech accumulated this recording

  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening()
      return
    }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    speechBaseRef.current = draft.trim() ? `${draft.replace(/\s+$/, '')} ` : ''
    speechFinalRef.current = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) speechFinalRef.current += r[0].transcript
        else interim += r[0].transcript
      }
      setDraft((speechBaseRef.current + speechFinalRef.current + interim).trimStart())
    }
    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        push({
          role: 'assistant',
          text: 'I need microphone access to listen — allow it in the browser (the icon in the address bar) and tap the mic again.',
        })
      }
    }
    rec.onend = () => {
      setListening(false)
      recognitionRef.current = null
      inputRef.current?.focus()
    }
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }, [listening, draft, stopListening])

  // Never leave the mic running when the panel unmounts.
  useEffect(() => () => recognitionRef.current?.stop(), [])

  // Human labels for the selection chip ("symptomLocation, Dr. Reyes…").
  const scopeLabels = useMemo(() => {
    if (selectedNodeIds.length === 0) return []
    const byId = new Map(getTree().nodes.map((n) => [n.id, n]))
    return selectedNodeIds.map((id) => {
      const n = byId.get(id)
      if (!n) return id
      return n.type === 'variable' ? n.variableKey : n.type === 'specialist' ? n.specialistName : 'Escalation'
    })
  }, [selectedNodeIds, getTree])

  // Suggestions follow the selection: pick nodes and the chips offer the
  // edits that make sense for exactly those nodes.
  const scopedSuggestions = useMemo(() => {
    if (selectedNodeIds.length === 0) return []
    const byId = new Map(getTree().nodes.map((n) => [n.id, n]))
    const sel = selectedNodeIds.map((id) => byId.get(id)).filter(Boolean) as TreeNode[]
    const specialists = sel.filter((n) => n.type === 'specialist')
    const variables = sel.filter((n) => n.type === 'variable')
    if (sel.length === 1 && specialists.length === 1)
      return ['Add … to this workup', 'Change urgency to …', 'Which paths reach this node?']
    if (specialists.length >= 2 && specialists.length === sel.length)
      return ['What distinguishes these specialists?', 'Reroute paths from these to Dr. …']
    if (sel.length === 1 && variables.length === 1)
      return ['Add a bucket for …', 'Which buckets here are unwired?']
    return ['What do these nodes do?', 'Delete these nodes']
  }, [selectedNodeIds, getTree])

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
    if (listening) stopListening() // sending ends the recording
    // A new message ends any canvas preview — the conversation moves on.
    if (previewMsgId !== null) {
      onEndPreview()
      setPreviewMsgId(null)
    }
    setDraft('')
    const priorMsgs = messages
    push({ role: 'user', text })
    setBusy(true)
    try {
      const tree = getTree()
      const warnings = validateTreeGraph(tree).map((w) => w.message)
      // During gap fixing, the current gap's nodes scope the turn exactly —
      // the clinician's answer applies to THAT node, no re-asking which one.
      const scopeIds =
        selectedNodeIds.length > 0
          ? selectedNodeIds
          : gapMode && currentGapRef.current
            ? currentGapRef.current.nodeIds
            : []
      const resp = await sendTreeChat({
        tree,
        message: text,
        history: historyFor(priorMsgs.slice(-12)),
        warnings,
        selectedNodeIds: scopeIds,
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
      const afterIds = new Set(result.tree.nodes.map((n) => n.id))
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
          removedIds: tree.nodes.filter((n) => !afterIds.has(n.id)).map((n) => n.id),
          impact: diffRouting(tree, result.tree),
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
  }, [draft, busy, messages, getTree, onFocusNodes, selectedNodeIds, previewMsgId, onEndPreview, gapMode, listening, stopListening])

  const setProposalStatus = (msgId: number, status: Proposal['status']) =>
    setMessages((cur) =>
      cur.map((m) => (m.id === msgId && m.proposal ? { ...m, proposal: { ...m.proposal, status } } : m)),
    )

  const togglePreview = (msg: PanelMsg) => {
    const p = msg.proposal
    if (!p || p.status !== 'pending') return
    if (previewMsgId === msg.id) {
      onEndPreview()
      setPreviewMsgId(null)
      return
    }
    onPreview(p.afterTree, p.affectedIds, p.removedIds)
    setPreviewMsgId(msg.id)
  }

  const applyProposal = (msg: PanelMsg) => {
    const p = msg.proposal
    if (!p || p.status !== 'pending') return
    setPreviewMsgId(null) // onApply commits and tears the preview down itself
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
        onEndPreview() // no-op unless a preview was left up
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
    if (gapMode) presentNextGap()
  }

  /* ------------------------- Guided gap fixing --------------------------- */

  const presentNextGap = () => {
    const remaining = detectBuilderGaps(getTree()).filter((g) => !skippedGapsRef.current.has(g.id))
    if (remaining.length === 0) {
      currentGapRef.current = null
      setGapMode(false)
      onFocusNodes([])
      push({
        role: 'assistant',
        text:
          skippedGapsRef.current.size > 0
            ? 'That\'s every gap — the rest were skipped. Save to library when you\'re ready.'
            : 'That\'s every gap resolved — the tree is structurally clean. Save to library when you\'re ready.',
      })
      return
    }
    const g = remaining[0]
    currentGapRef.current = g
    push({
      role: 'assistant',
      text: `${remaining.length} to go — ${g.question}`,
    })
    onFocusNodes(g.nodeIds)
  }

  const startGapFix = () => {
    if (busy) return
    skippedGapsRef.current = new Set()
    setGapMode(true)
    presentNextGap()
  }

  const skipGap = () => {
    if (currentGapRef.current) skippedGapsRef.current.add(currentGapRef.current.id)
    presentNextGap()
  }

  const stopGapFix = () => {
    setGapMode(false)
    currentGapRef.current = null
    onFocusNodes([])
  }

  /* ---------------------- Step-through (plan mode) ----------------------- */

  const patchProposal = (msgId: number, patch: Partial<Proposal>) =>
    setMessages((cur) =>
      cur.map((m) => (m.id === msgId && m.proposal ? { ...m, proposal: { ...m.proposal, ...patch } } : m)),
    )

  /** What op #i would do to the tree AS IT IS RIGHT NOW. */
  const computeStepDiff = (op: TreeOp): DiffEntry[] => {
    const cur = getTree()
    const res = applyOps(cur, [op])
    if (!res.ok)
      return [{ kind: 'change', text: `This step can't apply on the current tree (${res.errors[0]}). Skip it or stop.` }]
    return diffTrees(cur, res.tree)
  }

  const startStepping = (msg: PanelMsg) => {
    const p = msg.proposal
    if (!p || p.status !== 'pending') return
    if (previewMsgId === msg.id) {
      onEndPreview()
      setPreviewMsgId(null)
    }
    patchProposal(msg.id, { status: 'stepping', stepIndex: 0, stepsApplied: 0, stepDiff: computeStepDiff(p.ops[0]) })
  }

  const advanceStep = (msg: PanelMsg, apply: boolean) => {
    const p = msg.proposal
    if (!p || p.status !== 'stepping' || p.stepIndex === undefined) return
    let applied = p.stepsApplied ?? 0
    if (apply) {
      const res = applyOps(getTree(), [p.ops[p.stepIndex]])
      if (!res.ok) {
        push({
          role: 'assistant',
          text: `Step ${p.stepIndex + 1} couldn't apply: ${res.errors.join('; ')}. Skip it or stop.`,
        })
        return
      }
      onApply(res.tree, [...res.addedIds, ...res.changedIds])
      applied += 1
    }
    const next = p.stepIndex + 1
    if (next >= p.ops.length) {
      patchProposal(msg.id, { status: applied > 0 ? 'applied' : 'dismissed', stepsApplied: applied })
      push({
        role: 'assistant',
        text: `Done — applied ${applied} of ${p.ops.length} step${p.ops.length === 1 ? '' : 's'}.`,
      })
      if (gapMode) presentNextGap()
      return
    }
    patchProposal(msg.id, { stepIndex: next, stepsApplied: applied, stepDiff: computeStepDiff(p.ops[next]) })
  }

  const stopStepping = (msg: PanelMsg) => {
    const p = msg.proposal
    if (!p || p.status !== 'stepping') return
    patchProposal(msg.id, { status: 'stopped' })
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
              className="h-20 w-20 rounded-full shadow-[0_4px_16px_rgba(30,58,138,0.35)]"
            />
            <p className="mt-4 font-display text-[19px] font-semibold text-ink">Sprout</p>
            <p className="mt-1 font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-strong">
              AI assistant for the tree Builder
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
              {gapCount > 0 && (
                <button
                  onClick={startGapFix}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700 transition-all duration-150 hover:-translate-y-px hover:border-amber-400 hover:bg-amber-100 hover:shadow-sm"
                >
                  ⚠ Fix {gapCount} gap{gapCount === 1 ? '' : 's'} step-by-step
                </button>
              )}
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
                  previewing={previewMsgId === m.id}
                  onTogglePreview={() => togglePreview(m)}
                  onApply={() => applyProposal(m)}
                  onStepThrough={() => startStepping(m)}
                  onApplyStep={() => advanceStep(m, true)}
                  onSkipStep={() => advanceStep(m, false)}
                  onStopStepping={() => stopStepping(m)}
                  onDismiss={() => {
                    if (previewMsgId === m.id) {
                      onEndPreview()
                      setPreviewMsgId(null)
                    }
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
        {/* Guided gap fixing: entry chip when gaps exist, controls while active. */}
        {!gapMode && gapCount > 0 && messages.length > 0 && (
          <button
            onClick={startGapFix}
            className="mb-1.5 flex w-full items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-left text-[11.5px] font-medium text-amber-700 transition-colors hover:border-amber-400 hover:bg-amber-100"
          >
            <span aria-hidden>⚠</span>
            Fix {gapCount} gap{gapCount === 1 ? '' : 's'} in this tree, one decision at a time
          </button>
        )}
        {gapMode && (
          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-accent/40 bg-sky px-2.5 py-1.5">
            <span className="min-w-0 truncate text-[11px] font-medium text-accent-strong">
              Fixing gaps — answer above, or
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={skipGap}
                className="rounded-md border border-accent/40 px-2 py-0.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
              >
                Skip
              </button>
              <button
                onClick={stopGapFix}
                className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
              >
                Stop
              </button>
            </div>
          </div>
        )}

        {/* Selection scope chip — always visible while a selection is active,
            so it's never a mystery what "these" means to Sprout. */}
        {selectedNodeIds.length > 0 && (
          <div className="omari-msg mb-1.5 flex items-center gap-1.5 rounded-lg border border-accent/40 bg-sky px-2 py-1">
            <span className="shrink-0 font-display text-[9.5px] font-semibold uppercase tracking-[0.07em] text-accent">
              Editing {selectedNodeIds.length} node{selectedNodeIds.length === 1 ? '' : 's'}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink" title={scopeLabels.join(', ')}>
              {scopeLabels.join(', ')}
            </span>
            <button
              onClick={onClearSelection}
              aria-label="Clear selection"
              className="grid h-4 w-4 shrink-0 place-items-center rounded text-accent transition-colors hover:bg-accent hover:text-white"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Scoped quick actions — follow what's selected. */}
        {scopedSuggestions.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {scopedSuggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setDraft(s)
                  inputRef.current?.focus()
                }}
                className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10.5px] text-muted transition-colors hover:border-accent hover:bg-sky hover:text-accent"
              >
                {s}
              </button>
            ))}
          </div>
        )}

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
          <p className={`text-[10.5px] ${listening ? 'font-medium text-danger' : 'text-muted'}`}>
            {listening ? 'Listening — talk through the edit, then review and send' : 'Shift+Enter for a new line'}
          </p>
          <div className="flex items-center gap-1.5">
            {speechSupported && (
              <button
                onClick={toggleListening}
                aria-pressed={listening}
                title={listening ? 'Stop listening' : 'Talk instead of typing — the transcript lands here for you to review'}
                className={`grid h-8 w-8 place-items-center rounded-md border transition-all ${
                  listening
                    ? 'animate-pulse border-danger bg-danger text-white'
                    : 'border-line text-muted hover:border-accent hover:bg-sky hover:text-accent'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </button>
            )}
            <button
              onClick={() => void send()}
              disabled={!draft.trim() || busy}
              className="omari-grad omari-grad-hover rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-[0_1px_3px_rgba(37,99,235,0.3)] transition-all hover:shadow-[0_2px_10px_rgba(37,99,235,0.3)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              Send
            </button>
          </div>
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

/**
 * "Who ends up somewhere else?" — the deterministic consequence of the
 * proposal, computed by enumerating every decision path in both trees.
 */
function RoutingImpactSection({ impact }: { impact: RoutingImpact }) {
  const lines: { key: string; text: string }[] = []
  for (const c of impact.changed) lines.push({ key: `c${c.path}`, text: `${c.path} — now ${c.to} (was ${c.from})` })
  for (const a of impact.added) lines.push({ key: `a${a.path}`, text: `new: ${a.path} → ${a.to}` })
  for (const r of impact.removed) lines.push({ key: `r${r.path}`, text: `removed: ${r.path} (went to ${r.from})` })
  const shown = lines.slice(0, 6)

  return (
    <div className="mt-2 border-t border-line pt-1.5">
      <p className="font-display text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted">
        Routing impact
      </p>
      {lines.length === 0 ? (
        <p className="mt-0.5 text-[11.5px] text-muted">
          No patient paths change destination{impact.totalAfter ? ` (${impact.totalAfter} paths checked)` : ''}.
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-[11.5px] font-medium text-ink">
            {impact.changed.length > 0 && `${impact.changed.length} of ${impact.totalAfter} paths change destination`}
            {impact.changed.length > 0 && (impact.added.length > 0 || impact.removed.length > 0) && ' · '}
            {impact.added.length > 0 && `${impact.added.length} new`}
            {impact.added.length > 0 && impact.removed.length > 0 && ' · '}
            {impact.removed.length > 0 && `${impact.removed.length} removed`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {shown.map((l) => (
              <li key={l.key} className="text-[11px] leading-snug text-muted">
                {l.text}
              </li>
            ))}
            {lines.length > shown.length && (
              <li className="text-[11px] italic text-muted">+ {lines.length - shown.length} more</li>
            )}
          </ul>
          {impact.truncated && (
            <p className="mt-0.5 text-[10.5px] italic text-muted">Large tree — impact checked on the first 400 paths.</p>
          )}
        </>
      )}
    </div>
  )
}

function ProposalCard({
  proposal,
  previewing,
  onTogglePreview,
  onApply,
  onStepThrough,
  onApplyStep,
  onSkipStep,
  onStopStepping,
  onDismiss,
}: {
  proposal: Proposal
  previewing: boolean
  onTogglePreview: () => void
  onApply: () => void
  onStepThrough: () => void
  onApplyStep: () => void
  onSkipStep: () => void
  onStopStepping: () => void
  onDismiss: () => void
}) {
  const isPlan = proposal.ops.length >= 3
  const stepping = proposal.status === 'stepping' && proposal.stepIndex !== undefined

  if (stepping) {
    return (
      <div className="omari-reveal mt-2 rounded-lg border border-accent/40 bg-canvas p-2.5">
        <p className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-strong">
          Step {proposal.stepIndex! + 1} of {proposal.ops.length}
          {(proposal.stepsApplied ?? 0) > 0 && ` · ${proposal.stepsApplied} applied`}
        </p>
        <ul className="mt-1.5 space-y-1">
          {(proposal.stepDiff ?? []).map((d, i) => (
            <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-ink">
              <span className={`shrink-0 font-mono font-bold ${DIFF_MARK[d.kind].cls}`} aria-hidden>
                {DIFF_MARK[d.kind].sym}
              </span>
              <span>{d.text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            onClick={onApplyStep}
            className="rounded-md bg-accent-strong px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Apply step
          </button>
          <button
            onClick={onSkipStep}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
          >
            Skip step
          </button>
          <button
            onClick={onStopStepping}
            className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
          >
            Stop
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="omari-reveal mt-2 rounded-lg border border-line bg-canvas p-2.5">
      <p className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-strong">
        {isPlan
          ? `Plan — ${proposal.diff.length} changes in ${proposal.ops.length} steps`
          : `${proposal.diff.length} proposed change${proposal.diff.length === 1 ? '' : 's'}`}
      </p>
      <ul className="mt-1.5 space-y-1">
        {proposal.diff.map((d, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-ink">
            {isPlan && <span className="w-4 shrink-0 text-right text-[11px] text-muted">{i + 1}.</span>}
            <span className={`shrink-0 font-mono font-bold ${DIFF_MARK[d.kind].cls}`} aria-hidden>
              {DIFF_MARK[d.kind].sym}
            </span>
            <span>{d.text}</span>
          </li>
        ))}
      </ul>
      <RoutingImpactSection impact={proposal.impact} />
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
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            onClick={onApply}
            className="rounded-md bg-accent-strong px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {isPlan ? 'Apply all' : 'Apply changes'}
          </button>
          {isPlan && (
            <button
              onClick={onStepThrough}
              title="Review and apply one step at a time"
              className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-accent hover:bg-sky hover:text-accent"
            >
              Step through
            </button>
          )}
          <button
            onClick={onTogglePreview}
            aria-pressed={previewing}
            title="Show this change on the canvas without applying it"
            className={`rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              previewing
                ? 'border-accent bg-sky text-accent'
                : 'border-line text-muted hover:border-accent hover:bg-sky hover:text-accent'
            }`}
          >
            {previewing ? 'Exit preview' : 'Preview on canvas'}
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
          {proposal.status === 'stopped' &&
            `Stopped — applied ${proposal.stepsApplied ?? 0} of ${proposal.ops.length} steps`}
        </p>
      )}
    </div>
  )
}
