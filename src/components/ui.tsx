import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-3xl border border-slate-200/70 bg-white p-6 shadow-card transition-all duration-300 ease-out ${
        onClick
          ? 'cursor-pointer hover:-translate-y-0.5 hover:border-slate-300/80 hover:shadow-soft active:translate-y-0'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function SectionHeader({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight text-blume-dark">
        {title}
      </h2>
      {action}
    </div>
  )
}

export function PrimaryButton({
  children,
  onClick,
  className = '',
  icon: Icon,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
  icon?: LucideIcon
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-blume px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 ease-out hover:bg-blume-dark hover:shadow-soft active:scale-[0.98] ${className}`}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  )
}

export function SecondaryButton({
  children,
  onClick,
  className = '',
  icon: Icon,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
  icon?: LucideIcon
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all duration-200 ease-out hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] ${className}`}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  )
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'info'
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-slate-100 text-slate-600 ring-slate-200/70',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    warning: 'bg-amber-50 text-amber-700 ring-amber-100',
    info: 'bg-blume-mist text-blume ring-blume-light/30',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function PageHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-8">
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-blume-dark">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate-500">
          {subtitle}
        </p>
      )}
    </div>
  )
}
