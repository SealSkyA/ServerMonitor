interface Props {
  value: number
  label: string
  color: string
  size?: number
}

export default function MiniRing({ value, label, color, size = 60 }: Props) {
  const r = (size - 5) / 2
  const circ = 2 * Math.PI * r
  const pct = Math.min(Math.max(value, 0), 100)
  const offset = circ - (pct / 100) * circ

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="currentColor" strokeWidth="4" className="text-white/5" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="currentColor" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            className={color} style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold text-text-primary">{pct.toFixed(0)}%</span>
        </div>
      </div>
      <span className="text-[10px] text-text-muted">{label}</span>
    </div>
  )
}
