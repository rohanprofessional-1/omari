import { useState, type ReactNode } from 'react'
import { createTreeFull, fetchSpecialists } from '../lib/api'
import {
  createGenSession,
  patchGenSession,
  generateCPGScaffold,
  type CPGBaseMeta,
  type GenRosterEntry,
} from '../lib/genApi'

/**
 * Blume — the CPG-to-Scaffold GENERATOR wizard.
 *
 * Takes a subspecialty, a roster of specialists, and one or more CPG files (PDF/TXT),
 * uploads them sequentially to the backend to build a unified tree, stores the raw
 * scaffold as the tree's delta-layer BASE, and drops the user into the Reconcile
 * session to map it onto the clinic.
 */

export default function Generate({
  onOpenReconcile,
}: {
  onOpenReconcile: () => void
}) {
  const [subspecialty, setSubspecialty] = useState('Peripheral nerve surgery')
  const [surgeonName, setSurgeonName] = useState('')
  const [roster, setRoster] = useState<GenRosterEntry[]>([{ name: '', specialty: '' }])
  const [loadingDirectory, setLoadingDirectory] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setRosterAt = (i: number, patch: Partial<GenRosterEntry>) =>
    setRoster((r) => r.map((e, j) => (j === i ? { ...e, ...patch } : e)))

  const filledRoster = roster.filter((r) => r.name.trim())
  const canStart = subspecialty.trim().length > 0 && files.length > 0
  const startHint = !subspecialty.trim()
    ? 'Name the subspecialty to begin.'
    : files.length === 0
      ? 'Upload at least one CPG file to begin.'
      : null

  const loadDirectory = async () => {
    setLoadingDirectory(true)
    try {
      const specialists: any[] = await fetchSpecialists()
      const active = specialists.filter((s) => s.is_active !== false)
      if (active.length > 0) {
        setRoster(active.map((s) => ({ name: s.name, specialty: s.specialty ?? '' })))
        setError(null)
      } else {
        setError('No specialists in the directory yet — add your roster below.')
      }
    } catch {
      setError('Could not load the specialist directory.')
    } finally {
      setLoadingDirectory(false)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files)
      setFiles((prev) => [...prev, ...droppedFiles])
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const start = async () => {
    if (!canStart) return
    setError(null)
    
    try {
      setBusy('Creating generation session…')
      const newSession = await createGenSession({
        subspecialty: subspecialty.trim(),
        surgeonName: surgeonName.trim() || undefined,
        roster: filledRoster,
      })

      let latestTree = null
      const baseMetas: CPGBaseMeta[] = []

      // Sequentially upload CPGs
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setBusy(`Extracting logic from ${file.name} (${i + 1} of ${files.length})… This takes about 30 seconds.`)
        const result = await generateCPGScaffold(newSession.id, file)
        latestTree = result.tree
        if (result.baseMeta) baseMetas.push(result.baseMeta)
      }

      if (!latestTree) {
        throw new Error("Failed to generate a tree from the provided files.")
      }

      setBusy('Saving tree to your library…')
      const treeName = files.length === 1
        ? `${files[0].name.replace(/\.[^/.]+$/, "")} (CPG draft)`
        : `${newSession.subspecialty} (CPG draft)`

      const summary = await createTreeFull(
        treeName,
        latestTree,
        {
          description: `Generated from ${files.map(f => f.name).join(', ')} in session ${newSession.id}`,
          // Delta layer: the raw scaffold is the BASE clinic deltas replay onto.
          baseTree: latestTree,
          baseMeta: baseMetas.length === 1 ? baseMetas[0] : baseMetas.length > 1 ? { docs: baseMetas } : undefined,
        },
      )

      await patchGenSession(newSession.id, { treeId: summary.id, stage: 'done', status: 'completed' })

      // Handoff to the Reconcile session (Builder stays reachable for viewing)
      localStorage.setItem('omari:builderOpenTreeId', summary.id)
      localStorage.setItem('omari:activeTreeId', summary.id)
      localStorage.setItem('omari:reconcileTreeId', summary.id)
      onOpenReconcile()
      
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const input =
    'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/60 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent-strong/15'

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-6">
          <p className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-strong">
            Tree generator
          </p>
          <h1 className="font-serif text-[22px] font-semibold text-ink">
            Generate from Guidelines
          </h1>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
            {error}
            <button className="ml-3 underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        )}
        {busy && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-muted">
            <Spinner /> {busy}
          </div>
        )}

        <div className="space-y-5">
          {/* 1 · Session basics */}
          <SetupSection step={1} title="Your session">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">Subspecialty</span>
                <input className={input} value={subspecialty} onChange={(e) => setSubspecialty(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">Authoring surgeon</span>
                <input
                  className={input}
                  placeholder="Your name"
                  value={surgeonName}
                  onChange={(e) => setSurgeonName(e.target.value)}
                />
              </label>
            </div>
          </SetupSection>

          {/* 2 · The roster */}
          <SetupSection
            step={2}
            title="Specialist Roster (Optional)"
            why="While the AI generates placeholder endpoints, defining your clinic's actual roster now makes it easier to wire up the real specialists in the Builder."
          >
            <button
              onClick={loadDirectory}
              disabled={loadingDirectory}
              className="mb-3 w-full rounded-md border border-accent-strong/50 bg-sky px-3 py-2 text-[13px] font-semibold text-accent-strong transition-colors hover:border-accent-strong hover:bg-sky/70 disabled:opacity-60"
            >
              {loadingDirectory ? 'Loading your directory…' : 'Load from your directory'}
            </button>

            <div className="space-y-2">
              {roster.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={input}
                    placeholder="Specialist name"
                    value={r.name}
                    onChange={(e) => setRosterAt(i, { name: e.target.value })}
                  />
                  <input
                    className={input}
                    placeholder="Focus (e.g. entrapment / plexus / tumor)"
                    value={r.specialty}
                    onChange={(e) => setRosterAt(i, { specialty: e.target.value })}
                  />
                  <button
                    onClick={() =>
                      setRoster((rr) => (rr.length > 1 ? rr.filter((_, j) => j !== i) : [{ name: '', specialty: '' }]))
                    }
                    className="shrink-0 rounded px-2 text-[12px] text-muted hover:bg-danger/10 hover:text-danger"
                    aria-label="Remove specialist"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setRoster((r) => [...r, { name: '', specialty: '' }])}
              className="mt-2 rounded-md border border-dashed border-line px-2.5 py-1 text-[12px] font-medium text-muted hover:border-accent/50 hover:text-accent-strong"
            >
              + Add another specialist
            </button>
          </SetupSection>

          {/* 3 · CPG Upload */}
          <SetupSection step={3} title="Clinical Practice Guidelines">
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              Upload one or more CPG documents (PDF, TXT, EPUB). The AI will extract the decision logic 
              from all documents and merge them into a single, unified draft tree.
            </p>
            
            <div 
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="relative rounded-lg border-2 border-dashed border-line/70 bg-canvas/50 px-6 py-8 text-center transition-colors hover:border-accent/50 hover:bg-sky/20"
            >
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                <span className="text-xl text-accent-strong">📄</span>
              </div>
              <p className="text-[13px] font-medium text-ink">Drag and drop CPG files here</p>
              <p className="mt-1 text-[11.5px] text-muted">or click to browse</p>
              
              <input 
                type="file" 
                multiple
                accept=".pdf,.txt,.epub"
                className="absolute inset-0 z-50 h-full w-full cursor-pointer opacity-0"
                onChange={(e) => {
                  if (e.target.files) {
                    setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
                  }
                }}
              />
            </div>

            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">
                  Queued for generation ({files.length})
                </p>
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-[13px] text-ink">{f.name}</span>
                      <span className="text-[11px] text-muted">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    <button 
                      onClick={() => removeFile(i)}
                      className="shrink-0 p-1 text-[11px] text-muted hover:text-danger"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SetupSection>

          {/* Expectations + the gated CTA */}
          <div className="rounded-xl border border-line bg-canvas p-4 shadow-[0_1px_2px_rgba(24,20,16,0.05)]">
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
              We will extract exactly what the guidelines say—no invented thresholds or unauthorized routing.
              You will map the resulting tree onto your clinic in the Reconcile session.
            </p>
            <button
              onClick={start}
              disabled={!canStart || busy !== null}
              className="w-full rounded-md bg-accent-strong px-3 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#373734] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Generate Scaffold →
            </button>
            {startHint && <p className="mt-2 text-center text-[11.5px] text-muted">{startHint}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── shared primitives ─────────────────────────── */

function SetupSection({
  step,
  title,
  why,
  children,
}: {
  step: number
  title: string
  why?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-line bg-canvas p-5 shadow-[0_1px_2px_rgba(24,20,16,0.05)]">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-strong/10 font-display text-[11px] font-semibold text-accent-strong">
          {step}
        </span>
        <h2 className="font-display text-[14px] font-semibold text-ink">{title}</h2>
      </div>
      {why && <p className="mb-3 ml-7 text-[12px] leading-snug text-muted">{why}</p>}
      <div className={`ml-7 ${why ? '' : 'mt-2.5'}`}>{children}</div>
    </section>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-strong border-t-transparent"
      aria-hidden
    />
  )
}
