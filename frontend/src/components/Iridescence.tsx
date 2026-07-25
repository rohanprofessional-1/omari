import { useEffect, useRef, useState } from 'react'
import { Mesh, Program, Renderer, Triangle } from 'ogl'

/**
 * Omari — iridescent OGL shader surface (the orb's "skin").
 *
 * A full-screen triangle running a layered-cosine fragment shader (React Bits
 * "Iridescence"), rendered into whatever container it's given — the caller
 * clips it to a circle. Adapted for this project:
 *  - `amplitude`/`speed`/`color` props may change EVERY FRAME (they're driven
 *    by live microphone level), so they're read through a ref inside the RAF
 *    loop instead of re-creating the GL program on each change.
 *  - `color` eases toward its target (never snaps) so the blue → green
 *    referral-sent beat stays a gentle transition.
 *  - Sizes to its container via ResizeObserver and cleans up the GL context,
 *    canvas, and RAF on unmount.
 *  - DEGRADES instead of dying. WebGL is not universally available — remote
 *    desktops, hardened browsers, old GPUs and headless Chrome all refuse a
 *    context — and ogl's Renderer throws outright when it cannot get one. That
 *    threw during render of the patient's INTAKE screen, which is now the orb,
 *    so a missing GPU took the whole app to a blank page. It now falls back to
 *    a painted orb: same size, same colour, no shader.
 */

const vertexShader = /* glsl */ `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`

const fragmentShader = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uResolution;
uniform float uAmplitude;
uniform float uSpeed;
varying vec2 vUv;
void main() {
  float mr = min(uResolution.x, uResolution.y);
  vec2 uv = (vUv * 2.0 - 1.0) * uResolution.xy / mr;
  uv *= mix(1.0, 0.9, uAmplitude);
  float d = -uTime * 0.5 * uSpeed;
  float a = 0.0;
  for (float i = 0.0; i < 8.0; ++i) {
    a += cos(i - d - a * uv.x);
    d += sin(uv.y * i + a);
  }
  // Cancel the unbounded time term in d (matches the original React Bits shader).
  // Without this, cos(uv.x * d) below sweeps to ever-higher spatial frequency as
  // the page stays open, aliasing into vertical moiré lines after a few minutes.
  d += uTime * 0.5 * uSpeed;
  vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
  col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
  gl_FragColor = vec4(col, 1.0);
}
`

export interface IridescenceProps {
  color?: [number, number, number]
  speed?: number
  amplitude?: number
  className?: string
}

export default function Iridescence({
  color = [0.3, 0.6, 1],
  speed = 1,
  amplitude = 0.1,
  className,
}: IridescenceProps) {
  const container = useRef<HTMLDivElement | null>(null)
  const propsRef = useRef({ color, speed, amplitude })
  propsRef.current = { color, speed, amplitude }
  /** No GL context — paint the orb instead of taking the screen down. */
  const [noWebgl, setNoWebgl] = useState(false)

  useEffect(() => {
    const el = container.current
    if (!el) return

    let renderer: Renderer
    try {
      renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        alpha: false,
      })
      // ogl reports failure by leaving `gl` unusable rather than by throwing
      // every time, so check it as well as catching.
      if (!renderer.gl) throw new Error('no webgl context')
    } catch {
      setNoWebgl(true)
      return
    }

    const { gl } = renderer
    gl.canvas.style.width = '100%'
    gl.canvas.style.height = '100%'
    gl.canvas.style.display = 'block'

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Float32Array(propsRef.current.color) },
        uResolution: { value: new Float32Array([1, 1, 1]) },
        uAmplitude: { value: propsRef.current.amplitude },
        uSpeed: { value: propsRef.current.speed },
      },
    })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })

    const resize = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h)
      program.uniforms.uResolution.value.set([
        gl.canvas.width,
        gl.canvas.height,
        gl.canvas.width / Math.max(1, gl.canvas.height),
      ])
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()

    let raf = 0
    const animate = (t: number) => {
      raf = requestAnimationFrame(animate)
      const { color: targetColor, speed: liveSpeed, amplitude: liveAmp } = propsRef.current
      const u = program.uniforms
      u.uTime.value = t * 0.001
      u.uSpeed.value = liveSpeed
      u.uAmplitude.value = liveAmp
      const c = u.uColor.value as Float32Array
      for (let i = 0; i < 3; i++) c[i] += (targetColor[i] - c[i]) * 0.05
      renderer.render({ scene: mesh })
    }
    raf = requestAnimationFrame(animate)
    el.appendChild(gl.canvas)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      if (gl.canvas.parentNode === el) el.removeChild(gl.canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  // The fallback is a soft radial paint in the same colour the shader eases
  // toward, so the orb still reads as a lit sphere and still turns green on
  // referral-sent — it simply stops shimmering.
  const [r, g, b] = color.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255))
  return (
    <div
      ref={container}
      className={className ?? 'h-full w-full'}
      style={
        noWebgl
          ? {
              background: `radial-gradient(circle at 36% 30%, rgba(255,255,255,0.55), rgba(${r},${g},${b},0.95) 42%, rgba(${Math.round(r * 0.45)},${Math.round(g * 0.45)},${Math.round(b * 0.55)},1) 100%)`,
            }
          : undefined
      }
    />
  )
}
