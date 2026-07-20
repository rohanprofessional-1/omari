import * as React from 'react'
import { motion, useMotionValue, useSpring, type SpringOptions } from 'motion/react'

/**
 * Animated "gooey" blob background (metaballs via an SVG goo filter + blur).
 * Adapted for this Vite + React 18 project:
 *  - dropped the Next.js "use client" directive and the React-19 ref-as-prop,
 *  - replaced cn / "@/lib/utils" with a tiny local class joiner,
 *  - CSS colour vars are scoped to the container (no global :root leak),
 *  - recoloured to a muted ink-blue palette and uses a transparent base so it
 *    layers cleanly behind dark text (the parent supplies the light backdrop).
 */

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ')

type BubbleColors = {
  first: string
  second: string
  third: string
  fourth: string
  fifth: string
  sixth: string
}

export type BubbleBackgroundProps = React.ComponentProps<'div'> & {
  interactive?: boolean
  transition?: SpringOptions
  colors?: BubbleColors
}

// Muted ink-blue wash (R,G,B) so it stays on-brand and calm on parchment.
const INK_WASH: BubbleColors = {
  first: '32,94,166', // ink blue
  second: '67,133,190', // wash blue
  third: '169,200,232', // faded wash
  fourth: '220,231,242', // powder wash
  fifth: '255,255,255', // white
  sixth: '84,105,177', // muted indigo (interactive blob)
}

export function BubbleBackground({
  className,
  children,
  interactive = false,
  transition = { stiffness: 100, damping: 20 },
  colors = INK_WASH,
  style,
  ...props
}: BubbleBackgroundProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)

  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const springX = useSpring(mouseX, transition)
  const springY = useSpring(mouseY, transition)

  const rectRef = React.useRef<DOMRect | null>(null)
  const rafIdRef = React.useRef<number | null>(null)

  React.useLayoutEffect(() => {
    const updateRect = () => {
      if (containerRef.current) rectRef.current = containerRef.current.getBoundingClientRect()
    }
    updateRect()
    const el = containerRef.current
    const ro = new ResizeObserver(updateRect)
    if (el) ro.observe(el)
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, { passive: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect)
    }
  }, [])

  React.useEffect(() => {
    if (!interactive) return
    const el = containerRef.current
    if (!el) return
    const handleMouseMove = (e: MouseEvent) => {
      const rect = rectRef.current
      if (!rect) return
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(() => {
        mouseX.set(e.clientX - centerX)
        mouseY.set(e.clientY - centerY)
      })
    }
    el.addEventListener('mousemove', handleMouseMove as EventListener, { passive: true })
    return () => {
      el.removeEventListener('mousemove', handleMouseMove as EventListener)
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [interactive, mouseX, mouseY])

  const cssVars = {
    '--first-color': colors.first,
    '--second-color': colors.second,
    '--third-color': colors.third,
    '--fourth-color': colors.fourth,
    '--fifth-color': colors.fifth,
    '--sixth-color': colors.sixth,
  } as React.CSSProperties

  return (
    <div
      ref={containerRef}
      data-slot="bubble-background"
      className={cx('relative size-full overflow-hidden', className)}
      style={{ ...cssVars, ...style }}
      {...props}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-0 top-0 h-0 w-0">
        <defs>
          <filter id="omari-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>

      <div className="absolute inset-0" style={{ filter: 'url(#omari-goo) blur(40px)' }}>
        <motion.div
          className="absolute left-[10%] top-[10%] size-[80%] rounded-full bg-[radial-gradient(circle_at_center,rgba(var(--first-color),0.8)_0%,rgba(var(--first-color),0)_50%)]"
          animate={{ y: [-50, 50, -50] }}
          transition={{ duration: 30, ease: 'easeInOut', repeat: Infinity }}
          style={{ transform: 'translateZ(0)', willChange: 'transform' }}
        />

        <motion.div
          className="absolute inset-0 flex origin-[calc(50%-400px)] items-center justify-center"
          animate={{ rotate: 360 }}
          transition={{ duration: 20, ease: 'linear', repeat: Infinity, repeatType: 'loop' }}
          style={{ transform: 'translateZ(0)', willChange: 'transform' }}
        >
          <div className="left-[10%] top-[10%] size-[80%] rounded-full bg-[radial-gradient(circle_at_center,rgba(var(--second-color),0.8)_0%,rgba(var(--second-color),0)_50%)]" />
        </motion.div>

        <motion.div
          className="absolute inset-0 flex origin-[calc(50%+400px)] items-center justify-center"
          animate={{ rotate: 360 }}
          transition={{ duration: 40, ease: 'linear', repeat: Infinity }}
          style={{ transform: 'translateZ(0)', willChange: 'transform' }}
        >
          <div className="absolute left-[calc(50%-500px)] top-[calc(50%+200px)] size-[80%] rounded-full bg-[radial-gradient(circle_at_center,rgba(var(--third-color),0.8)_0%,rgba(var(--third-color),0)_50%)]" />
        </motion.div>

        <motion.div
          className="absolute left-[10%] top-[10%] size-[80%] rounded-full bg-[radial-gradient(circle_at_center,rgba(var(--fourth-color),0.8)_0%,rgba(var(--fourth-color),0)_50%)] opacity-70"
          animate={{ x: [-50, 50, -50] }}
          transition={{ duration: 40, ease: 'easeInOut', repeat: Infinity }}
          style={{ transform: 'translateZ(0)', willChange: 'transform' }}
        />

        <motion.div
          className="absolute inset-0 flex origin-[calc(50%_-_800px)_calc(50%_+_200px)] items-center justify-center"
          animate={{ rotate: 360 }}
          transition={{ duration: 20, ease: 'linear', repeat: Infinity }}
          style={{ transform: 'translateZ(0)', willChange: 'transform' }}
        >
          <div className="absolute left-[calc(50%-80%)] top-[calc(50%-80%)] size-[160%] rounded-full bg-[radial-gradient(circle_at_center,rgba(var(--fifth-color),0.8)_0%,rgba(var(--fifth-color),0)_50%)]" />
        </motion.div>

        {interactive && (
          <motion.div
            className="absolute size-full rounded-full bg-[radial-gradient(circle_at_center,rgba(var(--sixth-color),0.8)_0%,rgba(var(--sixth-color),0)_50%)] opacity-70"
            style={{ x: springX, y: springY, transform: 'translateZ(0)', willChange: 'transform' }}
          />
        )}
      </div>

      {children}
    </div>
  )
}
