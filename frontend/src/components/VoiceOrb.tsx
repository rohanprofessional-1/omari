import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import Iridescence from './Iridescence'

/**
 * Omari — voice-reactive iridescent orb (presentation mode) + voice capture.
 *
 * The orb is the OGL <Iridescence/> shader clipped to a circle, wrapped in a
 * soft glow. It reacts to the PATIENT'S VOICE via the `levelRef` fed to it by
 * `useVoiceCapture` — speak louder and it pulses faster; speak softly and it
 * gently breathes. Without an active mic (or under prefers-reduced-motion via
 * `calm`) it idles at its base amplitude, so it always renders something alive.
 *
 * `useVoiceCapture` is the ONE voice session for the experience, started from
 * the mic button inside the input box (no separate "enable" step). It runs two
 * things off the same permission grant:
 *  - an AnalyserNode loop → smoothed input level (drives the orb), and
 *  - Web Speech API recognition → final transcript chunks are handed to
 *    whichever input is currently mounted (via `transcriptRef`), i.e. talk-to-text.
 */

export const ORB_BLUE: [number, number, number] = [0.3, 0.6, 1]
// Muted sage for the referral-sent success beat (from --color-success family).
export const ORB_GREEN: [number, number, number] = [0.42, 0.68, 0.5]

/* -------------------------------------------------------------------------- */
/* Voice capture — mic level (orb) + speech-to-text (inputs)                   */
/* -------------------------------------------------------------------------- */

/** Minimal surface of the (still-prefixed) Web Speech API. */
type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null
}

export interface VoiceCapture {
  /** Whether a voice session is live (mic level + recognition). */
  listening: boolean
  /** Whether this browser can do speech-to-text at all. */
  supported: boolean
  error: string | null
  /** Smoothed 0–1 mic level — feed to <VoiceOrb levelRef/>. */
  levelRef: RefObject<number>
  /** The currently-mounted input registers here to receive final transcript chunks. */
  transcriptRef: React.MutableRefObject<((chunk: string) => void) | null>
  toggle: () => void
}

export function useVoiceCapture(): VoiceCapture {
  const levelRef = useRef(0)
  const transcriptRef = useRef<((chunk: string) => void) | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const activeRef = useRef(false)
  const rafRef = useRef(0)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    activeRef.current = false
    if (recRef.current) {
      recRef.current.onend = null
      try {
        recRef.current.stop()
      } catch {
        /* already stopped */
      }
      recRef.current = null
    }
    cancelAnimationFrame(rafRef.current)
    if (ctxRef.current && ctxRef.current.state !== 'closed') void ctxRef.current.close()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    ctxRef.current = null
    streamRef.current = null
    levelRef.current = 0
    setListening(false)
  }, [])

  const start = useCallback(async () => {
    stop()
    try {
      // 1) Mic level for the orb.
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      ctxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b) / data.length
        const norm = Math.min(1, Math.max(0, (avg - 16) / 90))
        levelRef.current += (norm - levelRef.current) * 0.15
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()

      // 2) Speech-to-text into the active input (where supported).
      const SR = getSpeechRecognitionCtor()
      if (SR) {
        const rec = new SR()
        rec.continuous = true
        rec.interimResults = false
        rec.lang = document.documentElement.lang || 'en-US'
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]
            if (r.isFinal) {
              const chunk = r[0].transcript.trim()
              if (chunk) transcriptRef.current?.(chunk)
            }
          }
        }
        // Chrome ends recognition after a stretch of silence — keep the session
        // alive until the patient explicitly toggles the mic off.
        rec.onend = () => {
          if (!activeRef.current) return
          try {
            rec.start()
          } catch {
            /* restart raced a stop — session is over */
          }
        }
        rec.onerror = (e) => {
          if (
            e.error === 'not-allowed' ||
            e.error === 'service-not-allowed' ||
            e.error === 'network'
          ) {
            // The recognition SERVICE is unavailable (mic itself is already
            // granted — getUserMedia succeeded above). Drop talk-to-text but
            // KEEP the level session so the orb still reacts to the voice.
            rec.onend = null
            try {
              rec.stop()
            } catch {
              /* already stopped */
            }
            recRef.current = null
            setError('Voice-to-text unavailable')
          }
          /* 'no-speech' / 'aborted' etc. → onend handles the restart */
        }
        rec.start()
        recRef.current = rec
      }

      activeRef.current = true
      setError(null)
      setListening(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone unavailable')
      stop()
    }
  }, [stop])

  const toggle = useCallback(() => {
    if (activeRef.current) stop()
    else void start()
  }, [start, stop])

  useEffect(() => stop, [stop])

  return {
    listening,
    supported: getSpeechRecognitionCtor() !== null,
    error,
    levelRef,
    transcriptRef,
    toggle,
  }
}

/* -------------------------------------------------------------------------- */
/* The orb                                                                     */
/* -------------------------------------------------------------------------- */

export interface VoiceOrbProps {
  /** Shader tint the orb eases toward (RGB in 0–1). */
  color?: [number, number, number]
  /** Live 0–1 mic level from useVoiceCapture; omit for a calm idle orb. */
  levelRef?: RefObject<number>
  /** prefers-reduced-motion: hold the orb at a calm, near-static baseline. */
  calm?: boolean
}

export default function VoiceOrb({ color = ORB_BLUE, levelRef, calm = false }: VoiceOrbProps) {
  const [level, setLevel] = useState(0)

  // Second smoothing pass mic-level → React state, driving the visual layer.
  useEffect(() => {
    if (calm || !levelRef) {
      setLevel(0)
      return
    }
    let raf = 0
    const update = () => {
      setLevel((prev) => prev + ((levelRef.current ?? 0) - prev) * 0.25)
      raf = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(raf)
  }, [levelRef, calm])

  const amplitude = 0.18 + level * 1.7
  const speed = calm ? 0.35 : 0.75 + level * 0.5
  const scale = 1 + level * 0.35
  const glowOpacity = 0.25 + level * 2.45

  return (
    <div className="relative h-full w-full">
      {/* Ambient glow behind the orb — blooms with the voice level. */}
      <div
        className="absolute inset-0 rounded-full bg-blue-400 blur-[110px]"
        style={{ opacity: glowOpacity }}
        aria-hidden
      />
      <div
        className="relative h-full w-full overflow-hidden rounded-full shadow-[0_0_90px_rgba(58,108,255,0.35)]"
        style={{ transform: `scale(${scale})`, transition: 'transform 0.12s ease-out' }}
      >
        <Iridescence color={color} amplitude={amplitude} speed={speed} />
      </div>
    </div>
  )
}
