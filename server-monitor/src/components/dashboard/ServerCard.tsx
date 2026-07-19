import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, ChevronRight, Cpu, HardDrive, Trash2, Edit3, MoreHorizontal, Wifi } from 'lucide-react'
import StatusBadge from '../layout/StatusBadge'
import { useServers } from '../../store/ServerContext'
import { useToast } from '../ui/Toast'
import type { Server as ServerType } from '../../types/server'

interface Props {
  server: ServerType
  isConnected?: boolean
  cpuUsage?: number
  memUsage?: number
  onDelete?: () => void
}

export default function ServerCard({ server, isConnected, cpuUsage, memUsage, onDelete }: Props) {
  const navigate = useNavigate()
  const { connectServer } = useServers()
  const { showToast } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleConnect = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    const pwd = server.password
    if (pwd) {
      const result = await connectServer(server.id)
      showToast(result.success ? `已连接到 ${server.name}` : (result.error || `连接 ${server.name} 失败`), result.success ? 'success' : 'error')
    } else if (server.authType === 'password') {
      const password = prompt(`输入 ${server.name} (${server.host}) 的 SSH 密码:`)
      if (password) {
        const result = await connectServer(server.id, password)
        showToast(result.success ? `已连接到 ${server.name}` : (result.error || `连接 ${server.name} 失败`), result.success ? 'success' : 'error')
      }
    } else {
      showToast('密钥认证请在设置中配置', 'info')
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => navigate(`/server/${server.id}`)}
        className="glass card-gradient rounded-2xl p-4 w-full text-left glass-hover animate-slide-up"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isConnected ? 'bg-success/10' :
              server.status === 'warning' ? 'bg-warning/10' : 'bg-white/5'
            }`}>
              {isConnected ? <Wifi size={18} className="text-success" /> :
               <Server size={20} className="text-text-muted" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary truncate">{server.name}</h3>
              <p className="text-[11px] text-text-muted truncate">{server.host}:{server.port}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={isConnected ? 'online' : 'offline'} />
            <button onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors">
              <MoreHorizontal size={14} className="text-text-muted" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-2">
          {cpuUsage !== undefined && (
            <div className="flex items-center gap-1.5">
              <Cpu size={13} className="text-text-muted" />
              <span className="text-xs text-text-secondary">CPU <span className="font-medium text-text-primary">{cpuUsage.toFixed(1)}%</span></span>
            </div>
          )}
          {memUsage !== undefined && (
            <div className="flex items-center gap-1.5">
              <HardDrive size={13} className="text-text-muted" />
              <span className="text-xs text-text-secondary">MEM <span className="font-medium text-text-primary">{memUsage.toFixed(1)}%</span></span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {server.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-primary/10 text-primary-light">{tag}</span>
            ))}
          </div>
          <div className="flex items-center gap-1 text-text-muted">
            <span className="text-[11px]">{server.username}@{server.host}</span>
            <ChevronRight size={14} />
          </div>
        </div>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-2 top-10 z-50 glass rounded-xl py-1.5 min-w-[140px] animate-fade-in shadow-xl">
            {!isConnected && (
              <button onClick={handleConnect} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-success hover:bg-white/5 transition-colors">
                <Wifi size={13} /> 连接
              </button>
            )}
            <button onClick={e => { e.stopPropagation(); setMenuOpen(false); navigate(`/server/${server.id}`) }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-text-secondary hover:bg-white/5 transition-colors">
              <Edit3 size={13} /> 详情
            </button>
            {onDelete && (
              <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-danger hover:bg-danger/5 transition-colors">
                <Trash2 size={13} /> 删除
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
