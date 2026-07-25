import type { ReactNode } from 'react'

/**
 * The dashboard's ONE grouping header: a tinted band that sits at the top of a
 * white card and unambiguously marks where a group starts. Queue tiers,
 * surgeon sections and workup strata all use it, so "one grouping" always
 * looks the same: 6px status dot · uppercase label · count pill · optional
 * one-line explainer · optional controls on the right.
 *
 * The band is the ONLY place a tier is named. Rows below it carry no group
 * chrome of their own beyond the 2px left rail.
 */

export type BandTone = 'green' | 'amber' | 'slate' | 'red' | 'accent' | 'neutral'

const DOTS: Record<BandTone, string> = {
  green: 'bg-dash-green',
  amber: 'bg-dash-amber',
  slate: 'bg-dash-slate',
  red: 'bg-dash-red',
  accent: 'bg-dash-accent',
  neutral: 'bg-dash-faint',
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 text-dash-faint transition-transform motion-reduce:transition-none ${
        open ? 'rotate-90' : ''
      }`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

export default function SectionBand({
  tone = 'neutral',
  label,
  count,
  hint,
  controls,
  open,
  onToggle,
  /** Pins the band to the scroll container. `top` is the offset in px. */
  stickyTop,
}: {
  tone?: BandTone
  label: string
  count: number
  hint?: string
  controls?: ReactNode
  open?: boolean
  onToggle?: () => void
  stickyTop?: number
}) {
  const heading = (
    <>
      {onToggle && <Chevron open={open !== false} />}
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[tone]}`} />
      <h3 className="whitespace-nowrap text-dash-col uppercase text-dash-ink">{label}</h3>
      <span className="rounded-full border border-dash-line-strong bg-dash-surface px-1.5 py-px text-dash-micro font-semibold leading-tight tabular-nums text-dash-strong">
        {count}
      </span>
    </>
  )

  return (
    <header
      style={stickyTop === undefined ? undefined : { top: stickyTop }}
      className={`flex h-9 items-center gap-2 rounded-t-dash-card border-b border-dash-line-strong bg-dash-header px-4 ${
        stickyTop === undefined ? '' : 'sticky z-10'
      }`}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open !== false}
          className="flex min-w-0 items-center gap-2 rounded-dash-ctl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-accent"
        >
          {heading}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-2">{heading}</span>
      )}

      {/* Never `hidden … lg:block`: dashboard.css is its own Tailwind root, so
          `hidden` from one root outranks a responsive `block` from the other
          and the hint silently disappears at every width. Truncate instead. */}
      {hint && <p className="min-w-0 truncate text-dash-micro text-dash-muted">{hint}</p>}

      {controls && <div className="ml-auto flex shrink-0 items-center gap-3">{controls}</div>}
    </header>
  )
}
