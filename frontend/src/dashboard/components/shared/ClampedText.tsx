import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Long clinical prose, clamped to a few lines with an inline expander.
 *
 * The dashboard never hides information — it defers it. The toggle appears
 * ONLY when the text actually overflows (measured, not guessed from length),
 * so short reasons don't grow a pointless "Show more". Clicks are stopped from
 * reaching the surrounding card, which navigates on click.
 */

const CLAMP: Record<number, string> = {
  2: 'line-clamp-2',
  3: 'line-clamp-3',
  4: 'line-clamp-4',
}

export default function ClampedText({
  text,
  lines = 2,
  className = '',
}: {
  text: string
  /** How many lines to show collapsed. */
  lines?: 2 | 3 | 4
  className?: string
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  // Measure only while collapsed: expanded, scrollHeight === clientHeight by
  // definition, and re-measuring would hide the "Show less" toggle.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, lines, expanded])

  return (
    <>
      <p ref={ref} className={`${expanded ? '' : CLAMP[lines]} ${className}`}>
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          aria-expanded={expanded}
          className="mt-1 rounded-dash-ctl text-dash-micro font-medium text-dash-accent transition-colors hover:text-dash-accent-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}
