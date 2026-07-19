interface Props {
  status: 'online' | 'offline' | 'warning'
  size?: 'sm' | 'md'
}

const colors = {
  online: 'bg-success',
  offline: 'bg-danger',
  warning: 'bg-warning',
}

const labels = {
  online: '在线',
  offline: '离线',
  warning: '警告',
}

export default function StatusBadge({ status, size = 'sm' }: Props) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${size === 'md' ? 'px-2.5 py-1 rounded-lg' : 'px-2 py-0.5 rounded-md'} bg-white/5`}>
      <span className={`${size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2'} rounded-full ${colors[status]} ${
        status === 'online' ? 'animate-pulse' : ''
      }`} />
      <span className={`${size === 'md' ? 'text-xs' : 'text-[10px]'} font-medium text-text-secondary`}>
        {labels[status]}
      </span>
    </div>
  )
}
