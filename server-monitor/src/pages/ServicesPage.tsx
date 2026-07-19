import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Box, Cog, Play, Square, RotateCcw, Circle, Power, XCircle } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import { useServers } from '../store/ServerContext'
import { useToast } from '../components/ui/Toast'
import type { DockerContainer, Process, ServiceStatus } from '../types/server'

export default function ServicesPage() {
  const { id: paramId } = useParams()
  const { showToast } = useToast()
  const { servers, isConnected, execCommand } = useServers()
  const [selectedServerId, setSelectedServerId] = useState(paramId || servers[0]?.id || '')
  const server = servers.find(s => s.id === selectedServerId)
  const [activeTab, setActiveTab] = useState<'docker' | 'processes' | 'services'>('docker')
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [processes, setProcesses] = useState<Process[]>([])
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loading, setLoading] = useState(false)

  const tabs = [
    { key: 'docker' as const, label: 'Docker', icon: Box },
    { key: 'processes' as const, label: '进程', icon: Cog },
    { key: 'services' as const, label: '服务', icon: Power },
  ]

  useEffect(() => {
    const nextId = paramId || servers[0]?.id || ''
    if (nextId !== selectedServerId) {
      setSelectedServerId(nextId)
      setContainers([])
      setProcesses([])
      setServices([])
    }
  }, [paramId, servers, selectedServerId])

  const fetchContainers = useCallback(async () => {
    if (!selectedServerId || !isConnected(selectedServerId)) return
    setLoading(true)
    try {
      const out = await execCommand(selectedServerId, "docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null || echo ''")
      if (!out.trim()) { setContainers([]); setLoading(false); return }
      const items = out.trim().split('\n').filter(l => l.includes('|')).map(line => {
        const [id, name, image, status, ports] = line.split('|')
        return {
          id, name, image,
          status: status?.toLowerCase().includes('up') ? 'running' as const :
                  status?.toLowerCase().includes('paused') ? 'paused' as const : 'stopped' as const,
          ports: ports ? ports.split(',').map((p: string) => p.trim()) : [],
          cpuPercent: 0, memoryPercent: 0,
        }
      })
      setContainers(items)
    } catch {}
    setLoading(false)
  }, [selectedServerId, isConnected, execCommand])

  const fetchProcesses = useCallback(async () => {
    if (!selectedServerId || !isConnected(selectedServerId)) return
    setLoading(true)
    try {
      const out = await execCommand(selectedServerId, "ps aux --sort=-%cpu | head -20")
      const lines = out.trim().split('\n').slice(1)
      const procs = lines.map(line => {
        const parts = line.trim().split(/\s+/)
        return {
          pid: parseInt(parts[1]) || 0,
          user: parts[0] || '',
          cpuPercent: parseFloat(parts[2]) || 0,
          memoryPercent: parseFloat(parts[3]) || 0,
          state: parts[7] || 'S',
          name: parts.slice(10).join(' ') || parts[9] || '',
        }
      }).filter(p => p.pid > 0)
      setProcesses(procs)
    } catch {}
    setLoading(false)
  }, [selectedServerId, isConnected, execCommand])

  const fetchServices = useCallback(async () => {
    if (!selectedServerId || !isConnected(selectedServerId)) return
    setLoading(true)
    try {
      const out = await execCommand(selectedServerId, "systemctl list-units --type=service --no-pager --no-legend 2>/dev/null | head -20 || echo ''")
      const lines = out.trim().split('\n').filter(l => l.includes('.service'))
      const svcs = lines.map(line => {
        const parts = line.trim().split(/\s+/)
        const name = parts[0] || ''
        const statusStr = (parts[3] || 'inactive').toLowerCase()
        return {
          name,
          status: (statusStr === 'active' || statusStr === 'running' ? 'active' :
                   statusStr === 'failed' ? 'failed' : 'inactive') as ServiceStatus['status'],
          description: parts.slice(4).join(' ') || '',
        }
      })
      setServices(svcs)
    } catch {}
    setLoading(false)
  }, [selectedServerId, isConnected, execCommand])

  useEffect(() => {
    if (!isConnected(selectedServerId)) return
    if (activeTab === 'docker') fetchContainers()
    else if (activeTab === 'processes') fetchProcesses()
    else fetchServices()
  }, [activeTab, selectedServerId, isConnected, fetchContainers, fetchProcesses, fetchServices])

  const dockerAction = async (_id: string, name: string, action: string) => {
    const ok = await execCommand(selectedServerId, `docker ${action} ${name} 2>&1`)
    showToast(ok.includes('Error') || ok.includes('error') ? `操作失败: ${ok}` : `${action} ${name}`, 'success')
    fetchContainers()
  }

  const killProcess = async (pid: number) => {
    await execCommand(selectedServerId, `kill ${pid} 2>&1`)
    showToast(`已终止进程 PID ${pid}`, 'success')
    fetchProcesses()
  }

  const serviceAction = async (name: string, action: string) => {
    const ok = await execCommand(selectedServerId, `systemctl ${action} ${name} 2>&1`)
    const labels: Record<string, string> = { start: '已启动', stop: '已停止', restart: '已重启' }
    showToast(ok.includes('Failed') ? `操作失败: ${ok}` : `${labels[action] || action}: ${name}`, 'success')
    fetchServices()
  }

  if (!server) {
    return (
      <div className="p-8 text-center"><p className="text-text-muted">请先添加服务器</p></div>
    )
  }

  if (!isConnected(selectedServerId)) {
    return (
      <div className="h-full overflow-y-auto overscroll-y-contain pb-6">
        <PageHeader title="服务管理" subtitle={server.name} />
        <div className="px-4">
          <div className="glass rounded-2xl p-8 text-center animate-slide-up">
            <Box size={40} className="text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary text-sm">请先连接到服务器</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto overscroll-y-contain pb-6">
      <PageHeader title="服务管理" subtitle={`${server.name} · Docker · 进程 · 系统服务`} />

      <div className="px-4 space-y-4">
        <div className="glass rounded-2xl p-1 flex animate-slide-up">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
                activeTab === key ? 'bg-primary/15 text-primary-light' : 'text-text-muted hover:text-text-secondary'
              }`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="glass rounded-2xl p-8 text-center">
            <p className="text-text-muted text-sm">加载中...</p>
          </div>
        ) : activeTab === 'docker' ? (
          <div className="space-y-3 animate-slide-up">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{containers.filter(c => c.status === 'running').length} / {containers.length} 运行中</span>
              <button onClick={fetchContainers} className="text-xs text-primary-light">刷新</button>
            </div>
            {containers.length === 0 ? (
              <div className="glass rounded-2xl p-6 text-center text-text-muted text-sm">无 Docker 容器，或 Docker 未安装</div>
            ) : containers.map(c => (
              <div key={c.id} className="glass rounded-2xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      c.status === 'running' ? 'bg-success/10' : c.status === 'stopped' ? 'bg-danger/10' : 'bg-warning/10'
                    }`}>
                      <Box size={17} className={c.status === 'running' ? 'text-success' : c.status === 'stopped' ? 'text-text-muted' : 'text-warning'} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-medium text-text-primary truncate">{c.name}</h4>
                      <p className="text-[10px] text-text-muted truncate">{c.image}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {c.status === 'running' ? (
                      <>
                        <button onClick={() => dockerAction(c.id, c.name, 'stop')} className="p-1.5 rounded-lg hover:bg-white/5" title="停止">
                          <Square size={13} className="text-warning" />
                        </button>
                        <button onClick={() => dockerAction(c.id, c.name, 'restart')} className="p-1.5 rounded-lg hover:bg-white/5" title="重启">
                          <RotateCcw size={13} className="text-text-muted" />
                        </button>
                      </>
                    ) : (
                      <button onClick={() => dockerAction(c.id, c.name, 'start')} className="p-1.5 rounded-lg hover:bg-white/5" title="启动">
                        <Play size={13} className="text-success" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'running' ? 'bg-success animate-pulse' : c.status === 'stopped' ? 'bg-danger' : 'bg-warning'}`} />
                  <span className="text-[10px] text-text-muted capitalize">{c.status}</span>
                  <div className="flex gap-1.5 flex-wrap ml-auto">
                    {c.ports.map(port => (
                      <span key={port} className="px-2 py-0.5 text-[9px] font-mono rounded-md bg-white/5 text-text-muted">{port}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'processes' ? (
          <div className="animate-slide-up">
            <div className="flex justify-end mb-2">
              <button onClick={fetchProcesses} className="text-xs text-primary-light">刷新</button>
            </div>
            <div className="glass rounded-2xl overflow-hidden">
              <div className="grid grid-cols-[1fr_50px_50px_34px] gap-2 px-4 py-2.5 border-b border-border/30">
                {['进程', 'CPU%', 'MEM%', ''].map(h => (
                  <span key={h} className="text-[10px] font-medium text-text-muted uppercase">{h}</span>
                ))}
              </div>
              {processes.length === 0 ? (
                <div className="px-4 py-8 text-center text-text-muted text-sm">无数据</div>
              ) : processes.map(proc => (
                <div key={proc.pid} className="grid grid-cols-[1fr_50px_50px_34px] gap-2 px-4 py-3 border-b border-border/10 hover:bg-white/[0.02] transition-colors">
                  <div className="min-w-0">
                    <p className="text-xs text-text-primary font-medium truncate">{proc.name}</p>
                    <p className="text-[9px] text-text-muted">PID {proc.pid} · {proc.user}</p>
                  </div>
                  <span className="text-xs text-text-secondary self-center">{proc.cpuPercent.toFixed(1)}%</span>
                  <span className="text-xs text-text-secondary self-center">{proc.memoryPercent.toFixed(1)}%</span>
                  <button onClick={() => killProcess(proc.pid)} className="self-center p-0.5 rounded hover:bg-danger/10 transition-colors" title="终止">
                    <XCircle size={13} className="text-danger/60 hover:text-danger" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="animate-slide-up">
            <div className="flex justify-end mb-2">
              <button onClick={fetchServices} className="text-xs text-primary-light">刷新</button>
            </div>
            <div className="space-y-2">
              {services.length === 0 ? (
                <div className="glass rounded-2xl p-6 text-center text-text-muted text-sm">无 systemd 服务数据</div>
              ) : services.map(svc => (
                <div key={svc.name} className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary font-medium truncate">{svc.name}</p>
                    <p className="text-[10px] text-text-muted truncate mt-0.5">{svc.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {svc.status === 'active' ? (
                      <>
                        <button onClick={() => serviceAction(svc.name, 'stop')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-danger/10 text-danger hover:bg-danger/20 transition-colors">
                          <Square size={10} /> 停止
                        </button>
                        <button onClick={() => serviceAction(svc.name, 'restart')}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-warning/10 text-warning hover:bg-warning/20 transition-colors">
                          <RotateCcw size={10} /> 重启
                        </button>
                      </>
                    ) : svc.status === 'failed' ? (
                      <button onClick={() => serviceAction(svc.name, 'restart')}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-warning/10 text-warning hover:bg-warning/20 transition-colors">
                        <RotateCcw size={10} /> 重启
                      </button>
                    ) : (
                      <button onClick={() => serviceAction(svc.name, 'start')}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-success/10 text-success hover:bg-success/20 transition-colors">
                        <Play size={10} /> 启动
                      </button>
                    )}
                    <span className={`flex items-center gap-1 text-[10px] ${
                      svc.status === 'active' ? 'text-success' : svc.status === 'inactive' ? 'text-text-muted' : 'text-danger'
                    }`}>
                      <Circle size={5} className={svc.status === 'active' ? 'fill-success' : 'fill-current'} />
                      {svc.status === 'active' ? '运行' : svc.status === 'inactive' ? '停止' : '失败'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
