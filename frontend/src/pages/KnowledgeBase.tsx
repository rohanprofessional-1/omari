import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { fetchClinics, fetchTrees, previewKnowledgeBase, type ClinicSummary, type KnowledgeBasePreviewResponse, type TreeSummary } from '../lib/api'

/**
 * Omari — the clinic knowledge base: teach the intake model what this clinic
 * actually treats, by uploading the source documents.
 *
 * The screen is a single left-to-right sentence — SET UP (clinic, tree, files)
 * then READ (what the model pulled out) — so the left column is one uninterrupted
 * form and the right column is one uninterrupted result. Everything that used to
 * wrap a control in its own bordered box is gone: nesting a card inside a card
 * inside a card made three levels of chrome for one level of meaning, and the
 * eye had to re-enter a new container for every field.
 *
 * Lists are chips, not boxed rows. A caption plus wrapped chips says "these are
 * the terms" in one visual move; a bordered card per list, with a bordered row
 * per item, said it in three and buried the content.
 */

type UploadState = 'idle' | 'loading' | 'success' | 'error'

const ACCEPT = '.pdf,.epub,.txt,.md,.html,.htm,application/pdf,application/epub+zip'

function KnowledgeBase() {
  const [clinics, setClinics] = useState<ClinicSummary[]>([])
  const [trees, setTrees] = useState<TreeSummary[]>([])
  const [selectedClinicId, setSelectedClinicId] = useState('')
  const [selectedTreeId, setSelectedTreeId] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [persist, setPersist] = useState(true)
  const [status, setStatus] = useState<UploadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<KnowledgeBasePreviewResponse | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchClinics(), fetchTrees()])
      .then(([clinicList, treeList]) => {
        if (!active) return
        setClinics(clinicList)
        setTrees(treeList)
        const defaultClinic = clinicList[0]?.id ?? ''
        setSelectedClinicId(defaultClinic)
        const defaultTree =
          treeList.find((tree) => tree.clinic_id && tree.clinic_id === defaultClinic)?.id ??
          treeList[0]?.id ??
          ''
        setSelectedTreeId(defaultTree)
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load clinics and trees')
      })

    return () => {
      active = false
    }
  }, [])

  const selectedClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === selectedClinicId) ?? null,
    [clinics, selectedClinicId],
  )
  const selectedTree = useMemo(
    () => trees.find((tree) => tree.id === selectedTreeId) ?? null,
    [trees, selectedTreeId],
  )

  useEffect(() => {
    if (!selectedClinicId || !trees.length) return
    const matchingTree = trees.find((tree) => tree.clinic_id === selectedClinicId)
    if (matchingTree && matchingTree.id !== selectedTreeId) {
      setSelectedTreeId(matchingTree.id)
    }
  }, [selectedClinicId, selectedTreeId, trees])

  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return
    setSelectedFiles((prev) => [...prev, ...Array.from(incoming)])
  }

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    addFiles(event.dataTransfer.files)
  }

  const handleUpload = async () => {
    if (!selectedClinicId) {
      setError('Pick a clinic first.')
      return
    }
    if (!selectedTreeId) {
      setError('Pick a tree first.')
      return
    }
    if (!selectedFiles.length) {
      setError('Choose at least one PDF or EPUB file.')
      return
    }

    setStatus('loading')
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('tree_id', selectedTreeId)
      formData.append('persist', String(persist))
      for (const file of selectedFiles) {
        formData.append('files', file)
      }
      const response = await previewKnowledgeBase(selectedClinicId, formData)
      setResult(response)
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Knowledge-base upload failed')
    }
  }

  const ready = Boolean(selectedClinicId && selectedTreeId && selectedFiles.length)
  const hint = !selectedClinicId
    ? 'Pick a clinic to begin.'
    : !selectedTreeId
      ? 'Pick the tree that decides what matters.'
      : selectedFiles.length === 0
        ? 'Add at least one document.'
        : `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} · ${selectedClinic?.name ?? ''} · ${selectedTree?.name ?? ''}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Section header — the same object as every other section's header */}
      <div className="border-b border-line bg-canvas">
        <div className="flex w-full flex-wrap items-center gap-3 px-6 py-3">
          <div className="min-w-0">
            <h1 className="min-w-0 truncate text-heading-sm text-ink">Knowledge</h1>
            <p className="truncate text-meta text-muted">
              Teach the intake model what this clinic actually treats.
            </p>
          </div>
          {result && (
            <span className="ml-auto shrink-0 rounded-md bg-sky px-3 py-1 text-meta font-medium text-accent-strong">
              {result.persisted ? 'Saved to the clinic' : 'Preview only'}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-bg">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* ── Set up: one card, one column, no boxes inside boxes ───────── */}
          <div className="space-y-4 self-start lg:sticky lg:top-6">
            <div className="space-y-4 rounded-xl border border-line bg-canvas p-5 shadow-subtle">
              <Field label="Clinic">
                <select
                  value={selectedClinicId}
                  onChange={(event) => setSelectedClinicId(event.target.value)}
                  className={control}
                >
                  {clinics.length === 0 && <option value="">No clinics found</option>}
                  {clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Tree" hint="Decides which material counts as relevant.">
                <select
                  value={selectedTreeId}
                  onChange={(event) => setSelectedTreeId(event.target.value)}
                  className={control}
                >
                  {trees.length === 0 && <option value="">No trees found</option>}
                  {trees
                    .filter((tree) => !selectedClinicId || tree.clinic_id === selectedClinicId || !tree.clinic_id)
                    .map((tree) => (
                      <option key={tree.id} value={tree.id}>
                        {tree.name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="Documents">
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  className="relative rounded-md border border-dashed border-line px-4 py-5 text-center transition-colors hover:border-accent/50 hover:bg-sky/30"
                >
                  <p className="text-[13px] font-medium text-ink">Drop files here</p>
                  <p className="mt-1 text-meta text-muted">
                    or click to browse · PDF, EPUB, TXT, HTML
                  </p>
                  <input
                    type="file"
                    multiple
                    accept={ACCEPT}
                    onChange={handleFiles}
                    aria-label="Choose documents"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>

                {selectedFiles.length > 0 && (
                  <ul className="mt-2 divide-y divide-line">
                    {selectedFiles.map((file, i) => (
                      <li key={`${file.name}-${i}`} className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={file.name}>
                          {file.name}
                        </span>
                        <span className="shrink-0 text-meta tabular-nums text-muted">
                          {(file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        <button
                          onClick={() => setSelectedFiles((prev) => prev.filter((_, j) => j !== i))}
                          aria-label={`Remove ${file.name}`}
                          className="shrink-0 rounded-md px-1 text-meta text-muted transition-colors hover:text-danger"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Field>

              {/* Plain control row — a checkbox does not need a card */}
              <label className="flex cursor-pointer items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  checked={persist}
                  onChange={() => setPersist((value) => !value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent-strong"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">Save to the clinic</span>
                  <span className="block text-meta leading-snug text-muted">
                    Otherwise this run is a preview and nothing is stored.
                  </span>
                </span>
              </label>

              <div>
                <button
                  onClick={handleUpload}
                  disabled={status === 'loading' || !ready}
                  className="w-full rounded-md bg-accent-strong px-4 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#27508f] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {status === 'loading' ? 'Reading documents…' : 'Extract knowledge'}
                </button>
                <p className="mt-2 truncate text-center text-meta text-muted" title={hint}>
                  {hint}
                </p>
              </div>
            </div>

            {error && (
              <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
                {error}
              </p>
            )}
          </div>

          {/* ── Read: what the model pulled out ───────────────────────────── */}
          <div className="min-w-0">
            {result ? (
              <div className="space-y-4">
                <section className="rounded-xl border border-line bg-canvas p-5 shadow-subtle">
                  <Caption>Overview</Caption>
                  <p className="mt-2 text-body leading-6 text-ink">{result.overview}</p>
                  <div className="mt-4 border-t border-line pt-4">
                    <Chips label="Focus terms" items={result.focus_terms} />
                  </div>
                </section>

                {result.files.map((file) => (
                  <article
                    key={file.filename}
                    className="rounded-xl border border-line bg-canvas p-5 shadow-subtle"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="min-w-0 truncate text-body font-semibold text-ink">
                        {file.filename}
                      </h2>
                      <p className="text-meta tabular-nums text-muted">
                        {file.file_type.toUpperCase()} · {file.text_length.toLocaleString()} chars ·{' '}
                        {file.selected_chunk_count} focused chunk
                        {file.selected_chunk_count === 1 ? '' : 's'}
                        {file.model_used && ` · ${file.model_used}`}
                      </p>
                    </div>

                    <p className="mt-3 text-body leading-6 text-ink">{file.summary}</p>

                    <div className="mt-4 space-y-3 border-t border-line pt-4">
                      <Chips label="Relevant topics" items={file.relevant_topics} />
                      <Chips label="Specialist alignment" items={file.matched_specialists} />
                      <Chips label="Diagnosis cues" items={file.matched_diagnoses} />
                      <Chips label="Key points" items={file.key_points} />
                    </div>

                    {file.evidence_quotes.length > 0 && (
                      <div className="mt-4 border-t border-line pt-4">
                        <Caption>Evidence quotes</Caption>
                        <ul className="mt-2 space-y-2">
                          {file.evidence_quotes.map((quote) => (
                            <li
                              key={quote}
                              className="border-l-2 border-line pl-3 text-[13px] leading-6 text-muted"
                            >
                              {quote}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              /* No 400px dashed slab — an empty result is a sentence, not a room */
              <p className="px-6 py-16 text-center text-body text-muted">
                {status === 'loading'
                  ? 'Reading the documents and narrowing them to what the tree cares about…'
                  : 'Nothing extracted yet. Add documents on the left to see a tree-focused summary here.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── shared primitives ─────────────────────────── */

/** Resting input fill, pill radius, no border until focus — the system's input. */
const control =
  'w-full rounded-md border border-line bg-bg px-3 py-2 text-[13px] text-ink transition-colors hover:border-line focus:border-accent-strong focus:outline-none'

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-caption uppercase text-muted">{children}</p>
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <Caption>{label}</Caption>
      {hint && <p className="mb-1.5 mt-0.5 text-meta leading-snug text-muted">{hint}</p>}
      <div className={hint ? '' : 'mt-1.5'}>{children}</div>
    </div>
  )
}

/** A caption and its values as wrapped chips — one visual move, not three. */
function Chips({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
      <span className="w-40 shrink-0 text-caption uppercase text-muted">{label}</span>
      {items.length > 0 ? (
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className="rounded-md bg-bg px-2 py-0.5 text-meta leading-relaxed text-ink"
            >
              {item}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-meta text-muted">None found</span>
      )}
    </div>
  )
}

export default KnowledgeBase
