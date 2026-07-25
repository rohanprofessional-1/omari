import type { ReactNode } from 'react'
import type { SourceChannel } from '../../types'
import Badge, { type BadgeTone } from './Badge'

/** How the referral arrived: Epic (in-network EHR), fax, or phone. */

const TONES: Record<SourceChannel, BadgeTone> = {
  epic: 'accent',
  fax: 'neutral',
  phone: 'neutral',
}

const LABELS: Record<SourceChannel, string> = {
  epic: 'Epic',
  fax: 'Fax',
  phone: 'Phone',
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const ICONS: Record<SourceChannel, ReactNode> = {
  // Epic — EHR monitor
  epic: (
    <Svg>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4M7 9h6M7 12.5h9" />
    </Svg>
  ),
  // Fax — printer
  fax: (
    <Svg>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 17v4h10v-4" />
    </Svg>
  ),
  // Phone — handset
  phone: (
    <Svg>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </Svg>
  ),
}

export default function ChannelBadge({ channel }: { channel: SourceChannel }) {
  return (
    <Badge tone={TONES[channel]} title={`Received via ${LABELS[channel]}`}>
      {ICONS[channel]}
      {LABELS[channel]}
    </Badge>
  )
}

/**
 * Chip-less variant for dense table rows. Channel is context, not status —
 * in a 60-row list a tinted chip on every row reads as decoration, so the
 * icon + label carry it in plain meta text instead.
 */
export function ChannelMark({ channel }: { channel: SourceChannel }) {
  return (
    <span
      className="flex items-center gap-1 text-dash-micro text-dash-muted"
      title={`Received via ${LABELS[channel]}`}
    >
      {ICONS[channel]}
      {LABELS[channel]}
    </span>
  )
}
