import { Loader2 } from 'lucide-react'
import Logo from './Logo'

export default function Splash() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-blume-dark to-blume text-white">
      <div className="animate-fade-up flex flex-col items-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/10 backdrop-blur-sm">
          <Logo className="h-12 w-12" dark="#ffffff" />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Blume</h1>
        <p className="mt-1 text-sm font-medium text-blume-light">
          Your virtual front desk
        </p>
        <Loader2 className="mt-8 h-5 w-5 animate-spin text-blume-light" />
      </div>
    </div>
  )
}
