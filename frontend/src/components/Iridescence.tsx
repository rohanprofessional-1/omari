import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    const el = container.current
    if (!el) return

    const renderer = new Renderer({
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      alpha: false,
    })
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

  return <div ref={container} className={className ?? 'h-full w-full'} />
}
