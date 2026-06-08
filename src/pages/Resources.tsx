import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Clock,
  ArrowRight,
  PlayCircle,
  Bookmark,
} from 'lucide-react'
import { Card, PageHeader, Pill } from '../components/ui'
import { useToast } from '../components/Toast'

const categories = ['All', 'Your condition', 'Tests & prep', 'Treatment'] as const
type Category = (typeof categories)[number]

type Article = {
  title: string
  blurb: string
  category: Exclude<Category, 'All'>
  read: string
  tone: string
}

const featured = {
  title: 'Understanding Cervical Radiculopathy',
  blurb:
    'When a nerve in your neck is compressed, it can cause numbness, tingling, or weakness down your arm. Here\'s what\'s happening and why.',
  read: '5 min read',
}

const articles: Article[] = [
  {
    title: 'What to Expect During an EMG',
    blurb:
      'A step-by-step look at your nerve conduction study — what it measures, how it feels, and how to prepare.',
    category: 'Tests & prep',
    read: '4 min read',
    tone: 'bg-violet-50 text-violet-600',
  },
  {
    title: 'MRI 101: Your Imaging Visit',
    blurb:
      'What the scan shows your care team, what to wear, and how to stay comfortable during your appointment.',
    category: 'Tests & prep',
    read: '3 min read',
    tone: 'bg-cyan-50 text-cyan-600',
  },
  {
    title: 'Surgery vs. Conservative Care',
    blurb:
      'Many nerve issues improve without surgery. Understand the options your specialist may discuss with you.',
    category: 'Treatment',
    read: '6 min read',
    tone: 'bg-amber-50 text-amber-600',
  },
  {
    title: 'Gentle Exercises to Relieve Nerve Pressure',
    blurb:
      'Simple, doctor-approved stretches that may ease symptoms while you wait for your evaluation.',
    category: 'Your condition',
    read: '4 min read',
    tone: 'bg-emerald-50 text-emerald-600',
  },
  {
    title: 'Questions to Ask Your Surgeon',
    blurb:
      'A printable checklist to help you make the most of your surgical evaluation visit.',
    category: 'Treatment',
    read: '2 min read',
    tone: 'bg-blume-mist text-blume',
  },
]

export default function Resources() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [active, setActive] = useState<Category>('All')

  const visible = articles.filter(
    (a) => active === 'All' || a.category === active,
  )

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 transition-colors duration-200 hover:text-blume-dark"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <PageHeader
        title="Educational Resources"
        subtitle="Trusted, plain-language guides chosen for your condition."
      />

      {/* Featured */}
      <Card
        onClick={() => showToast(`Opening “${featured.title}”…`, 'info')}
        className="bg-blume-cloud"
      >
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-blume shadow-sm">
            <BookOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <Pill tone="info">Recommended for you</Pill>
            <h2 className="mt-2.5 text-lg font-semibold tracking-tight text-blume-dark">
              {featured.title}
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">
              {featured.blurb}
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-blume">
              <PlayCircle className="h-4 w-4" /> Read now
              <span className="font-normal text-slate-400">· {featured.read}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Category filters */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setActive(c)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all duration-200 ${
              active === c
                ? 'bg-blume text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Article list */}
      <div className="grid gap-3 md:grid-cols-2">
        {visible.length === 0 && (
          <Card className="py-10 text-center md:col-span-2">
            <BookOpen className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-400">
              No articles in this category yet
            </p>
          </Card>
        )}
        {visible.map((a) => (
          <Card
            key={a.title}
            onClick={() => showToast(`Opening “${a.title}”…`, 'info')}
            className="flex gap-3.5 p-5"
          >
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${a.tone}`}
            >
              <BookOpen className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-blume-dark">
                {a.title}
              </p>
              <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-slate-500">
                {a.blurb}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
                  <Clock className="h-3.5 w-3.5" /> {a.read}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blume">
                  Read <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <button
        onClick={() => showToast('Saved articles — coming soon.', 'info')}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
      >
        <Bookmark className="h-4 w-4" /> View saved articles
      </button>
    </div>
  )
}
