/**
 * Blume / NerveRoute brand mark — an 8-petal starburst with a star negative space.
 * Five "dark" petals + a blue trio (cobalt → sky → light) on the trailing edge.
 *
 * `dark` recolors the five non-blue petals so the mark reads on light or dark
 * surfaces (pass "#ffffff" on dark backgrounds).
 */
export default function Logo({
  className = 'h-7 w-7',
  dark = '#0B1220',
}: {
  className?: string
  dark?: string
}) {
  const petal = { x: 42, y: 6, width: 16, height: 31, rx: 6 }
  const petals: { angle: number; fill: string }[] = [
    { angle: 0, fill: dark }, // top
    { angle: 45, fill: '#2563EB' }, // top-right · cobalt
    { angle: 90, fill: '#19A8EE' }, // right · sky
    { angle: 135, fill: '#9AC8F3' }, // bottom-right · light
    { angle: 180, fill: dark }, // bottom
    { angle: 225, fill: dark }, // bottom-left
    { angle: 270, fill: dark }, // left
    { angle: 315, fill: dark }, // top-left
  ]

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      {petals.map((p) => (
        <rect
          key={p.angle}
          x={petal.x}
          y={petal.y}
          width={petal.width}
          height={petal.height}
          rx={petal.rx}
          fill={p.fill}
          transform={`rotate(${p.angle} 50 50)`}
        />
      ))}
    </svg>
  )
}
