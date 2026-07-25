/**
 * Shared chrome for the dashboard's FLAT data tables — the clinic directory
 * and the tree library. One header idiom with the queue and the tier bands:
 * a tinted 36px band in 11px uppercase meta, hairline rows beneath it, and a
 * card whose border is strong enough to read as the table's edge.
 *
 * Grouped worklists use SectionBand instead; these are the tables that have
 * exactly one section and so need no dot, count or explainer.
 */

export const TABLE_CARD =
  'rounded-dash-card border border-dash-line-strong bg-dash-surface shadow-dash-card'

/**
 * Pins to the screen's scroll container. Deliberately NOT paired with
 * `overflow-hidden` on TABLE_CARD — that would make the card its own scroll
 * container and the header would stop sticking.
 */
export const TABLE_HEAD =
  'sticky top-0 z-10 h-9 rounded-t-dash-card border-b border-dash-line-strong bg-dash-header px-4 text-dash-col uppercase text-dash-muted'

export const TABLE_ROW = 'border-b border-dash-line px-4 py-3 last:border-b-0'
