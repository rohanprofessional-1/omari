import { useState } from 'react'
import {
  FileText,
  Stethoscope,
  Activity,
  ScanLine,
  ClipboardList,
  Map as MapIcon,
  Download,
  Eye,
  Search,
  UploadCloud,
  Loader2,
  FileCheck2,
  X,
  Lock,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, PageHeader, Pill, SectionHeader } from '../components/ui'
import { useToast } from '../components/Toast'

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

const filters = ['All', 'Records', 'Results', 'Instructions'] as const
type Filter = (typeof filters)[number]

type Doc = {
  name: string
  category: Exclude<Filter, 'All'>
  kind: string
  date: string
  size: string
  pages: number
  icon: LucideIcon
  accent: string
  isNew?: boolean
}

const docs: Doc[] = [
  {
    name: 'Referral Note',
    category: 'Records',
    kind: 'PDF · from Dr. Lin',
    date: 'May 28, 2026',
    size: '180 KB',
    pages: 2,
    icon: Stethoscope,
    accent: 'bg-blume-mist text-blume',
  },
  {
    name: 'EMG Report',
    category: 'Results',
    kind: 'PDF · Neurodiagnostics',
    date: 'Jun 9, 2026',
    size: '320 KB',
    pages: 4,
    icon: Activity,
    accent: 'bg-violet-50 text-violet-600',
    isNew: true,
  },
  {
    name: 'MRI Order',
    category: 'Records',
    kind: 'PDF · Imaging requisition',
    date: 'Jun 9, 2026',
    size: '96 KB',
    pages: 1,
    icon: ScanLine,
    accent: 'bg-cyan-50 text-cyan-600',
    isNew: true,
  },
  {
    name: 'Pre-op Instructions',
    category: 'Instructions',
    kind: 'PDF · Surgical prep',
    date: 'Jun 12, 2026',
    size: '210 KB',
    pages: 3,
    icon: ClipboardList,
    accent: 'bg-amber-50 text-amber-600',
  },
  {
    name: 'Care Itinerary',
    category: 'Instructions',
    kind: 'PDF · Your full plan',
    date: 'Jun 12, 2026',
    size: '1.1 MB',
    pages: 6,
    icon: MapIcon,
    accent: 'bg-emerald-50 text-emerald-600',
  },
]

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Documents() {
  const { showToast } = useToast()
  const [active, setActive] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done'>(
    'idle',
  )
  const [dragging, setDragging] = useState(false)

  const visible = docs.filter(
    (d) =>
      (active === 'All' || d.category === active) &&
      d.name.toLowerCase().includes(query.toLowerCase()),
  )

  const simulateUpload = () => {
    if (uploadState === 'uploading') return
    setDragging(false)
    setUploadState('uploading')
    window.setTimeout(() => {
      setUploadState('done')
      showToast('Document uploaded securely ✓')
    }, 1400)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        subtitle="Your secure vault — records, results, and instructions in one place."
      />

      {/* Toolbar: search + vault status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 transition-colors duration-200 focus-within:border-blume-light">
          <Search className="h-[18px] w-[18px] text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents"
            className="w-full bg-transparent text-sm text-blume-dark outline-none placeholder:text-slate-400"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="rounded-full p-1 text-slate-300 transition-colors hover:text-slate-500"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-400">
          <Lock className="h-3.5 w-3.5" /> Private &amp; encrypted · {docs.length}{' '}
          files
        </span>
      </div>

      {/* Filters */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setActive(f)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all duration-200 ${
              active === f
                ? 'bg-blume text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Document list */}
      {visible.length === 0 ? (
        <Card className="py-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-400">
            No documents match “{query}”
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((doc) => (
            <Card key={doc.name} className="flex items-center gap-3.5 p-4">
            <span
              className={`relative flex h-12 w-11 shrink-0 items-center justify-center rounded-xl ${doc.accent}`}
            >
              <doc.icon className="h-5 w-5" />
              <span className="absolute -bottom-1.5 rounded-md bg-white px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400 shadow-sm">
                PDF
              </span>
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[14px] font-semibold text-blume-dark">
                  {doc.name}
                </p>
                {doc.isNew && <Pill tone="success">New</Pill>}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {doc.kind}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {doc.date} · {doc.pages} pages · {doc.size}
              </p>
            </div>

            <div className="flex shrink-0 gap-0.5">
              <button
                onClick={() => showToast(`Opening “${doc.name}”…`, 'info')}
                className="rounded-lg p-2 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-blume"
                aria-label={`View ${doc.name}`}
              >
                <Eye className="h-[18px] w-[18px]" />
              </button>
              <button
                onClick={() => showToast(`“${doc.name}” downloaded.`)}
                className="rounded-lg p-2 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-blume"
                aria-label={`Download ${doc.name}`}
              >
                <Download className="h-[18px] w-[18px]" />
              </button>
            </div>
          </Card>
          ))}
        </div>
      )}

      {/* Upload zone */}
      <div>
        <SectionHeader title="Add a document" />

        {uploadState === 'done' ? (
          <div className="flex items-center gap-3.5 rounded-2xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white">
              <FileCheck2 className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-emerald-800">
                insurance-card.jpg
              </p>
              <p className="text-xs font-medium text-emerald-600">
                Uploaded ✓ · 640 KB · just now
              </p>
            </div>
            <button
              onClick={() => setUploadState('idle')}
              className="rounded-lg p-2 text-emerald-700 transition-colors hover:bg-emerald-100"
              aria-label="Remove upload"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        ) : (
          <button
            onClick={simulateUpload}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              simulateUpload()
            }}
            disabled={uploadState === 'uploading'}
            className={`flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition-all duration-300 ${
              dragging
                ? 'border-blume bg-blume-mist'
                : 'border-slate-300 bg-white hover:border-blume-light hover:bg-blume-cloud'
            }`}
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
                  : dragging
                    ? 'Drop to upload'
                    : 'Drag & drop a file here'}
              </p>
              <p className="mt-1 text-[13px] text-slate-400">
                {uploadState === 'uploading'
                  ? 'Encrypting your document'
                  : 'or click to browse · PDF, JPG, PNG up to 25 MB'}
              </p>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}
