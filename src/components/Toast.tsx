import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, Info, X } from 'lucide-react'

type ToastVariant = 'success' | 'info'

type Toast = {
  id: number
  message: string
  variant: ToastVariant
}

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev, { id, message, variant }])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 3200)
    },
    [],
  )

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id))

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-toast-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-blume-dark px-4 py-3 text-white shadow-soft"
          >
            {t.variant === 'success' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-blume-light" />
            ) : (
              <Info className="h-5 w-5 shrink-0 text-blume-light" />
            )}
            <span className="flex-1 text-sm font-medium leading-snug">
              {t.message}
            </span>
            <button
              onClick={() => dismiss(t.id)}
              className="rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
