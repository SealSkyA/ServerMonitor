import type { SystemInfo, ChartDataPoint, DockerContainer, Process, FileItem, ServiceStatus } from '../types/server'

export function generateSystemInfo(): SystemInfo {
  const cpuUsage = 20 + Math.random() * 50
  const memTotal = 16384
  const memUsed = 4000 + Math.random() * 8000

  return {
    cpu: {
      usage: cpuUsage,
      cores: 8,
      temperature: 42 + Math.random() * 25,
      model: 'Intel Xeon E5-2680 v4 @ 2.40GHz',
    },
    memory: {
      total: memTotal,
      used: memUsed,
      free: memTotal - memUsed,
      usagePercent: (memUsed / memTotal) * 100,
    },
    disks: [
      {
        mount: '/',
        total: 256000,
        used: 80000 + Math.random() * 40000,
        free: 0,
        usagePercent: 0,
      },
      {
        mount: '/data',
        total: 1024000,
        used: 300000 + Math.random() * 200000,
        free: 0,
        usagePercent: 0,
      },
    ],
    network: [
      {
        interface: 'eth0',
        rxSpeed: Math.random() * 100,
        txSpeed: Math.random() * 80,
        rxTotal: 1024 * 1024 * 500,
        txTotal: 1024 * 1024 * 300,
      },
    ],
    loadAvg: [0.5 + Math.random() * 2, 0.4 + Math.random() * 1.5, 0.3 + Math.random()],
    processes: Math.floor(200 + Math.random() * 50),
  }
}

export function generateChartData(min: number, max: number, points: number = 20): ChartDataPoint[] {
  let value = min + Math.random() * (max - min)
  return Array.from({ length: points }, (_, i) => {
    value += (Math.random() - 0.5) * (max - min) * 0.3
    value = Math.max(min, Math.min(max, value))
    const now = new Date()
    now.setSeconds(now.getSeconds() - (points - i) * 3)
    return {
      time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      value: Math.round(value * 10) / 10,
    }
  })
}

export const mockDockerContainers: DockerContainer[] = [
  { id: '1', name: 'nginx-proxy', image: 'nginx:1.25', status: 'running', ports: ['80:80', '443:443'], cpuPercent: 2.3, memoryPercent: 1.8 },
  { id: '2', name: 'redis-cache', image: 'redis:7-alpine', status: 'running', ports: ['6379:6379'], cpuPercent: 0.8, memoryPercent: 3.2 },
  { id: '3', name: 'postgres-db', image: 'postgres:16', status: 'running', ports: ['5432:5432'], cpuPercent: 5.1, memoryPercent: 12.4 },
  { id: '4', name: 'node-api', image: 'node:22-alpine', status: 'running', ports: ['3000:3000'], cpuPercent: 8.7, memoryPercent: 6.5 },
  { id: '5', name: 'prometheus', image: 'prom/prometheus', status: 'running', ports: ['9090:9090'], cpuPercent: 1.5, memoryPercent: 4.1 },
  { id: '6', name: 'grafana', image: 'grafana/grafana', status: 'stopped', ports: ['3001:3000'], cpuPercent: 0, memoryPercent: 0 },
]

export const mockProcesses: Process[] = [
  { pid: 1, name: 'systemd', user: 'root', cpuPercent: 0.0, memoryPercent: 0.2, state: 'S' },
  { pid: 842, name: 'nginx', user: 'www-data', cpuPercent: 1.2, memoryPercent: 0.8, state: 'S' },
  { pid: 1024, name: 'postgres', user: 'postgres', cpuPercent: 3.5, memoryPercent: 8.2, state: 'S' },
  { pid: 1567, name: 'node', user: 'app', cpuPercent: 6.8, memoryPercent: 4.5, state: 'R' },
  { pid: 2034, name: 'redis-server', user: 'redis', cpuPercent: 0.5, memoryPercent: 2.1, state: 'S' },
  { pid: 2891, name: 'sshd', user: 'root', cpuPercent: 0.1, memoryPercent: 0.3, state: 'S' },
  { pid: 3456, name: 'prometheus', user: 'prometheus', cpuPercent: 1.1, memoryPercent: 3.4, state: 'S' },
]

export const mockFiles: FileItem[] = [
  { name: 'docker-compose.yml', type: 'file', size: 2048, modified: '2026-07-05', permissions: '-rw-r--r--' },
  { name: 'nginx/', type: 'directory', size: 4096, modified: '2026-06-28', permissions: 'drwxr-xr-x' },
  { name: 'app/', type: 'directory', size: 4096, modified: '2026-07-06', permissions: 'drwxr-xr-x' },
  { name: 'backup.tar.gz', type: 'file', size: 52428800, modified: '2026-07-01', permissions: '-rw-r--r--' },
  { name: 'scripts/', type: 'directory', size: 4096, modified: '2026-06-15', permissions: 'drwxr-xr-x' },
  { name: '.env', type: 'file', size: 512, modified: '2026-07-03', permissions: '-rw-------' },
  { name: 'logs/', type: 'directory', size: 12288, modified: '2026-07-06', permissions: 'drwxr-xr-x' },
  { name: 'README.md', type: 'file', size: 1024, modified: '2026-06-20', permissions: '-rw-r--r--' },
]

export const mockServices: ServiceStatus[] = [
  { name: 'nginx.service', status: 'active', description: 'Nginx Web Server' },
  { name: 'postgresql.service', status: 'active', description: 'PostgreSQL Database' },
  { name: 'redis.service', status: 'active', description: 'Redis In-Memory Store' },
  { name: 'docker.service', status: 'active', description: 'Docker Daemon' },
  { name: 'cron.service', status: 'active', description: 'Cron Scheduler' },
  { name: 'fail2ban.service', status: 'active', description: 'Fail2Ban Protection' },
  { name: 'ufw.service', status: 'active', description: 'Uncomplicated Firewall' },
  { name: 'bluetooth.service', status: 'inactive', description: 'Bluetooth Service' },
]
