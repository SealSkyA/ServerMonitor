import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, MoreHorizontal, Wifi, Server, Edit3, Trash2, Zap, Thermometer, Search, X, Pin, ChevronDown, Loader2 } from 'lucide-react'
import { useServers } from '../store/ServerContext'
import { useToast } from '../components/ui/Toast'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EditServerModal from '../components/servers/EditServerModal'
import type { Server as ServerType } from '../types/server'

function parseCpuUsage(output: string): number {
  for (const line of output.split('\n')) {
    if (line.includes('%Cpu') || line.includes('CPU')) {
      const user = parseFloat(line.match(/(\d+\.?\d*)\s*us/)?.[1] || '0')
      const sys = parseFloat(line.match(/(\d+\.?\d*)\s*sy/)?.[1] || '0')
      return user + sys
    }
  }
  return 0
}

function parseMemInfo(output: string): number {
  const mem = output.split('\n').find(l => l.startsWith('Mem:'))
  if (mem) {
    const p = mem.trim().split(/\s+/)
    if (p.length >= 3) return (parseFloat(p[2]) / parseFloat(p[1])) * 100
  }
  return 0
}

function parseDiskInfo(output: string): number {
  const parts = output.trim().split(/\s+/)
  if (parts.length >= 5) return parseInt(parts[4].replace('%', '')) || 0
  return 0
}

function parseTemp(output: string): number {
  const v = parseInt(output.trim())
  if (v > 1000) return v / 1000
  if (v > 200) return v
  return v
}

interface ServerMetrics {
  cpu: number
  mem: number
  disk: number
  temp: number
  readSpeed: number
  writeSpeed: number
  netDown: number
  netUp: number
}

interface SampleCache {
  readSectors: number
  writeSectors: number
  netRx: number
  netTx: number
  timestamp: number
}

export default function ServersPage() {
  const navigate = useNavigate()
  const { servers, execCommand, isConnected, connectServer, deleteServer, updateServer } = useServers()
  const { showToast } = useToast()
  const [refreshing, setRefreshing] = useState(false)
  const [metrics, setMetrics] = useState<Record<string, ServerMetrics>>({})
  const sampleRef = useRef<Record<string, SampleCache>>({})
  const metricsRefreshingRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const [pulling, setPulling] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const pullStartY = useRef(0)
  const pullRef = useRef<HTMLDivElement>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<ServerType | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all')
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  const filteredServers = useMemo(() => {
    let list = servers
    if (statusFilter === 'online') list = list.filter(s => isConnected(s.id))
    else if (statusFilter === 'offline') list = list.filter(s => !isConnected(s.id))
    if (!searchQuery.trim()) return list
    const q = searchQuery.toLowerCase()
    return list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    )
  }, [servers, searchQuery, statusFilter, isConnected])

  const connectedServers = useMemo(() => servers.filter(s => isConnected(s.id)), [servers, isConnected])
  const pinnedServers = filteredServers.filter(server => server.pinned)
  const regularServers = filteredServers.filter(server => !server.pinned)
  const displayServers = pinnedCollapsed && !searchQuery.trim() ? regularServers : [...pinnedServers, ...regularServers]

  const fetchAllMetrics = useCallback(async () => {
    if (connectedServers.length === 0 || metricsRefreshingRef.current) return
    metricsRefreshingRef.current = true
    const now = Date.now()
    let nextServerIndex = 0

    try {
      const collectMetrics = async (server: ServerType) => {
        const output = await execCommand(server.id, "top -bn1 2>/dev/null | head -5; printf '__SERVER_MONITOR_SECTION__\\n'; free -m; printf '__SERVER_MONITOR_SECTION__\\n'; df -h / | tail -1; printf '__SERVER_MONITOR_SECTION__\\n'; cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0; printf '__SERVER_MONITOR_SECTION__\\n'; cat /proc/diskstats; printf '__SERVER_MONITOR_SECTION__\\n'; cat /proc/net/dev")
        const [cpuOut = '', memOut = '', dfOut = '', tempOut = '', ioOut = '', netOut = ''] = output.split('__SERVER_MONITOR_SECTION__\n')
        const base: ServerMetrics = {
          cpu: parseCpuUsage(cpuOut), mem: parseMemInfo(memOut), disk: parseDiskInfo(dfOut), temp: parseTemp(tempOut),
          readSpeed: 0, writeSpeed: 0, netDown: 0, netUp: 0,
        }

        let readSectors = 0
        let writeSectors = 0
        for (const line of ioOut.split('\n')) {
          const cols = line.trim().split(/\s+/)
          if (cols.length >= 10) {
            readSectors += parseInt(cols[5]) || 0
            writeSectors += parseInt(cols[9]) || 0
          }
        }

        let netRx = 0
        let netTx = 0
        for (const line of netOut.split('\n')) {
          const cols = line.trim().split(/\s+/)
          if (cols.length >= 10 && cols[0] !== 'lo:') {
            netRx += parseInt(cols[1]) || 0
            netTx += parseInt(cols[9]) || 0
          }
        }

        const prev = sampleRef.current[server.id]
        if (prev && prev.timestamp > 0) {
          const elapsed = (now - prev.timestamp) / 1000
          if (elapsed > 0) {
            base.readSpeed = Math.max(0, (readSectors - prev.readSectors) * 512 / 1024 / elapsed)
            base.writeSpeed = Math.max(0, (writeSectors - prev.writeSectors) * 512 / 1024 / elapsed)
            base.netDown = Math.max(0, (netRx - prev.netRx) / 1024 / elapsed)
            base.netUp = Math.max(0, (netTx - prev.netTx) / 1024 / elapsed)
          }
        }

        sampleRef.current[server.id] = { readSectors, writeSectors, netRx, netTx, timestamp: now }
        setMetrics(current => ({ ...current, [server.id]: base }))
      }

      const worker = async () => {
        while (nextServerIndex < connectedServers.length) {
          const server = connectedServers[nextServerIndex++]
          try {
            await collectMetrics(server)
          } catch {}
        }
      }

      await Promise.all(Array.from({ length: Math.min(4, connectedServers.length) }, worker))
    } finally {
      metricsRefreshingRef.current = false
    }
  }, [connectedServers, execCommand])

  const refresh = useCallback(() => {
    setRefreshing(true)
    fetchAllMetrics().finally(() => {
      setTimeout(() => setRefreshing(false), 600)
    })
  }, [fetchAllMetrics])

  const scrollListToTop = useCallback(() => {
    pullRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const lastTitleTapRef = useRef(0)
  const handleTitleTap = useCallback(() => {
    const now = Date.now()
    if (now - lastTitleTapRef.current < 350) {
      lastTitleTapRef.current = 0
      scrollListToTop()
      return
    }
    lastTitleTapRef.current = now
  }, [scrollListToTop])

  useEffect(() => {
    window.addEventListener('servers-tab-double-tap', scrollListToTop)
    return () => window.removeEventListener('servers-tab-double-tap', scrollListToTop)
  }, [scrollListToTop])

  useEffect(() => {
    if (connectedServers.length === 0) {
      setMetrics({})
      return
    }

    sampleRef.current = {}
    let cancelled = false
    let timer: number | undefined
    const refreshInterval = connectedServers.length > 50 ? 60000 : connectedServers.length > 20 ? 30000 : 10000
    const scheduleNextRefresh = () => {
      if (cancelled) return
      timer = window.setTimeout(async () => {
        await fetchAllMetrics()
        scheduleNextRefresh()
      }, refreshInterval)
    }

    void fetchAllMetrics().finally(scheduleNextRefresh)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [connectedServers, fetchAllMetrics])

  const handleConnect = async (server: ServerType) => {
    setMenuOpen(null)
    setConnectingId(server.id)
    if (server.password) {
      try {
        const result = await connectServer(server.id)
        showToast(result.success ? `已连接到 ${server.name}` : (result.error || '连接失败'), result.success ? 'success' : 'error')
      } finally {
        setConnectingId(null)
      }
    } else {
      const password = prompt(`输入 ${server.name} (${server.host}) 的 SSH 密码:`)
      if (password) {
        try {
          const result = await connectServer(server.id, password)
          showToast(result.success ? `已连接到 ${server.name}` : (result.error || '连接失败'), result.success ? 'success' : 'error')
        } finally {
          setConnectingId(null)
        }
      } else {
        setConnectingId(null)
      }
    }
  }

  const handleDelete = () => {
    if (deleteTarget) {
      const server = servers.find(s => s.id === deleteTarget)
      deleteServer(deleteTarget)
      showToast(`已删除服务器: ${server?.name || deleteTarget}`, 'success')
    }
    setDeleteTarget(null)
  }

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (pullRef.current && pullRef.current.scrollTop <= 0) {
      pullStartY.current = e.touches[0].clientY
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (pullRef.current && pullRef.current.scrollTop <= 0) {
      const d = e.touches[0].clientY - pullStartY.current
      if (d > 5) {
        setPulling(true)
        setPullDistance(Math.min(d * 0.5, 80))
      }
    }
  }, [])

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance > 40) {
      await refresh()
    }
    setPulling(false)
    setPullDistance(0)
  }, [pullDistance, refresh])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConfirmDialog open={!!deleteTarget} title="删除服务器"
        message={`确定要删除服务器「${servers.find(s => s.id === deleteTarget)?.name || ''}」吗？此操作不可撤销。`}
        confirmLabel="删除" danger onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />

      {editTarget && (
        <EditServerModal server={editTarget} open={!!editTarget} onClose={() => setEditTarget(null)} />
      )}

      {/* Header */}
      <div className="flex min-h-[76px] shrink-0 items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.25rem)]">
        <div className="flex items-center gap-2 min-w-0">
          <h1 onClick={handleTitleTap} title="双击回到列表顶部" className="cursor-pointer text-base font-bold text-text-primary flex-shrink-0">服务器</h1>
          {servers.length > 0 && (
            <span className="text-[11px] text-text-muted truncate">
              {servers.length} 台{connectedServers.length > 0 && ` · ${connectedServers.length} 在线`}
              {searchQuery && ` · ${filteredServers.length} 个匹配`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {connectedServers.length > 0 && (
            <button onClick={refresh} className={`p-2 rounded-xl hover:bg-white/5 transition-colors ${refreshing ? 'animate-spin' : ''}`}>
              <RefreshCw size={16} className="text-text-secondary" />
            </button>
          )}
          <button onClick={() => navigate('/add-server')} className="p-2 rounded-xl bg-primary/15 hover:bg-primary/25 transition-colors">
            <Plus size={16} className="text-primary-light" />
          </button>
        </div>
      </div>

      {/* Search and status filters */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2 glass rounded-xl px-3 ring-1 ring-white/5">
            <Search size={14} className="text-text-muted flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索服务器..."
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="p-0.5 rounded-lg hover:bg-white/10 transition-colors">
                <X size={14} className="text-text-muted" />
              </button>
            )}
          </div>
          {servers.length > 0 && (
            <div className="flex h-10 flex-shrink-0 gap-0.5 rounded-xl border border-white/[0.06] bg-white/[0.025] p-0.5">
            {(['all', 'online', 'offline'] as const).map(f => {
              const count = f === 'all' ? servers.length : f === 'online' ? servers.filter(s => isConnected(s.id)).length : servers.filter(s => !isConnected(s.id)).length
              return (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`h-full rounded-lg px-2 text-[10px] transition-colors ${
                    statusFilter === f ? 'bg-primary/20 text-primary-light font-medium' : 'text-text-muted hover:text-text-secondary hover:bg-white/5'
                  }`}>
                  {f === 'all' ? '全部' : f === 'online' ? '在线' : '离线'}
                  <span className="ml-0.5 opacity-60">{count}</span>
                </button>
              )
            })}
            </div>
          )}
        </div>
      </div>

      {/* Pull-to-refresh indicator */}
      <div className="flex justify-center overflow-hidden" style={{ height: pullDistance, opacity: pullDistance / 80, transition: pulling ? 'none' : 'height 0.2s, opacity 0.2s' }}>
        <RefreshCw size={18} className={`text-text-muted ${pulling && pullDistance > 40 ? 'animate-spin' : ''}`} />
      </div>

      {/* Server list with pull-to-refresh */}
      <div ref={pullRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4">
        {pinnedServers.length > 0 && pinnedCollapsed && (
          <button onClick={() => setPinnedCollapsed(false)} className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.035] px-3 py-2.5 text-left text-xs text-text-secondary shadow-sm transition-colors hover:border-primary/20 hover:bg-white/[0.06]">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary-light">
              <Pin size={12} />
            </span>
            <span className="flex-1 font-medium">展开置顶服务器</span>
            <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-text-muted">{pinnedServers.length}</span>
            <ChevronDown size={15} className="text-text-muted" />
          </button>
        )}
        {servers.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
              <Server size={28} className="text-text-muted" />
            </div>
            <h2 className="text-sm font-medium text-text-secondary mb-2">暂无服务器</h2>
            <p className="text-xs text-text-muted mb-4">添加服务器后即可开始监控和管理</p>
            <button onClick={() => navigate('/add-server')}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary/20 text-primary-light text-sm font-medium hover:bg-primary/30 transition-colors">
              <Plus size={14} /> 添加服务器
            </button>
          </div>
        ) : filteredServers.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3">
              <Search size={24} className="text-text-muted" />
            </div>
            <h2 className="text-sm font-medium text-text-secondary mb-1">无匹配结果</h2>
            <p className="text-xs text-text-muted">没有找到匹配「{searchQuery}」的服务器</p>
          </div>
        ) : (
          displayServers.map((server, index) => {
            const online = isConnected(server.id)
            const m = metrics[server.id]

            return (
              <Fragment key={server.id}>
              <div className="glass rounded-2xl overflow-hidden animate-slide-up">
                <button onClick={() => navigate(`/server/${server.id}`)}
                  className="w-full text-left p-3 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      online ? 'bg-gradient-to-br from-success/20 to-success/5 ring-1 ring-success/10' :
                      server.status === 'warning' ? 'bg-warning/10' : 'bg-white/5'
                    }`}>
                      {online ? <Wifi size={14} className="text-success" /> :
                       <Server size={15} className="text-text-muted" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-[13px] font-semibold text-text-primary truncate">{server.name}</h3>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${online ? 'bg-success' : 'bg-text-muted'}`} />
                      </div>
                      <p className="text-[10px] text-text-muted">{server.host}:{server.port}</p>
                    </div>

                    <div className="relative flex-shrink-0">
                      <button onClick={e => {
                        e.stopPropagation()
                        if (menuOpen === server.id) { setMenuOpen(null); return }
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
                        setMenuOpen(server.id)
                      }}
                        className="p-1 rounded-lg hover:bg-white/10 transition-colors">
                        <MoreHorizontal size={14} className="text-text-muted" />
                      </button>
                    </div>
                  </div>

{(server.tags.length > 0 || (online && m?.temp > 0)) && (
  <div className="flex gap-1.5 mt-1.5 items-center">
    {online && m?.temp > 0 && (
      <span className="flex items-center gap-0.5 text-[9px] text-text-muted px-1.5 py-px rounded-md bg-warning/10 ring-1 ring-warning/10">
        <Thermometer size={8} className="text-warning" />
        <span className="font-mono text-warning">{m.temp.toFixed(0)}°C</span>
      </span>
    )}
    {server.tags.map(tag => (
      <span key={tag} className="text-[9px] text-text-muted px-1.5 py-px rounded-md bg-white/10 ring-1 ring-white/5">
        {tag}
      </span>
    ))}
  </div>
)}

{online && m ? (
  <div className="mt-2 flex items-stretch gap-3">
    <div className="flex-[2] space-y-1.5">
      <Bar label="CPU" pct={m.cpu} color="bg-primary" />
      <Bar label="内存" pct={m.mem} color="bg-accent" />
      <Bar label="磁盘" pct={m.disk} color="bg-warning" />
    </div>
    <div className="flex-1 grid grid-cols-2 gap-x-2 gap-y-1">
      <Block label="↓" value={fmtSpeed(m.netDown)} color="text-blue-400" />
      <Block label="读" value={fmtSpeed(m.readSpeed)} />
      <Block label="↑" value={fmtSpeed(m.netUp)} color="text-green-400" />
      <Block label="写" value={fmtSpeed(m.writeSpeed)} />
    </div>
  </div>
) : online ? (
  <div className="mt-2 flex items-center gap-1 text-[10px] text-text-muted">
    <LoaderSmall /> 获取指标中...
  </div>
) : server.password ? (
  <button onClick={e => { e.stopPropagation(); handleConnect(server) }} disabled={connectingId === server.id}
    className="mt-2 w-full py-1.5 rounded-lg bg-primary/10 text-primary-light text-[11px] font-medium hover:bg-primary/20 transition-colors disabled:opacity-70 flex items-center justify-center gap-1">
    {connectingId === server.id ? <Loader2 size={11} className="animate-spin" /> : <Wifi size={11} />} {connectingId === server.id ? '连接中...' : '点击连接'}
  </button>
) : (
  <p className="mt-2 text-[10px] text-text-muted text-center">离线 · 需要密码连接</p>
)}
                </button>
              </div>
              {pinnedServers.length > 0 && !pinnedCollapsed && server.pinned && index === pinnedServers.length - 1 && (
                <button onClick={() => setPinnedCollapsed(true)} className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.035] px-3 py-2.5 text-left text-xs text-text-secondary shadow-sm transition-colors hover:border-primary/20 hover:bg-white/[0.06]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary-light">
                    <Pin size={12} />
                  </span>
                  <span className="flex-1 font-medium">折叠置顶服务器</span>
                  <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-text-muted">{pinnedServers.length}</span>
                  <ChevronDown size={15} className="rotate-180 text-text-muted" />
                </button>
              )}
              </Fragment>
            )
          })
        )
      }
      </div>

      {/* Action menu portal */}
      {menuOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setMenuOpen(null)} />
          <div className="fixed z-[111] glass rounded-xl py-1.5 min-w-[130px] animate-fade-in shadow-xl border border-white/5"
            style={{ top: menuPos.top, right: menuPos.right }}>
            {(() => {
              const srv = servers.find(s => s.id === menuOpen)
              const online = isConnected(menuOpen)
              if (!srv) return null
              return (
                <>
                  {!online && (
                    <button onClick={() => { handleConnect(srv); setMenuOpen(null) }} disabled={connectingId === srv.id}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-success hover:bg-white/5 transition-colors disabled:opacity-70">
                      {connectingId === srv.id ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />} {connectingId === srv.id ? '连接中...' : '连接'}
                    </button>
                  )}
                  <button onClick={() => { updateServer(srv.id, { pinned: !srv.pinned }); setMenuOpen(null) }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-primary-light hover:bg-white/5 transition-colors">
                    <Pin size={12} /> {srv.pinned ? '取消置顶' : '置顶服务器'}
                  </button>
                  <button onClick={() => { setMenuOpen(null); setEditTarget(srv) }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-primary-light hover:bg-white/5 transition-colors">
                    <Edit3 size={12} /> 编辑
                  </button>
                  <button onClick={() => { setMenuOpen(null); navigate(`/server/${srv.id}`) }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-text-secondary hover:bg-white/5 transition-colors">
                    <Zap size={12} /> 详情
                  </button>
                  <button onClick={() => { setMenuOpen(null); setDeleteTarget(srv.id) }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-danger hover:bg-danger/5 transition-colors">
                    <Trash2 size={12} /> 删除
                  </button>
                </>
              )
            })()}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  const w = Math.min(100, Math.max(0, pct))
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-text-muted w-7 flex-shrink-0">{label}</span>
      <div className="flex-1 h-3 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${w}%` }} />
      </div>
      <span className="text-[10px] font-mono text-text-secondary w-7 text-right flex-shrink-0">{w.toFixed(0)}%</span>
    </div>
  )
}

function Block({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-[9px] text-text-muted">{label}</p>
      <p className={`text-[10px] font-mono font-medium ${color || 'text-text-secondary'}`}>{value}</p>
    </div>
  )
}

function LoaderSmall() {
  return (
    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function fmtSpeed(kbps: number): string {
  if (kbps >= 1024 * 1024) return `${(kbps / 1024 / 1024).toFixed(1)}G`
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)}M`
  if (kbps >= 10) return `${kbps.toFixed(0)}K`
  if (kbps > 0) return `${kbps.toFixed(1)}K`
  return '0'
}
