/** Lightweight SVG bar/line chart — no extra deps. */
export type ChartPoint = { t: string; value: number }

export function SimpleBarChart({
  points,
  height = 140,
  color = '#002FA7',
  label,
}: {
  points: ChartPoint[]
  height?: number
  color?: string
  label?: string
}) {
  const w = Math.max(320, points.length * 28)
  const max = Math.max(1, ...points.map((p) => p.value))
  const pad = 24
  const innerH = height - pad
  return (
    <div className="w-full overflow-x-auto">
      {label && <div className="mb-1 text-xs font-medium text-ink-secondary">{label}</div>}
      <svg width={w} height={height} className="block min-w-full">
        {points.map((p, i) => {
          const bw = Math.max(8, (w - 8) / points.length - 4)
          const x = 4 + i * ((w - 8) / points.length)
          const h = (p.value / max) * (innerH - 8)
          const y = innerH - h
          return (
            <g key={p.t + i}>
              <rect x={x} y={y} width={bw} height={Math.max(1, h)} rx={3} fill={color} opacity={0.85} />
              {points.length <= 14 && (
                <text x={x + bw / 2} y={height - 4} textAnchor="middle" fontSize={9} fill="#64748b">
                  {p.t.length > 10 ? p.t.slice(8, 13) : p.t.slice(-5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {points.every((p) => p.value === 0) && (
        <p className="text-xs text-ink-secondary">Нет данных за период</p>
      )}
    </div>
  )
}

export function SimpleLineChart({
  points,
  height = 140,
  color = '#002FA7',
  label,
}: {
  points: ChartPoint[]
  height?: number
  color?: string
  label?: string
}) {
  const w = Math.max(320, points.length * 20)
  const max = Math.max(1, ...points.map((p) => p.value))
  const pad = 16
  const innerH = height - pad * 2
  const step = points.length > 1 ? (w - 16) / (points.length - 1) : 0
  const coords = points.map((p, i) => {
    const x = 8 + i * step
    const y = pad + innerH - (p.value / max) * innerH
    return `${x},${y}`
  })
  return (
    <div className="w-full overflow-x-auto">
      {label && <div className="mb-1 text-xs font-medium text-ink-secondary">{label}</div>}
      <svg width={w} height={height} className="block min-w-full">
        <polyline fill="none" stroke={color} strokeWidth={2} points={coords.join(' ')} />
        {points.map((p, i) => {
          const x = 8 + i * step
          const y = pad + innerH - (p.value / max) * innerH
          return <circle key={i} cx={x} cy={y} r={3} fill={color} />
        })}
      </svg>
    </div>
  )
}
