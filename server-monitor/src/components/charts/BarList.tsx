interface Props {
  items: { label: string; value: number; color?: string; max?: number }[]
}

export default function BarList({ items }: Props) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const pct = item.max ? (item.value / item.max) * 100 : item.value
        const color = item.color || '#6366f1'
        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">{item.label}</span>
              <span className="text-text-primary font-medium">{item.value.toFixed(1)}{item.max ? '%' : ''}</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${Math.min(pct, 100)}%`,
                  background: `linear-gradient(90deg, ${color}, ${color}88)`,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
