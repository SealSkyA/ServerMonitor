import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { ChartDataPoint } from '../../types/server'

interface Props {
  data: ChartDataPoint[]
  color?: string
  title: string
  currentValue: string
  unit?: string
}

export default function AreaChartCard({ data, color = '#6366f1', title, currentValue, unit = '%' }: Props) {
  return (
    <div className="glass rounded-2xl p-4 animate-slide-up">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">{title}</h3>
        <span className="text-lg font-bold text-text-primary">
          {currentValue}<span className="text-sm font-normal text-text-muted ml-0.5">{unit}</span>
        </span>
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
            <Tooltip
              contentStyle={{
                background: 'rgba(26, 26, 46, 0.95)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                fontSize: '12px',
                color: '#f1f5f9',
              }}
              labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#gradient-${title})`}
              dot={false}
              activeDot={{ r: 4, fill: color, stroke: 'rgba(255,255,255,0.2)', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
