import type { ReactNode } from 'react'

/** Titled card wrapper — the dashboard's standard content block. */
export default function SectionCard({
  title,
  action,
  children,
  className = '',
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-dash-card border border-dash-line bg-dash-surface shadow-dash-card ${className}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-dash-line px-4 py-2">
        <h2 className="text-dash-micro font-semibold uppercase tracking-wide text-dash-muted">
          {title}
        </h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}
