import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Eye, EyeOff, Check, Loader2, Shield, ChevronDown, Search, X } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import { useServers } from '../store/ServerContext'
import { useToast } from '../components/ui/Toast'
import type { Server as ServerType } from '../types/server'

export default function AddServer() {
  const navigate = useNavigate()
  const { servers, addServer, connectServer } = useServers()
  const { showToast } = useToast()
  const [showPassword, setShowPassword] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [form, setForm] = useState({
    name: '',
    host: '',
    port: '22',
    username: 'root',
    authType: 'password' as 'password' | 'key',
    password: '',
    keyData: '',
    keyPassphrase: '',
    tags: '',
    jumpServerId: '',
  })
  const [jumpSearch, setJumpSearch] = useState('')
  const [showJumpPicker, setShowJumpPicker] = useState(false)
  const [saved, setSaved] = useState(false)
  const jumpRef = useRef<HTMLDivElement>(null)

  const availableJumps = servers.filter(s =>
    s.password && s.id !== form.jumpServerId
  ).filter(s =>
    !jumpSearch || s.name.toLowerCase().includes(jumpSearch.toLowerCase()) ||
    s.host.toLowerCase().includes(jumpSearch.toLowerCase())
  )

  const selectedJump = servers.find(s => s.id === form.jumpServerId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.host.trim()) {
      showToast('请填写服务器名称和主机地址', 'error')
      return
    }

    setConnecting(true)

    const newServer: ServerType = {
      id: Date.now().toString(),
      name: form.name.trim(),
      host: form.host.trim(),
      port: parseInt(form.port) || 22,
      username: form.username.trim() || 'root',
      authType: form.authType,
      password: form.password || undefined,
      jumpServerId: form.jumpServerId || undefined,
      status: 'offline',
      os: '-',
      uptime: '-',
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      lastChecked: new Date().toISOString(),
    }

    addServer(newServer)

    if (form.authType === 'password' && form.password) {
      const result = await connectServer(newServer.id, form.password)
      if (result.success) {
        showToast('服务器添加成功，SSH 已连接', 'success')
      } else {
        showToast(result.error || '服务器已添加，但 SSH 连接失败', 'error')
      }
    } else {
      showToast('服务器已添加，请在详情页连接', 'info')
    }

    setConnecting(false)
    setSaved(true)
    setTimeout(() => navigate('/'), 1200)
  }

  if (saved) {
    return (
      <div className="pb-24 flex items-center justify-center min-h-[60vh]">
        <div className="text-center animate-slide-up">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-success" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary mb-1">服务器已添加</h2>
          <p className="text-sm text-text-muted">正在返回仪表盘...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-24 overflow-y-auto h-full" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <PageHeader title="添加服务器" backTo="/" />

      <div className="px-4">
        <form onSubmit={handleSubmit} className="space-y-4 animate-slide-up">
          <div className="flex justify-center py-4">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Server size={36} className="text-white" />
            </div>
          </div>

          <div className="glass rounded-2xl px-4 py-3">
            <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">名称 *</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="例如：Production Web" className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted/40" required />
          </div>

          <div className="glass rounded-2xl px-4 py-3 flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">主机地址 *</label>
              <input type="text" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}
                placeholder="192.168.1.100 或 your-server.com" className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted/40" required />
            </div>
            <div className="w-20">
              <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">端口</label>
              <input type="text" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })}
                className="w-full bg-transparent text-sm text-text-primary outline-none" />
            </div>
          </div>

          <div className="glass rounded-2xl p-1 flex">
            {(['password', 'key'] as const).map(type => (
              <button key={type} type="button" onClick={() => setForm({ ...form, authType: type })}
                className={`flex-1 py-2.5 rounded-xl text-xs font-medium transition-all ${
                  form.authType === type ? 'bg-primary/15 text-primary-light' : 'text-text-muted'
                }`}>
                {type === 'password' ? '密码认证' : '密钥认证'}
              </button>
            ))}
          </div>

          <div className="glass rounded-2xl px-4 py-3">
            <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">用户名</label>
            <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
              className="w-full bg-transparent text-sm text-text-primary outline-none" required />
          </div>

          {form.authType === 'password' ? (
            <div className="glass rounded-2xl px-4 py-3 flex items-center gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">密码</label>
                <input type={showPassword ? 'text' : 'password'} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  autoComplete="current-password"
                  onFocus={(e) => { setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300) }}
                  placeholder="输入 SSH 密码..." className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted/40" />
              </div>
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors mt-3">
                {showPassword ? <EyeOff size={16} className="text-text-muted" /> : <Eye size={16} className="text-text-muted" />}
              </button>
            </div>
          ) : (
            <>
              <div className="glass rounded-2xl px-4 py-3">
                <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">SSH 私钥 (Base64)</label>
                <textarea value={form.keyData} onChange={e => setForm({ ...form, keyData: e.target.value })}
                  placeholder="粘贴 Base64 编码的私钥..." rows={3}
                  className="w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted/40 font-mono resize-none" />
              </div>
              <div className="glass rounded-2xl px-4 py-3">
                <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">密钥密码 (如有)</label>
                <input type="password" value={form.keyPassphrase}
                  onChange={e => setForm({ ...form, keyPassphrase: e.target.value })}
                  className="w-full bg-transparent text-sm text-text-primary outline-none" />
              </div>
            </>
          )}

          <div ref={jumpRef} className="glass rounded-2xl px-4 py-3 relative overflow-visible z-10">
            <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Shield size={10} /> 跳板服务器 (可选)
            </label>
            {selectedJump ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 text-sm text-text-primary min-w-0">
                  <span className="text-success text-[9px]">●</span>
                  <span className="truncate">{selectedJump.name}</span>
                  <span className="text-text-muted text-xs truncate">{selectedJump.host}:{selectedJump.port}</span>
                </div>
                <button type="button" onClick={() => setForm({ ...form, jumpServerId: '' })}
                  className="p-1 rounded-lg hover:bg-white/5 text-text-muted">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => {
                setShowJumpPicker(!showJumpPicker)
                if (!showJumpPicker) {
                  setTimeout(() => jumpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
                }
              }}
                className="w-full flex items-center justify-between text-sm text-text-muted py-1">
                <span className="flex items-center gap-2">
                  <Search size={12} />
                  <span>{jumpSearch || '搜索已保存的服务器...'}</span>
                </span>
                <ChevronDown size={14} className={showJumpPicker ? 'rotate-180' : ''} />
              </button>
            )}
            {showJumpPicker && (
              <>
                <div className="fixed inset-0 z-40 bg-black/30" onClick={() => { setShowJumpPicker(false); setJumpSearch('') }} />
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface-dark rounded-xl py-1 animate-fade-in max-h-48 overflow-y-auto border border-border shadow-2xl">
                  <div className="px-3 py-2 sticky top-0 bg-surface-dark rounded-t-xl border-b border-border/10">
                    <input type="text" value={jumpSearch} onChange={e => setJumpSearch(e.target.value)}
                      placeholder="搜索服务器名称或地址..." autoFocus
                      className="w-full bg-white/5 rounded-lg px-2 py-1 text-xs text-text-primary outline-none" />
                  </div>
                  {availableJumps.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-muted">
                      {servers.filter(s => s.password).length === 0
                        ? '请先添加并连接其他服务器'
                        : '无匹配结果'}
                    </div>
                  ) : availableJumps.map(s => (
                    <button key={s.id} type="button" onClick={() => {
                      setForm({ ...form, jumpServerId: s.id })
                      setShowJumpPicker(false)
                      setJumpSearch('')
                    }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                      <span className="text-text-primary truncate">{s.name}</span>
                      <span className="text-text-muted truncate">{s.host}:{s.port}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="glass rounded-2xl px-4 py-3">
            <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">标签 (逗号分隔)</label>
            <input type="text" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })}
              placeholder="prod, web" className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted/40" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => navigate(-1)}
              className="flex-1 py-3.5 rounded-2xl glass text-text-secondary text-sm font-medium hover:bg-white/5 transition-colors">
              取消
            </button>
            <button type="submit" disabled={connecting}
              className="flex-[2] py-3.5 rounded-2xl bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity glass-hover active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
              {connecting && <Loader2 size={16} className="animate-spin" />}
              {connecting ? '连接中...' : '添加并连接'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
