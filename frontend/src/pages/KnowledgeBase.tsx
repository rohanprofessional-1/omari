import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { fetchClinics, fetchTrees, previewKnowledgeBase, type ClinicSummary, type KnowledgeBasePreviewResponse, type TreeSummary } from '../lib/api'

type UploadState = 'idle' | 'loading' | 'success' | 'error'

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

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(Array.from(event.target.files ?? []))
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

  const fileCountLabel = selectedFiles.length
    ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} selected`
    : 'No files selected yet'

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(31,36,33,0.05),_transparent_38%),linear-gradient(180deg,_#f8f7f3_0%,_#fbfbf8_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6 lg:px-8">
        <section className="rounded-3xl border border-line bg-canvas p-6 shadow-[0_18px_40px_rgba(18,24,40,0.08)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Clinic knowledge base</p>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink">
                Upload the docs that teach the intake LLM what this clinic actually treats.
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted">
                Select the clinic and routing tree, then upload PDFs or EPUBs. The backend trims the
                docs down to tree-relevant material so only diagnosis- and specialist-specific
                information is kept in the preview.
              </p>
            </div>
            <div className="rounded-2xl border border-accent-strong/15 bg-sky px-4 py-3 text-sm text-muted lg:max-w-sm">
              <span className="block font-medium text-ink">Supported now</span>
              <span>PDF, EPUB, plain text, and HTML. Large documents are chunked before extraction.</span>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4 rounded-3xl border border-line bg-canvas p-5 shadow-[0_14px_32px_rgba(18,24,40,0.06)]">
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">Upload settings</h2>
              <p className="mt-1 text-sm text-muted">Choose the clinic and tree that define what information matters.</p>
            </div>

            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Clinic</span>
              <select
                value={selectedClinicId}
                onChange={(event) => setSelectedClinicId(event.target.value)}
                className="w-full rounded-2xl border border-line bg-bg px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent-strong"
              >
                {clinics.length === 0 && <option value="">No clinics found</option>}
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Tree</span>
              <select
                value={selectedTreeId}
                onChange={(event) => setSelectedTreeId(event.target.value)}
                className="w-full rounded-2xl border border-line bg-bg px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-accent-strong"
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
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Files</span>
              <div className="rounded-3xl border border-dashed border-line bg-bg p-4">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.epub,.txt,.md,.html,.htm,application/pdf,application/epub+zip"
                  onChange={handleFiles}
                  className="block w-full text-sm text-muted file:mr-4 file:rounded-xl file:border-0 file:bg-accent-strong file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-accent"
                />
                <p className="mt-3 text-xs leading-5 text-muted">
                  Best for large surgical handbooks, journal chapters, or specialty manuals. Upload all
                  related sources together so the preview can merge them.
                </p>
              </div>
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-line bg-bg px-4 py-3">
              <div>
                <span className="block text-sm font-medium text-ink">Persist preview</span>
                <span className="block text-xs text-muted">Store the generated knowledge payload on the clinic record for now.</span>
              </div>
              <input
                type="checkbox"
                checked={persist}
                onChange={() => setPersist((value) => !value)}
                className="h-4 w-4 rounded border-line text-accent-strong focus:ring-accent-strong"
              />
            </label>

            <button
              onClick={handleUpload}
              disabled={status === 'loading' || !selectedFiles.length || !selectedTreeId || !selectedClinicId}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-accent-strong px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(33,74,149,0.22)] transition-all hover:-translate-y-[1px] hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'loading' ? 'Analyzing documents…' : 'Upload and extract knowledge'}
            </button>

            <div className="rounded-2xl border border-line bg-bg px-4 py-3 text-sm text-muted">
              <span className="block font-medium text-ink">{fileCountLabel}</span>
              <span className="block mt-1">{selectedClinic ? `Clinic: ${selectedClinic.name}` : 'Select a clinic.'}</span>
              <span className="block">{selectedTree ? `Tree: ${selectedTree.name}` : 'Select a tree.'}</span>
            </div>

            {error && (
              <div className="rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
                {error}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-line bg-canvas p-5 shadow-[0_14px_32px_rgba(18,24,40,0.06)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold text-ink">Preview</h2>
                  <p className="mt-1 text-sm text-muted">What the model extracted after focusing on the tree.</p>
                </div>
                {result && (
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${result.persisted ? 'bg-accent-strong/10 text-accent-strong' : 'bg-nodeesc/12 text-nodeesc'}`}>
                    {result.persisted ? 'Persisted' : 'Preview only'}
                  </span>
                )}
              </div>

              {result ? (
                <div className="mt-5 space-y-5">
                  <div className="rounded-2xl border border-sky bg-bg p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Overview</p>
                    <p className="mt-2 text-sm leading-6 text-ink">{result.overview}</p>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <SummaryList title="Focus terms" items={result.focus_terms} />
                    <SummaryList title="Files processed" items={result.files.map((file) => file.filename)} />
                  </div>

                  <div className="space-y-4">
                    {result.files.map((file) => (
                      <article key={file.filename} className="rounded-2xl border border-line bg-bg p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="font-medium text-ink">{file.filename}</h3>
                            <p className="text-xs text-muted">{file.file_type.toUpperCase()} · {file.text_length.toLocaleString()} chars scanned · {file.selected_chunk_count} focused chunk(s)</p>
                          </div>
                          {file.model_used && (
                            <span className="rounded-full bg-accent-strong/10 px-3 py-1 text-[11px] font-semibold text-accent-strong">{file.model_used}</span>
                          )}
                        </div>

                        <p className="mt-3 text-sm leading-6 text-ink">{file.summary}</p>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <SummaryList title="Relevant topics" items={file.relevant_topics} />
                          <SummaryList title="Specialist alignment" items={file.matched_specialists} />
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <SummaryList title="Diagnosis cues" items={file.matched_diagnoses} />
                          <SummaryList title="Key points" items={file.key_points} />
                        </div>

                        {file.evidence_quotes.length > 0 && (
                          <div className="mt-4 rounded-xl border border-line bg-canvas p-3 text-xs leading-5 text-muted">
                            <p className="mb-2 font-semibold uppercase tracking-[0.12em] text-ink">Evidence quotes</p>
                            <ul className="space-y-2">
                              {file.evidence_quotes.map((quote) => (
                                <li key={quote} className="rounded-lg bg-bg px-3 py-2">{quote}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState status={status} />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-line bg-canvas p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm text-ink">
          {items.map((item) => (
            <li key={item} className="rounded-lg bg-bg px-3 py-2 leading-5">{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No items extracted.</p>
      )}
    </div>
  )
}

function EmptyState({ status }: { status: UploadState }) {
  const text =
    status === 'loading'
      ? 'The backend is chunking the documents and narrowing them to tree-relevant content.'
      : 'Upload documents to see a tree-focused summary here.'

  return (
    <div className="grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-line bg-bg px-6 py-10 text-center">
      <div className="max-w-lg">
        <h3 className="font-display text-2xl font-semibold text-ink">No preview yet</h3>
        <p className="mt-3 text-sm leading-6 text-muted">{text}</p>
      </div>
    </div>
  )
}

export default KnowledgeBase