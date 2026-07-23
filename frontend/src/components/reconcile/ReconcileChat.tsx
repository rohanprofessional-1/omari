import { useRef, useState } from 'react'
import type { Tree } from '../../types/tree'
import { describeDelta } from '../../lib/deltas/describe'
import { repairProposedDeltas } from '../../lib/deltas/repairAnchors'
import { DeltaSchema, type DeltaOp } from '../../lib/deltas/schema'

/**
 * Blume — Sprout in the Reconcile session (the freeform escape hatch).
 *
 * For clinic logic no review stage covers ("add a BMI check before the
 * bariatric referral"). Sprout proposes DELTAS — semantically anchored, so
 * chat-authored changes survive guideline updates exactly like every other
 * clinic decision. Propose → review sentences → confirm; nothing applies
 * without the surgeon's click.
 */

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export default function ReconcileChat({
  tree,
  busy,
  onApply,
}: {
  tree: Tree
  busy: boolean
  onApply: (payloads: DeltaOp[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [proposal, setProposal] = useState<{ payloads: DeltaOp[]; errors: string[] } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const send = async () => {
    const message = draft.trim()
    if (!message || sending) return
    setDraft('')
    setProposal(null)
    const history = turns
    setTurns((t) => [...t, { role: 'user', content: message }])
    setSending(true)
    try {
      const res = await fetch('/api/v1/assistant/delta-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tree, message, history }),
      })
      if (!res.ok) throw new Error(await res.text())
      const out: { mode: string; message: string; deltas: unknown[] } = await res.json()
      setTurns((t) => [...t, { role: 'assistant', content: out.message }])
      if (out.mode === 'propose' && out.deltas.length > 0) {
        setProposal(repairProposedDeltas(tree, out.deltas))
      }
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', content: `Something went wrong: ${e instanceof Error ? e.message : e}` }])
    } finally {
      setSending(false)
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 99999 }))
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-[320px] z-20 rounded-full bg-accent-strong px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg"
      >
        Ask Sprout
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-[320px] z-20 flex h-[440px] w-[360px] flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <div>
          <h3 className="text-[13px] font-semibold text-ink">Sprout</h3>
          <p className="text-[10.5px] text-muted">Tell me a clinic rule — I'll draft it, you confirm.</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-[13px] text-muted hover:text-ink">
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
        {turns.length === 0 && (
          <p className="text-[12px] leading-relaxed text-muted">
            e.g. “Patients with prior surgery on this pathway should be reviewed by a human first”, or “add a
            BMI question before the bariatric referral — under 35 continues, 35 and over escalates.”
          </p>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] leading-snug ${
              t.role === 'user' ? 'ml-auto bg-accent-strong text-white' : 'bg-bg text-ink'
            }`}
          >
            {t.content}
          </div>
        ))}

        {proposal && (
          <div className="rounded-lg border border-line bg-bg p-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Proposed changes</p>
            <ul className="mt-1.5 space-y-1">
              {proposal.payloads.map((p, i) => (
                <li key={i} className="text-[12px] leading-snug text-ink">
                  · {describeDelta(DeltaSchema.parse({ id: `p${i}`, seq: i, payload: p, provenance: {} }))}
                </li>
              ))}
            </ul>
            {proposal.errors.map((e, i) => (
              <p key={i} className="mt-1 text-[11.5px] text-danger">
                Couldn't draft: {e}
              </p>
            ))}
            {proposal.payloads.length > 0 && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    onApply(proposal.payloads)
                    setProposal(null)
                    setTurns((t) => [...t, { role: 'assistant', content: "Applied — it's in the decision rail with everything else." }])
                  }}
                  disabled={busy}
                  className="rounded-md bg-accent-strong px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
                >
                  Apply {proposal.payloads.length === 1 ? 'it' : `all ${proposal.payloads.length}`}
                </button>
                <button onClick={() => setProposal(null)} className="text-[12px] text-muted hover:text-ink">
                  discard
                </button>
              </div>
            )}
          </div>
        )}
        {sending && <p className="text-[12px] text-muted">Thinking…</p>}
      </div>

      <div className="border-t border-line p-2.5">
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-ink placeholder:text-muted/60"
            placeholder="Describe the clinic rule…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className="rounded-md bg-accent-strong px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
