import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, ArrowDown, ArrowUp } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import MiniRing from '../components/dashboard/MiniRing'
import { useServers } from '../store/ServerContext'

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

export default function Dashboard() {
  const navigate = useNavigate()
  const { servers, execCommand, isConnected } = useServers()
  const [refreshing, setRefreshing] = useState(false)
  const [metrics, setMetrics] = useState<Record<string, ServerMetrics>>({})
  const sampleRef = useRef<Record<string, SampleCache>>({})

  const connectedServers = servers.filter(s => isConnected(s.id))

  const fetchAllMetrics = useCallback(async () => {
    if (connectedServers.length === 0) return
    const newMetrics: Record<string, ServerMetrics> = {}
    const now = Date.now()

    for (const s of connectedServers) {
      try {
        const [cpuOut, memOut, dfOut, tempOut, ioOut, netOut] = await Promise.all([
          execCommand(s.id, 'top -bn1 2>/dev/null | head -5'),
          execCommand(s.id, 'free -m'),
          execCommand(s.id, 'df -h / | tail -1'),
          execCommand(s.id, 'cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0'),
          execCommand(s.id, 'cat /proc/diskstats'),
          execCommand(s.id, 'cat /proc/net/dev'),
        ])

        const base: ServerMetrics = {
          cpu: parseCpuUsage(cpuOut),
          mem: parseMemInfo(memOut),
          disk: parseDiskInfo(dfOut),
          temp: parseTemp(tempOut),
          readSpeed: 0, writeSpeed: 0, netDown: 0, netUp: 0,
        }

        // Parse disk I/O: sum read sectors (field 6) and write sectors (field 10)
        let readSectors = 0, writeSectors = 0
        for (const line of ioOut.split('\n')) {
          const cols = line.trim().split(/\s+/)
          if (cols.length >= 10) {
            readSectors += parseInt(cols[5]) || 0
            writeSectors += parseInt(cols[9]) || 0
          }
        }

        // Parse network: sum rx (field 2) and tx (field 10) excluding lo
        let netRx = 0, netTx = 0
        for (const line of netOut.split('\n')) {
          const cols = line.trim().split(/\s+/)
          if (cols.length >= 10 && cols[0] !== 'lo:') {
            netRx += parseInt(cols[1]) || 0
            netTx += parseInt(cols[9]) || 0
          }
        }

        const prev = sampleRef.current[s.id]
        if (prev && prev.timestamp > 0) {
          const elapsed = (now - prev.timestamp) / 1000
          if (elapsed > 0) {
            base.readSpeed = Math.max(0, (readSectors - prev.readSectors) * 512 / 1024 / elapsed)
            base.writeSpeed = Math.max(0, (writeSectors - prev.writeSectors) * 512 / 1024 / elapsed)
            base.netDown = Math.max(0, (netRx - prev.netRx) / 1024 / elapsed)
            base.netUp = Math.max(0, (netTx - prev.netTx) / 1024 / elapsed)
          }
        }

        sampleRef.current[s.id] = { readSectors, writeSectors, netRx, netTx, timestamp: now }
        newMetrics[s.id] = base
      } catch {}
    }
    setMetrics(newMetrics)
  }, [connectedServers, execCommand])

  const refresh = useCallback(() => {
    setRefreshing(true)
    fetchAllMetrics().finally(() => {
      setTimeout(() => setRefreshing(false), 600)
    })
  }, [fetchAllMetrics])

  useEffect(() => {
    if (connectedServers.length > 0) {
      sampleRef.current = {}
      refresh()
      const timer = setInterval(refresh, 10000)
      return () => clearInterval(timer)
    } else {
      setMetrics({})
    }
  }, [connectedServers.length])

  return (
    <div className="pb-24">
      <PageHeader
        title="Server Monitor"
        subtitle={connectedServers.length > 0 ? `${connectedServers.length} 台已连接` : '添加服务器开始监控'}
        action={
          <div className="flex items-center gap-1">
            <button onClick={refresh} className={`p-1.5 rounded-xl hover:bg-white/5 transition-colors ${refreshing ? 'animate-spin' : ''}`}>
              <RefreshCw size={18} className="text-text-secondary" />
            </button>
            <button onClick={() => navigate('/add-server')} className="p-1.5 rounded-xl hover:bg-white/5 transition-colors">
              <Plus size={18} className="text-text-secondary" />
            </button>
          </div>
        }
      />

      <div className="px-4 space-y-3">
        {servers.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center animate-slide-up">
            <p className="text-text-muted text-sm mb-3">还没有添加服务器</p>
            <button onClick={() => navigate('/add-server')}
              className="px-4 py-2 bg-primary/15 text-primary-light rounded-xl text-sm font-medium hover:bg-primary/25 transition-colors">
              添加第一台服务器
            </button>
          </div>
        ) : (
          servers.map(server => {
            const m = metrics[server.id]
            const online = isConnected(server.id)
            return (
              <button
                key={server.id}
                onClick={() => navigate(`/server/${server.id}`)}
                className="glass card-gradient rounded-2xl p-4 w-full text-left hover:scale-[0.98] transition-transform animate-slide-up"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${online ? 'bg-success' : 'bg-text-muted'}`} />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-text-primary truncate">{server.name}</h3>
                      <p className="text-[10px] text-text-muted truncate">{server.host}:{server.port}</p>
                    </div>
                  </div>
                  {online && m && (
                    <span className="text-[10px] text-text-muted">{m.temp > 0 ? `${m.temp.toFixed(0)}°C` : ''}</span>
                  )}
                </div>

                {online && m ? (
                  <>
                    <div className="flex justify-around mb-3">
                      <MiniRing value={m.cpu} label="CPU" color="text-primary" />
                      <MiniRing value={m.mem} label="内存" color="text-accent" />
                      <MiniRing value={m.disk} label="磁盘" color="text-success" />
                    </div>
                    <div className="flex justify-center gap-5">
                      <SpeedItem label="读" value={m.readSpeed} color="text-warning" icon={<ArrowDown size={11} />} />
                      <SpeedItem label="写" value={m.writeSpeed} color="text-danger" icon={<ArrowUp size={11} />} />
                      <SpeedItem label="↓" value={m.netDown} color="text-accent" icon={null} />
                      <SpeedItem label="↑" value={m.netUp} color="text-primary-light" icon={null} />
                    </div>
                  </>
                ) : (
                  <div className="flex justify-around">
                    <MiniRing value={0} label="CPU" color="text-text-muted" />
                    <MiniRing value={0} label="内存" color="text-text-muted" />
                    <MiniRing value={0} label="磁盘" color="text-text-muted" />
                  </div>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function SpeedItem({ label, value, color, icon }: {
  label: string; value: number; color: string; icon: React.ReactNode
}) {
  const display = value >= 1024
    ? { v: value / 1024, u: 'MB/s' }
    : { v: value, u: 'KB/s' }
  return (
    <div className="flex items-center gap-1">
      {icon && <span className={color}>{icon}</span>}
      <span className="text-[10px] text-text-muted">{label}</span>
      <span className={`text-[11px] font-mono font-medium ${color}`}>{display.v.toFixed(1)}</span>
      <span className="text-[9px] text-text-muted">{display.u}</span>
    </div>
  )
}
