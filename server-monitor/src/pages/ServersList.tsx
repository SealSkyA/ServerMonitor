import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import ServerCard from '../components/dashboard/ServerCard'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useServers } from '../store/ServerContext'
import { useToast } from '../components/ui/Toast'

export default function ServersList() {
  const navigate = useNavigate()
  const { servers, deleteServer, isConnected } = useServers()
  const { showToast } = useToast()
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const handleDelete = () => {
    if (deleteTarget) {
      const server = servers.find(s => s.id === deleteTarget)
      deleteServer(deleteTarget)
      showToast(`已删除服务器: ${server?.name || deleteTarget}`, 'success')
    }
    setDeleteTarget(null)
  }

  return (
    <div className="pb-24">
      <ConfirmDialog open={!!deleteTarget} title="删除服务器"
        message={`确定要删除服务器「${servers.find(s => s.id === deleteTarget)?.name || ''}」吗？此操作不可撤销。`}
        confirmLabel="删除" danger onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />

      <PageHeader title="服务器列表" subtitle={`${servers.length} 台服务器`}
        action={
          <button onClick={() => navigate('/add-server')} className="p-1.5 rounded-xl hover:bg-white/5 transition-colors">
            <Plus size={18} className="text-text-secondary" />
          </button>
        }
      />

      <div className="px-4 space-y-3">
        {servers.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-text-muted text-sm mb-3">还没有添加服务器</p>
            <button onClick={() => navigate('/add-server')} className="px-4 py-2 bg-primary/15 text-primary-light rounded-xl text-sm font-medium hover:bg-primary/25 transition-colors">
              添加第一台服务器
            </button>
          </div>
        ) : (
          servers.map(server => (
            <ServerCard key={server.id} server={server} isConnected={isConnected(server.id)} onDelete={() => setDeleteTarget(server.id)} />
          ))
        )}
      </div>
    </div>
  )
}
