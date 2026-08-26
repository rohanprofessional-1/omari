import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import sproutLogo from '../assets/sprout-logo.png'
import type { Node as TreeNode, Tree } from '../types/tree'
import { validateTreeGraph } from '../lib/buildTree'
import { sendTreeChat, sendTreeChatStream, type AssistantTurn, type TreeChatResponse } from '../lib/assistant/api'
import { applyOps, describeMoves, TreeOpsSchema, type ApplyResult, type NodeMove, type TreeOp } from '../lib/assistant/ops'
import { diffTrees, type DiffEntry } from '../lib/assistant/diff'
import { diffRouting, type RoutingImpact } from '../lib/assistant/impact'
import { detectBuilderGaps, type BuilderGap } from '../lib/assistant/gaps'
import {
  generateTreeFromDocuments,
  type GenProgress,
  type GenerateFromDocsResult,
} from '../lib/assistant/genFromDocs'

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
  /** Layout-only canvas moves (never touch tree data or wiring). */
  moves: NodeMove[]
  /** Deterministic "who ends up somewhere else" analysis (path enumeration). */
  impact: RoutingImpact
  status: 'pending' | 'stepping' | 'applied' | 'dismissed' | 'stale' | 'stopped' | 'undone'
  /** Step-through state (multi-op proposals reviewed one op at a time). */
  stepIndex?: number
  stepsApplied?: number
  stepDiff?: DiffEntry[]
  /** Tree JSON right after a full Apply — undo is only safe while this matches. */
  appliedJson?: string
  /** The clinician instruction that produced this proposal — powers Redraft. */
  sourceText: string
}

/**
 * A document-to-tree generation, awaiting the clinician's review. Sprout
 * extracts the guideline into a draft and SAVES it to the library, but nothing
 * opens on the canvas until the clinician confirms — the same "you approve
 * every change" contract the edit proposals honour, applied to generation.
 */
interface Generation {
  /** The saved library tree id — opened on the canvas only on confirm. */
  treeId: string
  treeName: string
  fileNames: string[]
  placeholderCount: number
  issueCount: number
  status: 'ready' | 'opened' | 'dismissed'
}

interface PanelMsg {
  id: number
  role: 'user' | 'assistant'
  text: string
  proposal?: Proposal
  generation?: Generation
  /** Set on error bubbles: the instruction that failed — powers Retry. */
  failedText?: string
}

const INTRO =
  'I can build a new tree from your clinical guidelines, explain any part of the tree you have, or make edits you approve before they go live. You decide the medicine; I handle the busywork.'

/** Starter prompts — tapping one drops it into the composer to finish. */
const SUGGESTIONS = [
  'Build a tree from a guideline document',
  'Which buckets are unwired?',
  'Reroute … patients to Dr. …',
]

let nextMsgId = 1

/** Everything the clinician is confirming: the clinical diff plus any layout-move lines. */
function fullDiff(before: Tree, result: ApplyResult): DiffEntry[] {
  return [
    ...diffTrees(before, result.tree),
    ...describeMoves(before, result.moves).map((text): DiffEntry => ({ kind: 'change', text })),
  ]
}

/** Threads restored from localStorage may predate layout moves. */
const movesOf = (p: Proposal): NodeMove[] => p.moves ?? []
const movedIdsOf = (p: Proposal): string[] => movesOf(p).flatMap((m) => m.nodeIds)

/**
 * Per-tree thread persistence (localStorage v1). The saved thread doubles as
 * a change log: applied proposals keep their instruction, diff, and outcome.
 * Live-only states can't survive a reload — a mid-flight step-through is
 * frozen to 'stopped'; the staleness guard already protects restored pending
 * proposals from applying against a tree that has since changed.
 */
function threadStorageKey(treeKey: string): string {
  return `omari:sproutThread:${treeKey}`
}

function loadThread(treeKey: string): PanelMsg[] {
  try {
    const raw = localStorage.getItem(threadStorageKey(treeKey))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    let maxId = 0
    const msgs: PanelMsg[] = []
    for (const m of parsed) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string') continue
      maxId = Math.max(maxId, typeof m.id === 'number' ? m.id : 0)
      msgs.push(
        m.proposal?.status === 'stepping'
          ? { ...m, proposal: { ...m.proposal, status: 'stopped' } }
          : m,
      )
    }
    nextMsgId = Math.max(nextMsgId, maxId + 1)
    return msgs
  } catch {
    return []
  }
}

function saveThread(treeKey: string, messages: PanelMsg[]): void {
  try {
    if (messages.length === 0) localStorage.removeItem(threadStorageKey(treeKey))
    else localStorage.setItem(threadStorageKey(treeKey), JSON.stringify(messages.slice(-50)))
  } catch {
    /* storage full/unavailable — the chat still works, it just won't persist */
  }
}

export default function BuilderChatPanel({
  getTree,
  threadKey,
  selectedNodeIds,
  onClearSelection,
  onApply,
  onPreview,
  onEndPreview,
  onFocusNodes,
  onGenerateComplete,
  onClose,
}: {
  /** The canvas as a Tree, read fresh (positions don't matter, wiring does). */
  getTree: () => Tree
  /** Persistence key for the thread — the open library tree's id. */
  threadKey: string
  /** Live canvas selection — scopes the conversation to "these nodes". */
  selectedNodeIds: string[]
  onClearSelection: () => void
  /** Commit a confirmed proposal to the canvas (moves are layout-only). */
  onApply: (tree: Tree, affectedIds: string[], moves?: NodeMove[]) => void
  /** Show a proposal's candidate tree on the canvas without applying it. */
  onPreview: (tree: Tree, affectedIds: string[], removedIds: string[]) => void
  onEndPreview: () => void
  /** Highlight the nodes a reply refers to on the canvas ([] clears). */
  onFocusNodes: (ids: string[]) => void
  /** Open a freshly generated library tree on the canvas (confirm-gated). */
  onGenerateComplete: (treeId: string) => void
  onClose: () => void
}) {
  // Restored from localStorage per tree; the welcome hero fills an empty
  // thread. The PARENT remounts this panel (React key) when the open tree
  // changes, so this state always belongs to exactly one thread key.
  const [messages, setMessages] = useState<PanelMsg[]>(() => loadThread(threadKey))
  useEffect(() => {
    saveThread(threadKey, messages)
  }, [threadKey, messages])
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

  /* --------------------- Document-to-tree generation --------------------- */
  // Guideline docs the clinician has attached but not yet generated from.
  const [genFiles, setGenFiles] = useState<File[]>([])
  // Non-null while extraction is running — its text is the live progress line.
  const [genProgress, setGenProgress] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const push = (msg: Omit<PanelMsg, 'id'>): number => {
    const id = nextMsgId++
    setMessages((cur) => [...cur, { ...msg, id }])
    return id
  }

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

  // The full turn pipeline — used by the composer, Retry, and Redraft.
  const sendText = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text || busy) return
    if (listening) stopListening() // sending ends the recording
    // A new message ends any canvas preview — the conversation moves on.
    if (previewMsgId !== null) {
      onEndPreview()
      setPreviewMsgId(null)
    }
    const priorMsgs = messages
    push({ role: 'user', text })
    setBusy(true)
    // Streaming: the reply text lands in a placeholder bubble as it generates;
    // the final structured payload then upgrades that SAME bubble (with the
    // proposal card, or the final text). Falls back to non-streaming cleanly.
    let streamMsgId: number | null = null
    let streamed = ''
    const emit = (patch: { text: string; proposal?: Proposal; failedText?: string }) => {
      if (streamMsgId !== null) {
        const id = streamMsgId
        setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, ...patch } : m)))
      } else {
        push({ role: 'assistant', ...patch })
      }
    }
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
      const request = {
        tree,
        message: text,
        history: historyFor(priorMsgs.slice(-12)),
        warnings,
        selectedNodeIds: scopeIds,
      }
      let resp: TreeChatResponse
      try {
        resp = await sendTreeChatStream(request, (t) => {
          streamed += t
          if (streamMsgId === null) {
            streamMsgId = push({ role: 'assistant', text: streamed })
          } else {
            const id = streamMsgId
            setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, text: streamed } : m)))
          }
        })
      } catch (streamErr) {
        console.warn('[Sprout] stream failed — falling back to non-streaming:', streamErr)
        resp = await sendTreeChat(request)
      }

      if (resp.mode !== 'propose') {
        emit({ text: resp.message || '…' })
        // Point at what the reply is talking about (clears stale highlights).
        onFocusNodes(resp.focusNodeIds)
        return
      }

      // Proposal path: Zod gate → deterministic apply on a copy → diff.
      const parsedOps = TreeOpsSchema.safeParse(resp.operations)
      if (!parsedOps.success) {
        emit({
          text: `That draft didn't pass validation, so nothing changed. Try rephrasing — ideally naming the exact node or bucket. (${parsedOps.error.issues[0]?.message ?? 'invalid operations'})`,
        })
        return
      }
      const result = applyOps(tree, parsedOps.data)
      if (!result.ok) {
        emit({
          text: `That draft didn't apply cleanly, so nothing changed: ${result.errors.join('; ')}. Try rephrasing.`,
        })
        return
      }
      const diff = fullDiff(tree, result)
      if (diff.length === 0) {
        emit({ text: resp.message || 'The tree already says that — no change needed.' })
        return
      }
      const beforeWarnings = new Set(warnings)
      const newWarnings = validateTreeGraph(result.tree)
        .map((w) => w.message)
        .filter((w) => !beforeWarnings.has(w))
      const afterIds = new Set(result.tree.nodes.map((n) => n.id))
      emit({
        text: resp.message,
        proposal: {
          ops: parsedOps.data,
          beforeJson: JSON.stringify(tree),
          afterTree: result.tree,
          diff,
          newWarnings,
          affectedIds: [...result.addedIds, ...result.changedIds],
          removedIds: tree.nodes.filter((n) => !afterIds.has(n.id)).map((n) => n.id),
          moves: result.moves,
          impact: diffRouting(tree, result.tree),
          status: 'pending',
          sourceText: text,
        },
      })
      // While the diff is under review, highlight the nodes it would touch
      // (added nodes don't exist on the canvas yet — changed and moved ones do).
      onFocusNodes([
        ...new Set([...resp.focusNodeIds, ...result.changedIds, ...result.moves.flatMap((m) => m.nodeIds)]),
      ])
    } catch (err) {
      emit({
        text: err instanceof Error ? err.message : 'The assistant is unreachable right now.',
        failedText: text,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, messages, getTree, onFocusNodes, selectedNodeIds, previewMsgId, onEndPreview, gapMode, listening, stopListening])

  const send = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void sendText(text)
  }, [draft, sendText])

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
    // Moved nodes ghost-highlight too — the preview can't show new positions
    // (layout lands on Apply), but it shows exactly which cards would move.
    onPreview(p.afterTree, [...new Set([...p.affectedIds, ...movedIdsOf(p)])], p.removedIds)
    setPreviewMsgId(msg.id)
  }

  const applyProposal = (msg: PanelMsg) => {
    const p = msg.proposal
    if (!p || p.status !== 'pending') return
    setPreviewMsgId(null) // onApply commits and tears the preview down itself
    const current = getTree()
    let finalTree = p.afterTree
    let affected = p.affectedIds
    let moves = movesOf(p)
    if (JSON.stringify(current) !== p.beforeJson) {
      // Canvas changed since this was reviewed. Re-run the ops against the
      // CURRENT tree; proceed only if the result is exactly the diff the
      // clinician just read — otherwise the review no longer covers it.
      const redo = applyOps(current, p.ops)
      const sameDiff =
        redo.ok &&
        JSON.stringify(fullDiff(current, redo).map((d) => d.text)) ===
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
      moves = redo.moves
    }
    onApply(finalTree, affected, moves)
    patchProposal(msg.id, { status: 'applied', appliedJson: JSON.stringify(finalTree) })
    push({
      role: 'assistant',
      text:
        `Applied ${p.diff.length} change${p.diff.length === 1 ? '' : 's'} to the canvas. ` +
        'Save to library when you\'re done' +
        (p.newWarnings.length ? ' — and note the new warnings this introduced.' : '.'),
    })
    if (gapMode) presentNextGap()
  }

  // Regret-after-apply: restore the exact before-tree, but ONLY while the
  // canvas still matches what Apply produced — the same honesty rule as the
  // staleness guard, pointed the other way.
  const undoProposal = (msg: PanelMsg) => {
    const p = msg.proposal
    if (!p || p.status !== 'applied' || !p.appliedJson) return
    if (JSON.stringify(getTree()) !== p.appliedJson) {
      push({
        role: 'assistant',
        text: 'The canvas has changed since this was applied, so undoing it could clobber newer work — I left everything as is. Tell me what to revert and I\'ll draft it as a normal change.',
      })
      return
    }
    onApply(JSON.parse(p.beforeJson) as Tree, [...p.affectedIds, ...p.removedIds])
    patchProposal(msg.id, { status: 'undone' })
    push({ role: 'assistant', text: 'Reverted — the tree is back to how it was before that change.' })
  }

  /* --------------------- Document-to-tree generation --------------------- */

  const addGenFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list)
    if (incoming.length === 0) return
    setGenFiles((cur) => {
      // De-dupe by name+size so a double-pick doesn't extract the same doc twice.
      const seen = new Set(cur.map((f) => `${f.name}:${f.size}`))
      const next = [...cur]
      for (const f of incoming) {
        const key = `${f.name}:${f.size}`
        if (!seen.has(key)) {
          seen.add(key)
          next.push(f)
        }
      }
      return next
    })
  }

  const removeGenFile = (idx: number) => setGenFiles((cur) => cur.filter((_, i) => i !== idx))

  /**
   * Build a tree from the attached guideline docs. Extraction runs on the
   * backend (same pipeline as the old Generate wizard); the result is SAVED to
   * the library but NOT opened — a generation card lets the clinician review
   * what came back and confirm before it lands on the canvas.
   */
  const runGeneration = useCallback(async () => {
    if (busy || genProgress !== null || genFiles.length === 0) return
    const files = genFiles
    const names = files.map((f) => f.name)
    setGenFiles([])
    push({
      role: 'user',
      text: `Build a tree from ${names.length === 1 ? names[0] : `${names.length} guideline documents`}.`,
    })
    setGenProgress('Reading your documents…')
    const label = (p: GenProgress): string => {
      if (p.phase === 'session') return 'Setting up the generation session…'
      if (p.phase === 'save') return 'Saving the draft to your library…'
      return `Extracting logic from ${p.fileName} (${p.index + 1} of ${p.total})… this takes about 30 seconds.`
    }
    try {
      const result: GenerateFromDocsResult = await generateTreeFromDocuments(
        {
          files,
          // A generated draft carries the clinic's default subspecialty; the
          // clinician renames/retargets in the Builder. Kept simple on purpose
          // — the old wizard's form fields become Builder edits post-open.
          subspecialty: 'General',
        },
        (p) => setGenProgress(label(p)),
      )
      const issueCount = result.validationIssues.length
      push({
        role: 'assistant',
        text:
          `I drafted a tree from ${names.length === 1 ? names[0] : `${names.length} documents`} and saved it to your library. ` +
          'Review the summary below, then open it to work on the canvas — nothing changes here until you do.',
        generation: {
          treeId: result.summary.id,
          treeName: result.summary.name,
          fileNames: result.fileNames,
          placeholderCount: result.placeholderCount,
          issueCount,
          status: 'ready',
        },
      })
    } catch (err) {
      push({
        role: 'assistant',
        text:
          err instanceof Error
            ? `I couldn't build a tree from those documents: ${err.message}`
            : 'I couldn\'t build a tree from those documents.',
      })
    } finally {
      setGenProgress(null)
    }
  }, [busy, genProgress, genFiles])

  const openGeneratedTree = (msg: PanelMsg) => {
    const g = msg.generation
    if (!g || g.status !== 'ready') return
    onGenerateComplete(g.treeId)
    setMessages((cur) =>
      cur.map((m) => (m.id === msg.id && m.generation ? { ...m, generation: { ...m.generation, status: 'opened' } } : m)),
    )
    push({
      role: 'assistant',
      text:
        'Opened it on the canvas. ' +
        (g.placeholderCount > 0
          ? `Assign the ${g.placeholderCount} placeholder specialist${g.placeholderCount === 1 ? '' : 's'} and I'll help wire up the rest — just ask.`
          : 'Ask me to explain any part, or to make edits.'),
    })
  }

  const dismissGeneration = (msg: PanelMsg) => {
    setMessages((cur) =>
      cur.map((m) =>
        m.id === msg.id && m.generation && m.generation.status === 'ready'
          ? { ...m, generation: { ...m.generation, status: 'dismissed' } }
          : m,
      ),
    )
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
    return fullDiff(cur, res)
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
      onApply(res.tree, [...res.addedIds, ...res.changedIds], res.moves)
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
    <aside className="omari-enter-side flex w-[360px] shrink-0 flex-col border-l border-line bg-canvas shadow-subtle">
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
        <div className="flex shrink-0 items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Clear this conversation? Applied changes stay on the canvas.')) {
                  setMessages([])
                  onFocusNodes([])
                }
              }}
              aria-label="Clear conversation"
              title="Clear this conversation (applied changes stay on the canvas)"
              className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-bg hover:text-ink"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close Sprout"
            className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-bg hover:text-ink"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Thread ─────────────────────────────────────────────────────── */}
      <div ref={threadRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="omari-msg flex h-full flex-col items-center justify-center px-4 text-center">
            <img
              src={sproutLogo}
              alt=""
              aria-hidden
              className="h-20 w-20 rounded-full shadow-subtle"
            />
            <p className="mt-4 font-serif text-[20px] font-semibold text-ink">Sprout</p>
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
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-sky px-3 py-2 text-[12px] font-medium text-accent-strong transition-all duration-150 hover:-translate-y-px hover:border-accent hover:shadow-sm"
              >
                <PaperclipIcon />
                Attach a guideline to build a tree
              </button>
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
              {m.failedText && (
                <button
                  onClick={() => void sendText(m.failedText!)}
                  disabled={busy}
                  className="mt-2 rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-muted transition-colors hover:border-accent hover:bg-sky hover:text-accent disabled:opacity-40"
                >
                  ↻ Retry
                </button>
              )}
              {m.generation && (
                <GenerationCard
                  generation={m.generation}
                  onOpen={() => openGeneratedTree(m)}
                  onDismiss={() => dismissGeneration(m)}
                />
              )}
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  previewing={previewMsgId === m.id}
                  onTogglePreview={() => togglePreview(m)}
                  onApply={() => applyProposal(m)}
                  onUndo={() => undoProposal(m)}
                  onRedraft={() => void sendText(m.proposal!.sourceText)}
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

        {/* Typing dots only until the streamed reply starts arriving. */}
        {busy && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="omari-msg flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-line bg-bg px-3.5 py-2.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" />
            </div>
          </div>
        )}

        {/* Generation is long (LLM extraction per section) — a labelled
            progress line, not silent dots, so the wait reads as work. */}
        {genProgress && (
          <div className="omari-msg flex justify-start">
            <div className="flex max-w-[94%] items-center gap-2 rounded-2xl rounded-tl-sm border border-accent/40 bg-sky px-3.5 py-2.5">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
              <span className="text-[12px] font-medium leading-snug text-accent-strong">{genProgress}</span>
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

        {/* Attached guideline docs, awaiting a Generate click. This is the old
            Generate wizard's upload list, now a staging tray in the composer. */}
        {genFiles.length > 0 && (
          <div className="omari-msg mb-1.5 rounded-lg border border-accent/40 bg-sky px-2 py-1.5">
            <div className="flex items-center justify-between">
              <span className="font-display text-[9.5px] font-semibold uppercase tracking-[0.07em] text-accent">
                {genFiles.length} document{genFiles.length === 1 ? '' : 's'} to build from
              </span>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[10.5px] font-medium text-accent underline-offset-2 hover:underline"
              >
                Add more
              </button>
            </div>
            <ul className="mt-1 space-y-0.5">
              {genFiles.map((f, i) => (
                <li key={`${f.name}:${i}`} className="flex items-center gap-1.5 text-[11px] text-ink">
                  <PaperclipIcon />
                  <span className="min-w-0 flex-1 truncate" title={f.name}>
                    {f.name}
                  </span>
                  <button
                    onClick={() => removeGenFile(i)}
                    aria-label={`Remove ${f.name}`}
                    className="grid h-4 w-4 shrink-0 place-items-center rounded text-accent transition-colors hover:bg-accent hover:text-white"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => void runGeneration()}
              disabled={busy || genProgress !== null}
              className="omari-grad omari-grad-hover mt-1.5 w-full rounded-md px-3 py-1.5 text-[12px] font-semibold text-white shadow-subtle transition-all hover:shadow-subtle active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {genProgress ? 'Building…' : `Build a tree from ${genFiles.length === 1 ? 'this document' : 'these documents'}`}
            </button>
          </div>
        )}

        {/* Hidden file picker shared by every "attach" affordance. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.epub,application/pdf,text/plain,application/epub+zip"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addGenFiles(e.target.files)
            e.target.value = '' // let the same file be re-picked after removal
          }}
        />

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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (e.dataTransfer.files?.length) addGenFiles(e.dataTransfer.files)
          }}
          rows={2}
          placeholder="Ask Sprout to edit, ask about the tree, or attach a guideline to build one…"
          className="w-full resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <p className={`text-[10.5px] ${listening ? 'font-medium text-danger' : 'text-muted'}`}>
            {listening ? 'Listening — talk through the edit, then review and send' : 'Shift+Enter for a new line'}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach a guideline document (PDF, TXT, EPUB) to build a tree"
              aria-label="Attach a guideline document"
              className="grid h-8 w-8 place-items-center rounded-md border border-line text-muted transition-all hover:border-accent hover:bg-sky hover:text-accent"
            >
              <PaperclipIcon />
            </button>
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
              className="omari-grad omari-grad-hover rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-subtle transition-all hover:shadow-subtle active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
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
  onUndo,
  onRedraft,
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
  onUndo: () => void
  onRedraft: () => void
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
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-muted">
            {proposal.status === 'applied' && '✓ Applied to the canvas'}
            {proposal.status === 'undone' && '↩ Undone — reverted to before this change'}
            {proposal.status === 'dismissed' && 'Dismissed — nothing was changed'}
            {proposal.status === 'stale' && 'Stale — the canvas changed before this was applied'}
            {proposal.status === 'stopped' &&
              `Stopped — applied ${proposal.stepsApplied ?? 0} of ${proposal.ops.length} steps`}
          </p>
          {proposal.status === 'applied' && proposal.appliedJson && (
            <button
              onClick={onUndo}
              title="Put the tree back exactly as it was before this change"
              className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-danger/50 hover:bg-danger/5 hover:text-danger"
            >
              Undo
            </button>
          )}
          {(proposal.status === 'stale' || proposal.status === 'dismissed') && (
            <button
              onClick={onRedraft}
              title="Ask Sprout to draft this again against the tree as it is now"
              className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-accent hover:bg-sky hover:text-accent"
            >
              ↻ Redraft
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Generation card — a saved draft awaiting the clinician's open-on-canvas    */
/* -------------------------------------------------------------------------- */

/**
 * A document-to-tree generation, reviewed like every other Sprout proposal:
 * the draft is already saved to the library, but opening it on the canvas is
 * the clinician's explicit confirm. Placeholders and structural issues are
 * surfaced up front so "open it" is an informed decision, not a surprise.
 */
function GenerationCard({
  generation,
  onOpen,
  onDismiss,
}: {
  generation: Generation
  onOpen: () => void
  onDismiss: () => void
}) {
  return (
    <div className="omari-reveal mt-2 rounded-lg border border-accent/40 bg-canvas p-2.5">
      <p className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-strong">
        Draft tree ready
      </p>
      <p className="mt-1 text-[12.5px] font-medium leading-snug text-ink">{generation.treeName}</p>
      <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted">
        <li className="flex gap-1.5">
          <span className="shrink-0 opacity-60">•</span>
          <span>
            From {generation.fileNames.length === 1 ? generation.fileNames[0] : `${generation.fileNames.length} documents`}
          </span>
        </li>
        {generation.placeholderCount > 0 && (
          <li className="flex gap-1.5">
            <span className="shrink-0 opacity-60">•</span>
            <span>
              {generation.placeholderCount} specialist endpoint{generation.placeholderCount === 1 ? '' : 's'} to assign
            </span>
          </li>
        )}
        {generation.issueCount > 0 && (
          <li className="flex gap-1.5 text-amber-600">
            <span className="shrink-0 opacity-60">•</span>
            <span>
              {generation.issueCount} structural issue{generation.issueCount === 1 ? '' : 's'} to review
            </span>
          </li>
        )}
      </ul>
      {generation.status === 'ready' ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            onClick={onOpen}
            className="rounded-md bg-accent-strong px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Open in Builder
          </button>
          <button
            onClick={onDismiss}
            title="Leave it in the library without opening it"
            className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-bg hover:text-ink"
          >
            Not now
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] font-medium text-muted">
          {generation.status === 'opened' && '✓ Opened on the canvas'}
          {generation.status === 'dismissed' && 'Saved to your library — open it any time from the tree list'}
        </p>
      )}
    </div>
  )
}

/* ── Composer icon ───────────────────────────────────────────────────────── */

function PaperclipIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}
