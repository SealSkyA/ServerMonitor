import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, Wifi, WifiOff, Terminal, FolderOpen, Layers, Trash2, RefreshCw, Activity, Cpu, HardDrive, Globe, Monitor, AlertTriangle, CheckCircle2 } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import MiniRing from '../components/dashboard/MiniRing'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useServers } from '../store/ServerContext'
import { useToast } from '../components/ui/Toast'

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

function parseMemInfo(output: string): { total: number; used: number; usagePercent: number } {
  const mem = output.split('\n').find(l => l.startsWith('Mem:'))
  if (mem) {
    const p = mem.trim().split(/\s+/)
    if (p.length >= 3) {
      const total = parseFloat(p[1]) || 1
      const used = parseFloat(p[2]) || 0
      return { total: total * 1024, used: used * 1024, usagePercent: (used / total) * 100 }
    }
  }
  return { total: 0, used: 0, usagePercent: 0 }
}

interface DiskInfo {
  mount: string; size: string; used: string; avail: string; pct: number
}

interface DiskHealth {
  device: string; status: string; temperature: number
}

interface DetailMetrics {
  cpu: number; cpuModel: string; cpuCores: string; cpuFreq: string
  mem: { total: number; used: number; usagePercent: number }
  disk: number; diskUsed: string; diskTotal: string
  disks: DiskInfo[]
  diskHealth: DiskHealth[]
  temp: number
  readSpeed: number; writeSpeed: number
  netDown: number; netUp: number
  uptime: string
  loadAvg: number[]
  osInfo: string; kernelInfo: string
  localIp: string; publicIp: string
}

interface SampleCache {
  readSectors: number; writeSectors: number
  netRx: number; netTx: number
  timestamp: number
}

function parseKeyValue(out: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z]+):(.*)$/)
    if (m) map[m[1]] = m[2]
  }
  return map
}

function parseDiskSections(out: string) {
  const before = out.split('===ALLDISKS===')[0] || ''
  const rest = out.substring(before.length)
  const allDisks = extractSection(rest, '===ALLDISKS===', '===DISKHLTH===')
  const diskHealth = extractSection(rest, '===DISKHLTH===', '===DISKSTATS===')
  let diskstats = extractSection(rest, '===DISKSTATS===', '===NETDEV===')
  const netdev = extractSection(rest, '===NETDEV===', '===DONE===')
  if (!diskstats) diskstats = extractSection(rest, '===DISKSTATS===', '===DONE===')
  return { before, allDisks, diskHealth, diskstats, netdev }
}

function parseDiskHealth(out: string): DiskHealth[] {
  return out.split('\n').map(line => {
    const [device = '', status = '', temp = ''] = line.trim().split('|')
    return { device, status, temperature: parseInt(temp) || 0 }
  }).filter(({ device, status }) => device && status && status !== 'N/A')
}

function isDiskHealthy(status: string): boolean {
  return /\b(PASSED|OK|GOOD)\b/i.test(status)
}

function extractSection(text: string, start: string, end: string): string {
  const si = text.indexOf(start)
  if (si < 0) return ''
  const startIdx = si + start.length
  const ei = text.indexOf(end, startIdx)
  if (ei < 0) return text.substring(startIdx)
  return text.substring(startIdx, ei)
}

export default function ServerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { servers, deleteServer, isConnected, connectServer, disconnectServer, execCommand } = useServers()
  const { showToast } = useToast()
  const server = servers.find(s => s.id === id)
  const connected = isConnected(id || '')
  const [showDelete, setShowDelete] = useState(false)
  const [metrics, setMetrics] = useState<DetailMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const sampleRef = useRef<SampleCache>({ readSectors: 0, writeSectors: 0, netRx: 0, netTx: 0, timestamp: 0 })
  const fetchRef = useRef<() => Promise<void>>(async () => {})
  const mountedRef = useRef(true)
  const requestVersionRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastScrollTopRef = useRef(0)
  const navHiddenRef = useRef(false)
  const actionDragRef = useRef({ startX: 0, startY: 0, startScrollLeft: 0, horizontal: false })

  const handleScroll = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop || 0
    const delta = scrollTop - lastScrollTopRef.current
    const shouldHideNav = scrollTop > 16 && delta > 8
    const shouldShowNav = scrollTop <= 16 || delta < -8

    if ((shouldHideNav && !navHiddenRef.current) || (shouldShowNav && navHiddenRef.current)) {
      navHiddenRef.current = shouldHideNav
      window.dispatchEvent(new CustomEvent('detail-nav-visibility', { detail: shouldHideNav }))
    }
    lastScrollTopRef.current = scrollTop
  }, [])

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('detail-nav-visibility', { detail: false }))
  }, [])

  const handleActionPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    actionDragRef.current = { startX: event.clientX, startY: event.clientY, startScrollLeft: target.scrollLeft, horizontal: false }
  }, [])

  const handleActionPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = actionDragRef.current
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.horizontal && Math.abs(deltaX) > 6 && Math.abs(deltaX) > Math.abs(deltaY)) drag.horizontal = true
    if (drag.horizontal) {
      event.currentTarget.scrollLeft = drag.startScrollLeft - deltaX
      event.preventDefault()
    }
  }, [])

  const fetchData = useCallback(async () => {
    if (!id || !isConnected(id)) return
    const requestVersion = ++requestVersionRef.current
    const serverId = id
    setLoading(true)
    try {
      const now = Date.now()

      const sysScript = [
        'echo "CORES:$(nproc)"',
        'CPU_MODEL=$(lscpu 2>/dev/null | awk -F: \'/^Model name:|^Model:/ {gsub(/^[[:space:]]+/, "", $2); print $2; exit}\'); [ -n "$CPU_MODEL" ] || CPU_MODEL=$(awk -F: \'/^(model name|Hardware|Processor|cpu model|CPU part)[[:space:]]*:/ {gsub(/^[[:space:]]+/, "", $2); print $2; exit}\' /proc/cpuinfo 2>/dev/null); echo "MODEL:${CPU_MODEL:-$(uname -m)}"',
        'CPU_FREQ=$(lscpu 2>/dev/null | awk -F: \'/^CPU max MHz:|^CPU MHz:/ {gsub(/^[[:space:]]+/, "", $2); print $2; exit}\'); [ -n "$CPU_FREQ" ] || CPU_FREQ=$(awk \'{if ($1 > max) max=$1} END {if (max) printf "%.0f", max / 1000}\' /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq 2>/dev/null); echo "FREQ:$CPU_FREQ"',
        'echo "UNAME:$(uname -srm)"',
        'echo "KVER:$(uname -r)"',
        'echo "UPTIME:$(uptime -p 2>/dev/null || uptime 2>/dev/null | awk -F\'up\' \'{print $2}\' | awk -F\',\' \'{print $1}\')"',
        'echo "LOAD:$(cat /proc/loadavg)"',
        'echo "TEMP:$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)"',
        'echo "PUBIP:$(curl -s --max-time 4 ifconfig.me 2>/dev/null || curl -s --max-time 4 icanhazip.com 2>/dev/null || echo \'-\')"',
        'echo "LOCALIP:$(hostname -I 2>/dev/null | awk \'{print $1}\')"',
      ].join(';')

      const diskScript = [
        'df -h / 2>/dev/null | tail -1',
        'echo "===ALLDISKS==="',
        'df -h 2>/dev/null | grep "^/dev/"',
        'echo "===DISKHLTH==="',
        'for d in /dev/sd? /dev/vd? /dev/nvme?n?; do if [ -e "$d" ]; then SMART=$(timeout 3 smartctl -H -A "$d" 2>/dev/null); HEALTH=$(printf "%s\\n" "$SMART" | awk -F: \'/SMART overall-health self-assessment test result|SMART Health Status/ {gsub(/^[[:space:]]+/, "", $2); print $2; exit}\'); TEMP=$(printf "%s\\n" "$SMART" | awk \'/Temperature_Celsius|Temperature_Internal/ {print $10; exit} /^[[:space:]]*Temperature:/ {for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) {print $i; exit}}\'); echo "$d|${HEALTH:-N/A}|$TEMP"; fi; done',
        'echo "===DISKSTATS==="',
        'cat /proc/diskstats',
        'echo "===NETDEV==="',
        'cat /proc/net/dev',
        'echo "===DONE==="',
      ].join(';')

      const tasks = [
        execCommand(serverId, 'top -bn1 2>/dev/null | head -5'),
        execCommand(serverId, 'free -m'),
        execCommand(serverId, sysScript),
        execCommand(serverId, diskScript),
      ]

      const safes = await Promise.all(tasks.map(p => p.catch((e: any) => `ERROR: ${e?.message || e}`)))

      if (!mountedRef.current || requestVersion !== requestVersionRef.current) return

      const [cpuOut, memOut, sysOut, diskOut] = safes

      const cpu = parseCpuUsage(cpuOut)
      const mem = parseMemInfo(memOut)
      const sysMap = parseKeyValue(sysOut)
      const { before, allDisks, diskHealth, diskstats, netdev } = parseDiskSections(diskOut)

      const dfParts = before.trim().split(/\s+/)
      const diskPct = dfParts.length >= 5 ? parseInt(dfParts[4].replace('%', '')) || 0 : 0
      const diskUsed = dfParts.length >= 3 ? dfParts[2] : '-'
      const diskTotal = dfParts.length >= 2 ? dfParts[1] : '-'
      const temp = parseInt(sysMap.TEMP || '0') || 0
      const tempC = temp > 1000 ? temp / 1000 : (temp > 200 ? temp : temp)
      const loads = (sysMap.LOAD || '').trim().split(/\s+/).slice(0, 3).map(Number)

      let readSectors = 0, writeSectors = 0
      for (const line of diskstats.split('\n')) {
        const cols = line.trim().split(/\s+/)
        if (cols.length >= 10) { readSectors += parseInt(cols[5]) || 0; writeSectors += parseInt(cols[9]) || 0 }
      }
      let netRx = 0, netTx = 0
      for (const line of netdev.split('\n')) {
        const cols = line.trim().split(/\s+/)
        if (cols.length >= 10 && !cols[0].includes('lo')) { netRx += parseInt(cols[1]) || 0; netTx += parseInt(cols[9]) || 0 }
      }
      let readSpeed = 0, writeSpeed = 0, netDown = 0, netUp = 0
      const prev = sampleRef.current
      if (prev.timestamp > 0) {
        const elapsed = (now - prev.timestamp) / 1000
        if (elapsed > 0) {
          readSpeed = Math.max(0, (readSectors - prev.readSectors) * 512 / 1024 / elapsed)
          writeSpeed = Math.max(0, (writeSectors - prev.writeSectors) * 512 / 1024 / elapsed)
          netDown = Math.max(0, (netRx - prev.netRx) / 1024 / elapsed)
          netUp = Math.max(0, (netTx - prev.netTx) / 1024 / elapsed)
        }
      }
      sampleRef.current = { readSectors, writeSectors, netRx, netTx, timestamp: now }

      setMetrics({
        cpu,
        cpuModel: (sysMap.MODEL || '').trim(),
        cpuCores: (sysMap.CORES || '').trim(),
        cpuFreq: (sysMap.FREQ || '').trim(),
        mem,
        disk: diskPct, diskUsed, diskTotal,
        disks: allDisks.trim().split('\n').filter(l => l.trim()).slice(0, 8).map(line => {
          const p = line.trim().split(/\s+/)
          return { mount: p[5] || p[0] || '?', size: p[1] || '-', used: p[2] || '-', avail: p[3] || '-', pct: parseInt(p[4]?.replace('%', '')) || 0 }
        }),
        diskHealth: parseDiskHealth(diskHealth),
        temp: tempC, readSpeed, writeSpeed, netDown, netUp,
        uptime: (sysMap.UPTIME || '').trim().replace(/^up\s*/, ''),
        loadAvg: loads.length === 3 ? loads : [0, 0, 0],
        osInfo: (sysMap.UNAME || '').trim(),
        kernelInfo: (sysMap.KVER || '').trim(),
        localIp: (sysMap.LOCALIP || '').trim(),
        publicIp: (sysMap.PUBIP || '').trim(),
      })
    } catch (e) { console.error(e) }
    finally {
      if (mountedRef.current && requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [id, execCommand])

  fetchRef.current = fetchData

  useEffect(() => {
    mountedRef.current = true
    sampleRef.current = { readSectors: 0, writeSectors: 0, netRx: 0, netTx: 0, timestamp: 0 }
    fetchData()
    let timer: ReturnType<typeof setInterval> | null = null
    if (connected) {
      timer = setInterval(() => fetchRef.current(), 8000)
    }
    return () => {
      mountedRef.current = false
      requestVersionRef.current++
      if (timer) clearInterval(timer)
    }
  }, [connected, fetchData])

  const handleConnect = async () => {
    if (!server) return
    if (server.password) {
      const result = await connectServer(server.id)
      showToast(result.success ? 'SSH 连接成功' : (result.error || 'SSH 连接失败'), result.success ? 'success' : 'error')
    } else if (server.authType === 'password') {
      const pwd = prompt(`输入 ${server.name} 的 SSH 密码:`)
      if (pwd) {
        const result = await connectServer(server.id, pwd)
        showToast(result.success ? 'SSH 连接成功' : (result.error || 'SSH 连接失败'), result.success ? 'success' : 'error')
      }
    } else {
      showToast('密钥认证暂不支持', 'info')
    }
  }

  const handleDelete = () => {
    if (!id) return
    deleteServer(id)
    showToast('服务器已删除', 'success')
    navigate('/')
  }

  if (!server) {
    return (
      <div className="p-8 text-center flex flex-col items-center gap-4 min-h-[60vh] justify-center">
        <p className="text-text-muted text-lg">服务器未找到</p>
        <button onClick={() => navigate('/')} className="px-4 py-2 bg-primary/15 text-primary-light rounded-xl text-sm font-medium">返回首页</button>
      </div>
    )
  }

  const m = metrics

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto overscroll-y-contain pb-6">
      <PageHeader title={server.name} subtitle={server.host + ':' + server.port} backTo="/"
        action={
          <div className="flex items-center gap-1">
            <button onClick={fetchData} className={`p-1.5 rounded-xl hover:bg-white/5 transition-colors ${loading ? 'animate-spin' : ''}`}>
              <RefreshCw size={16} className="text-text-secondary" />
            </button>
            <button onClick={() => navigate(`/terminal/${server.id}`)} className="p-1.5 rounded-xl hover:bg-white/5 transition-colors">
              <Terminal size={16} className="text-text-secondary" />
            </button>
            <button onClick={() => setShowDelete(true)} className="p-1.5 rounded-xl hover:bg-white/5 transition-colors">
              <Trash2 size={16} className="text-danger/70" />
            </button>
          </div>
        }
      />

      <div className="px-4 space-y-3">
        <div onPointerDown={handleActionPointerDown} onPointerMove={handleActionPointerMove} className="-mx-4 flex snap-x snap-mandatory items-center gap-2 overflow-x-scroll px-4 animate-slide-up scrollbar-hide touch-pan-x overscroll-x-contain">
          <button
            onClick={connected ? () => { disconnectServer(server.id); showToast('已断开连接', 'info') } : handleConnect}
            className={`flex snap-start items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-colors flex-shrink-0 ${
              connected ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-primary/15 text-primary-light hover:bg-primary/25'
            }`}>
            {connected ? <><WifiOff size={14} /> 断开</> : <><Wifi size={14} /> 连接</>}
          </button>
          {connected && <>
            <button onClick={() => navigate(`/terminal/${server.id}`)} className="flex snap-start items-center gap-1.5 px-4 py-2.5 glass rounded-xl text-xs text-text-secondary hover:bg-white/5 flex-shrink-0">
              <Terminal size={14} /> 终端</button>
            <button onClick={() => navigate(`/files/${server.id}`)} className="flex snap-start items-center gap-1.5 px-4 py-2.5 glass rounded-xl text-xs text-text-secondary hover:bg-white/5 flex-shrink-0">
              <FolderOpen size={14} /> 文件</button>
            <button onClick={() => navigate(`/services/${server.id}`)} className="flex snap-start items-center gap-1.5 px-4 py-2.5 glass rounded-xl text-xs text-text-secondary hover:bg-white/5 flex-shrink-0">
              <Layers size={14} /> 服务</button>
          </>}
        </div>

        {m && connected ? (
          <>
            {/* Resource rings */}
            <div className="glass rounded-2xl p-4 animate-slide-up">
              <div className="flex justify-around">
                <MiniRing value={m.cpu} label="CPU" color="text-primary" size={72} />
                <MiniRing value={m.mem.usagePercent} label="内存" color="text-accent" size={72} />
                <MiniRing value={m.disk} label="磁盘" color="text-success" size={72} />
              </div>
              <div className="text-center mt-3">
                <p className="text-[11px] text-text-muted">
                  内存 {formatSize(m.mem.used)}/{formatSize(m.mem.total)} · 负载 {m.loadAvg.map(v => v.toFixed(1)).join('/')}
                </p>
              </div>
            </div>

            {/* 系统信息 */}
            <SectionCard icon={<Monitor size={15} />} title="系统信息" color="text-accent">
              <div className="space-y-2 text-xs">
                <InfoLine label="系统" value={m.osInfo || '-'} />
                <InfoLine label="内核" value={m.kernelInfo || '-'} />
                <InfoLine label="运行时长" value={m.uptime || '-'} />
                <InfoLine label="温度" value={m.temp > 0 ? `${m.temp.toFixed(0)}°C` : '-'} />
              </div>
            </SectionCard>

            {/* CPU Info */}
            <SectionCard icon={<Cpu size={15} />} title="CPU 信息" color="text-primary">
              <div className="space-y-2 text-xs">
                <InfoLine label="型号" value={m.cpuModel || '-'} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <InfoLine label="核心数" value={m.cpuCores || '-'} />
                  <InfoLine label="频率" value={m.cpuFreq ? `${m.cpuFreq} MHz` : '-'} />
                </div>
                <InfoLine label="平均负载" value={m.loadAvg.map(v => v.toFixed(1)).join(' / ')} />
              </div>
            </SectionCard>

            {/* 磁盘信息 */}
            <SectionCard icon={<HardDrive size={15} />} title="磁盘" color="text-warning">
              <p className="text-xs text-text-muted mb-2 break-all">/ 根分区: 已用 {m.diskUsed}B / 总共 {m.diskTotal}B ({m.disk}%)</p>
              <div className="space-y-1.5">
                {m.disks.map(d => (
                  <div key={d.mount} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-text-secondary break-all min-w-0">{d.mount}</span>
                    <span className="text-text-muted flex-shrink-0">{d.used}B/{d.size}B</span>
                    <span className={`font-medium flex-shrink-0 ${d.pct > 90 ? 'text-danger' : d.pct > 70 ? 'text-warning' : 'text-text-primary'}`}>{d.pct}%</span>
                  </div>
                ))}
              </div>
              {m.diskHealth.length > 0 && (
                <div className="mt-2 space-y-1.5 pt-2 border-t border-white/5">
                  {m.diskHealth.map(health => {
                    const healthy = isDiskHealthy(health.status)
                    return (
                      <div key={health.device} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-text-secondary font-mono break-all">{health.device}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {health.temperature > 0 && <span className="text-text-muted">{health.temperature}°C</span>}
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${healthy ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                            {healthy ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                            {healthy ? '正常' : health.status}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </SectionCard>

            {/* I/O 速度 */}
            <div className="glass rounded-2xl p-4 animate-slide-up">
              <div className="space-y-3">
                <DetailRow icon={<ArrowDown size={14} />} label="磁盘读取" value={formatSpeed(m.readSpeed)} color="text-primary-light" bg="bg-primary/10" />
                <DetailRow icon={<ArrowUp size={14} />} label="磁盘写入" value={formatSpeed(m.writeSpeed)} color="text-danger" bg="bg-danger/10" />
              </div>
            </div>

            {/* 网络信息 */}
            <SectionCard icon={<Globe size={15} />} title="网络" color="text-info">
              <div className="space-y-2 text-xs">
                <InfoLine label="本机 IP" value={m.localIp || '-'} />
                <InfoLine label="公网 IP" value={m.publicIp === '-' ? '无法获取' : m.publicIp} />
                <div className="pt-2 border-t border-white/5 grid grid-cols-2 gap-x-4 gap-y-2">
                  <InfoLine label="下载" value={formatSpeed(m.netDown)} />
                  <InfoLine label="上传" value={formatSpeed(m.netUp)} />
                </div>
              </div>
            </SectionCard>

            {/* Tags & system info chips */}
            <div className="flex flex-wrap gap-2 animate-slide-up">
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-white/5 text-text-muted border border-border/30">{server.username}@{server.host}:{server.port}</span>
            </div>
          </>
        ) : (
          <div className="glass rounded-2xl p-8 text-center animate-slide-up">
            <Activity size={28} className="text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary text-sm">{connected ? '正在获取数据...' : '请先连接服务器'}</p>
          </div>
        )}
      </div>

      <ConfirmDialog open={showDelete} title="删除服务器" message={`确定要删除「${server.name}」吗？`} confirmLabel="删除" danger
        onConfirm={handleDelete} onCancel={() => setShowDelete(false)} />
    </div>
  )
}

function SectionCard({ icon, title, color, children }: {
  icon: React.ReactNode; title: string; color: string; children: React.ReactNode
}) {
  return (
    <div className="glass rounded-2xl p-4 animate-slide-up">
      <div className={`flex items-center gap-2 mb-3 ${color}`}>
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-text-muted flex-shrink-0">{label}</span>
      <span className="text-text-primary font-mono break-all">{value}</span>
    </div>
  )
}

function DetailRow({ icon, label, value, color, bg }: {
  icon: React.ReactNode; label: string; value: string; color: string; bg: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
          <span className={color}>{icon}</span>
        </div>
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <span className={`text-sm font-medium ${value === '-' ? 'text-text-muted' : color}`}>{value}</span>
    </div>
  )
}

function formatSize(kb: number): string {
  if (kb > 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`
  if (kb > 1024) return `${(kb / 1024).toFixed(0)}M`
  return `${kb.toFixed(0)}K`
}

function formatSpeed(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`
  return `${kbps.toFixed(1)} KB/s`
}
