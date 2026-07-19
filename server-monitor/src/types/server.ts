export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'key'
  password?: string
  jumpServerId?: string
  status: 'online' | 'offline' | 'warning'
  os: string
  uptime: string
  tags: string[]
  lastChecked: string
  pinned?: boolean
}

export interface CpuInfo {
  usage: number
  cores: number
  temperature: number
  model: string
}

export interface MemoryInfo {
  total: number
  used: number
  free: number
  usagePercent: number
}

export interface DiskInfo {
  mount: string
  total: number
  used: number
  free: number
  usagePercent: number
}

export interface NetworkInfo {
  interface: string
  rxSpeed: number
  txSpeed: number
  rxTotal: number
  txTotal: number
}

export interface SystemInfo {
  cpu: CpuInfo
  memory: MemoryInfo
  disks: DiskInfo[]
  network: NetworkInfo[]
  loadAvg: number[]
  processes: number
}

export interface ChartDataPoint {
  time: string
  value: number
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: 'running' | 'stopped' | 'paused'
  ports: string[]
  cpuPercent: number
  memoryPercent: number
}

export interface Process {
  pid: number
  name: string
  user: string
  cpuPercent: number
  memoryPercent: number
  state: string
}

export interface FileItem {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modified: string
  permissions: string
}

export interface ServiceStatus {
  name: string
  status: 'active' | 'inactive' | 'failed'
  description: string
}
