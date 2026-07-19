import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Bell, Shield, Globe, Moon, Smartphone, Download, Upload, CloudCog, CloudDownload, CloudUpload, Save, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Preferences } from '@capacitor/preferences'
import PageHeader from '../components/layout/PageHeader'
import { useToast } from '../components/ui/Toast'
import { useTheme } from '../store/ThemeContext'
import { useServers } from '../store/ServerContext'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import type { Server } from '../types/server'
import { Capacitor } from '@capacitor/core'
import Ssh from '../plugins/ssh'

interface SettingItem {
  icon: LucideIcon
  label: string
  sublabel?: string
  value: string | boolean
  color: string
  bg: string
  toggle?: boolean
  action: () => void
}

interface ConfigBackup {
  version: 1
  exportedAt: string
  theme: 'dark' | 'light' | 'system'
  servers: Server[]
}

interface WebDavConfig {
  url: string
  username: string
  password: string
  path: string
}

const WEBDAV_STORAGE_KEY = 'servermonitor_webdav_backup'
const emptyWebDavConfig: WebDavConfig = { url: '', username: '', password: '', path: '' }

function isConfigBackup(value: unknown): value is ConfigBackup {
  if (!value || typeof value !== 'object') return false
  const backup = value as Partial<ConfigBackup>
  return backup.version === 1 && Array.isArray(backup.servers) &&
    (backup.theme === 'dark' || backup.theme === 'light' || backup.theme === 'system') &&
    backup.servers.every(server => server && typeof server.id === 'string' && typeof server.name === 'string' && typeof server.host === 'string')
}

export default function Settings() {
  const { showToast } = useToast()
  const { mode, setMode } = useTheme()
  const { servers, replaceServers } = useServers()
  const [notifications, setNotifications] = useState(true)
  const [biometric, setBiometric] = useState(false)
  const [importBackup, setImportBackup] = useState<ConfigBackup | null>(null)
  const [webDavConfig, setWebDavConfig] = useState<WebDavConfig>(emptyWebDavConfig)
  const [webDavOpen, setWebDavOpen] = useState(false)
  const [remoteBackups, setRemoteBackups] = useState<string[] | null>(null)
  const [webDavBusy, setWebDavBusy] = useState(false)
  const [verifiedWebDavConfig, setVerifiedWebDavConfig] = useState('')
  const importInputRef = useRef<HTMLInputElement>(null)

  const isDark = mode === 'dark'
  const isSystem = mode === 'system'

  useEffect(() => {
    const loadWebDavConfig = async () => {
      try {
        const { value } = await Preferences.get({ key: WEBDAV_STORAGE_KEY })
        const saved = value ?? localStorage.getItem(WEBDAV_STORAGE_KEY)
        if (!saved) return
        const parsed: unknown = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') {
          const config = parsed as Partial<WebDavConfig>
          setWebDavConfig({
            url: typeof config.url === 'string' ? config.url : '',
            username: typeof config.username === 'string' ? config.username : '',
            password: typeof config.password === 'string' ? config.password : '',
            path: typeof config.path === 'string' ? config.path : '',
          })
        }
      } catch {}
    }
    void loadWebDavConfig()
  }, [])

  const createBackup = (): ConfigBackup => ({ version: 1, exportedAt: new Date().toISOString(), theme: mode, servers })

  const validateWebDavConfig = () => {
    try {
      const url = new URL(webDavConfig.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
      return true
    } catch {
      showToast('请填写有效的 WebDAV 地址', 'error')
      return false
    }
  }

  const updateWebDavConfig = (update: Partial<WebDavConfig>) => {
    setWebDavConfig(config => ({ ...config, ...update }))
    setVerifiedWebDavConfig('')
  }

  const testWebDavConnection = async () => {
    if (!validateWebDavConfig()) return
    setWebDavBusy(true)
    try {
      const result = await Ssh.testWebDavConnection(webDavConfig)
      if (result.success) {
        setVerifiedWebDavConfig(JSON.stringify(webDavConfig))
        showToast('WebDAV 连接测试成功', 'success')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'WebDAV 连接测试失败', 'error')
    } finally {
      setWebDavBusy(false)
    }
  }

  const saveWebDavConfig = async () => {
    if (!validateWebDavConfig()) return
    if (verifiedWebDavConfig !== JSON.stringify(webDavConfig)) {
      showToast('请先测试当前 WebDAV 设置', 'info')
      return
    }
    const value = JSON.stringify(webDavConfig)
    try {
      await Preferences.set({ key: WEBDAV_STORAGE_KEY, value })
    } catch {}
    localStorage.setItem(WEBDAV_STORAGE_KEY, value)
    setWebDavOpen(false)
    showToast('WebDAV 配置已保存', 'success')
  }

  const handleExport = async () => {
    const backup = createBackup()
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
    const name = `server-monitor-backup-${timestamp}.json`
    const content = JSON.stringify(backup, null, 2)
    const file = new File([content], name, { type: 'application/json' })
    try {
      if (Capacitor.isNativePlatform()) {
        const data = btoa(unescape(encodeURIComponent(content)))
        const result = await Ssh.saveConfigBackup({ fileName: name, data })
        if (result.success) showToast('配置备份已保存', 'success')
        else if (!result.cancelled) showToast('配置备份保存失败', 'error')
        return
      }
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Server Monitor 配置备份' })
        showToast('配置备份已准备完成', 'success')
        return
      }
    } catch {
      showToast('配置备份保存失败', 'error')
      return
    }
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('配置备份已导出', 'success')
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isConfigBackup(parsed)) throw new Error('invalid backup')
      setImportBackup(parsed)
    } catch {
      showToast('配置文件格式无效', 'error')
    }
  }

  const confirmImport = async () => {
    if (!importBackup) return
    await replaceServers(importBackup.servers)
    setMode(importBackup.theme)
    showToast(`已恢复 ${importBackup.servers.length} 台服务器配置`, 'success')
    setImportBackup(null)
  }

  const handleWebDavBackup = async () => {
    if (!validateWebDavConfig()) return
    const backup = createBackup()
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
    const fileName = `server-monitor-backup-${timestamp}.json`
    setWebDavBusy(true)
    try {
      const data = btoa(unescape(encodeURIComponent(JSON.stringify(backup, null, 2))))
      const result = await Ssh.uploadWebDavBackup({ ...webDavConfig, fileName, data })
      if (result.success) showToast(`WebDAV 备份已保存：${fileName}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'WebDAV 备份失败', 'error')
    } finally {
      setWebDavBusy(false)
    }
  }

  const handleWebDavRestore = async () => {
    if (!validateWebDavConfig()) return
    setWebDavBusy(true)
    try {
      const result = await Ssh.listWebDavBackups(webDavConfig)
      setRemoteBackups(result.files.sort().reverse())
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取 WebDAV 备份失败', 'error')
    } finally {
      setWebDavBusy(false)
    }
  }

  const selectRemoteBackup = async (fileName: string) => {
    setWebDavBusy(true)
    try {
      const result = await Ssh.downloadWebDavBackup({ ...webDavConfig, fileName })
      const bytes = Uint8Array.from(atob(result.data), character => character.charCodeAt(0))
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (!isConfigBackup(parsed)) throw new Error('配置文件格式无效')
      setRemoteBackups(null)
      setImportBackup(parsed)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '下载 WebDAV 备份失败', 'error')
    } finally {
      setWebDavBusy(false)
    }
  }

  const settingsGroups: { title: string; items: SettingItem[] }[] = [
    {
      title: '外观',
      items: [
        {
          icon: Moon,
          label: '深色模式',
          sublabel: '强制使用深色主题',
          value: isDark,
          color: 'text-primary-light',
          bg: 'bg-primary/10',
          toggle: true,
          action: () => {
            if (isDark) {
              setMode('light')
              showToast('已切换为浅色模式', 'success')
            } else {
              setMode('dark')
              showToast('已切换为深色模式', 'success')
            }
          },
        },
        {
          icon: Smartphone,
          label: '跟随系统',
          sublabel: '自动跟随手机深浅色设置',
          value: isSystem,
          color: 'text-accent',
          bg: 'bg-accent/10',
          toggle: true,
          action: () => {
            if (isSystem) {
              setMode('light')
              showToast('已关闭跟随系统', 'info')
            } else {
              setMode('system')
              showToast('已开启跟随系统', 'success')
            }
          },
        },
      ],
    },
    {
      title: '通知',
      items: [
        {
          icon: Bell,
          label: '推送通知',
          value: notifications,
          color: 'text-accent',
          bg: 'bg-accent/10',
          toggle: true,
          action: () => {
            setNotifications(!notifications)
            showToast(notifications ? '推送通知已关闭' : '推送通知已开启', 'success')
          },
        },
      ],
    },
    {
      title: '安全',
      items: [
        {
          icon: Shield,
          label: '生物识别解锁',
          value: biometric,
          color: 'text-success',
          bg: 'bg-success/10',
          toggle: true,
          action: () => {
            if (!biometric) {
              showToast('请在系统设置中启用生物识别', 'info')
            } else {
              setBiometric(false)
              showToast('生物识别已关闭', 'success')
            }
          },
        },
        {
          icon: Shield,
          label: 'SSH 密钥管理',
          value: '',
          color: 'text-warning',
          bg: 'bg-warning/10',
          toggle: false,
          action: () => showToast('SSH 密钥管理功能开发中', 'info'),
        },
      ],
    },
    {
      title: '备份与恢复',
      items: [
        {
          icon: Download,
          label: '导出配置',
          sublabel: `备份 ${servers.length} 台服务器和主题设置`,
          value: '',
          color: 'text-primary-light',
          bg: 'bg-primary/10',
          toggle: false,
          action: () => { void handleExport() },
        },
        {
          icon: Upload,
          label: '导入配置',
          sublabel: '从 JSON 备份文件恢复配置',
          value: '',
          color: 'text-accent',
          bg: 'bg-accent/10',
          toggle: false,
          action: () => importInputRef.current?.click(),
        },
        {
          icon: CloudCog,
          label: 'WebDAV 设置',
          sublabel: webDavConfig.url ? webDavConfig.url : '配置远程备份服务器',
          value: '',
          color: 'text-warning',
          bg: 'bg-warning/10',
          toggle: false,
          action: () => setWebDavOpen(true),
        },
        {
          icon: CloudUpload,
          label: '备份到 WebDAV',
          sublabel: webDavBusy ? '正在传输配置备份' : '上传服务器和主题配置',
          value: '',
          color: 'text-primary-light',
          bg: 'bg-primary/10',
          toggle: false,
          action: () => { void handleWebDavBackup() },
        },
        {
          icon: CloudDownload,
          label: '从 WebDAV 恢复',
          sublabel: webDavBusy ? '正在读取远程备份' : '选择远程配置备份文件',
          value: '',
          color: 'text-accent',
          bg: 'bg-accent/10',
          toggle: false,
          action: () => { void handleWebDavRestore() },
        },
      ],
    },
    {
      title: '通用',
      items: [
        {
          icon: Globe,
          label: '语言',
          value: '简体中文',
          color: 'text-primary-light',
          bg: 'bg-primary/10',
          toggle: false,
          action: () => showToast('当前仅支持简体中文', 'info'),
        },
        {
          icon: Smartphone,
          label: '关于',
          value: 'v1.0.0',
          color: 'text-text-muted',
          bg: 'bg-white/5',
          toggle: false,
          action: () => showToast('Server Monitor v1.0.0 - 服务器监控管理工具', 'info'),
        },
      ],
    },
  ]

  return (
    <div className="h-full overflow-y-auto overscroll-y-contain pb-24">
      <PageHeader title="设置" />
      <input ref={importInputRef} type="file" accept="application/json,.json" onChange={handleImportFile} className="hidden" />
      <ConfirmDialog open={!!importBackup} title="导入配置"
        message={`将替换当前 ${servers.length} 台服务器配置，并恢复备份中的 ${importBackup?.servers.length || 0} 台服务器与主题设置。`}
        confirmLabel="确认导入" danger onConfirm={() => { void confirmImport() }} onCancel={() => setImportBackup(null)} />
      {webDavOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-text-primary">WebDAV 设置</h2>
                <p className="mt-1 text-xs text-text-muted">支持 HTTP WebDAV，保存前需要测试连接</p>
              </div>
              <button onClick={() => setWebDavOpen(false)} className="rounded-lg p-2 text-text-muted hover:bg-white/5" aria-label="关闭 WebDAV 设置">
                <X size={18} />
              </button>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs text-text-muted">服务器地址</span>
              <input value={webDavConfig.url} onChange={event => updateWebDavConfig({ url: event.target.value })}
                placeholder="http://dav.example.com/webdav" className="w-full rounded-xl border border-border/60 bg-surface/70 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-text-muted">用户名</span>
              <input value={webDavConfig.username} onChange={event => updateWebDavConfig({ username: event.target.value })}
                autoCapitalize="none" className="w-full rounded-xl border border-border/60 bg-surface/70 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-text-muted">密码或应用专用密码</span>
              <input value={webDavConfig.password} onChange={event => updateWebDavConfig({ password: event.target.value })}
                type="password" autoComplete="off" className="w-full rounded-xl border border-border/60 bg-surface/70 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-text-muted">远程目录（留空使用 WebDAV 根目录）</span>
              <input value={webDavConfig.path} onChange={event => updateWebDavConfig({ path: event.target.value })}
                placeholder="例如 backups/server-monitor" className="w-full rounded-xl border border-border/60 bg-surface/70 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary" />
            </label>
            <button disabled={webDavBusy} onClick={() => { void testWebDavConnection() }} className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/60 px-4 py-3 text-sm font-medium text-primary disabled:opacity-50">
              <CloudCog size={16} /> {webDavBusy ? '正在测试连接' : '测试连接'}
            </button>
            <button disabled={webDavBusy} onClick={() => { void saveWebDavConfig() }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white disabled:opacity-50">
              <Save size={16} /> 保存 WebDAV 设置
            </button>
          </div>
        </div>
      )}
      {remoteBackups && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="glass max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-text-primary">选择 WebDAV 备份</h2>
                <p className="mt-1 text-xs text-text-muted">选择后会读取并校验配置内容</p>
              </div>
              <button onClick={() => setRemoteBackups(null)} className="rounded-lg p-2 text-text-muted hover:bg-white/5" aria-label="关闭远程备份列表">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[45vh] space-y-2 overflow-y-auto">
              {remoteBackups.length === 0 ? (
                <p className="rounded-xl bg-white/5 p-4 text-center text-sm text-text-muted">远程目录中没有 Server Monitor 备份</p>
              ) : remoteBackups.map(fileName => (
                <button key={fileName} disabled={webDavBusy} onClick={() => { void selectRemoteBackup(fileName) }}
                  className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10 disabled:opacity-50">
                  <CloudDownload size={17} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{fileName}</span>
                  <ChevronRight size={16} className="text-text-muted" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="px-4 space-y-5">
        <div className="glass rounded-2xl p-4 flex items-center gap-4 animate-slide-up">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <span className="text-xl font-bold text-white">SM</span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-text-primary">Server Monitor</h2>
            <p className="text-xs text-text-muted mt-0.5">Android · v1.0.0</p>
          </div>
        </div>

        {settingsGroups.map((group, gi) => (
          <div key={gi} className="space-y-1 animate-slide-up">
            <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider px-1 mb-2">
              {group.title}
            </h3>
            <div className="glass rounded-2xl overflow-hidden">
              {group.items.map((item, ii) => (
                <button
                  key={ii}
                  onClick={item.action}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors ${
                    ii < group.items.length - 1 ? 'border-b border-border/30' : ''
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl ${item.bg} flex items-center justify-center`}>
                    <item.icon size={17} className={item.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-primary font-medium">{item.label}</span>
                    {item.sublabel && (
                      <p className="text-[10px] text-text-muted leading-tight">{item.sublabel}</p>
                    )}
                  </div>
                  {item.toggle ? (
                    <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                      item.value ? 'bg-primary' : 'bg-white/10'
                    }`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        item.value ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`} />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-muted">{typeof item.value === 'string' ? item.value : ''}</span>
                      <ChevronRight size={15} className="text-text-muted" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        <p className="text-center text-[10px] text-text-muted pb-4">
          Server Monitor - Android · Built with React + Capacitor
        </p>
      </div>
    </div>
  )
}
