interface Props {
  value: number
  size?: number
  strokeWidth?: number
  color?: string
  label: string
  sublabel?: string
}

export default function StatusRing({ value, size = 80, strokeWidth = 6, color = '#6366f1', label, sublabel }: Props) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (value / 100) * circumference

  const getColor = () => {
    if (value > 90) return '#ef4444'
    if (value > 70) return '#f59e0b'
    return color
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={getColor()}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-text-primary">{Math.round(value)}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-medium text-text-secondary">{label}</p>
        {sublabel && <p className="text-[10px] text-text-muted mt-0.5">{sublabel}</p>}
      </div>
    </div>
  )
}
