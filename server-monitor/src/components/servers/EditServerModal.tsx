import { useState } from 'react'
import { Server, Eye, EyeOff, Shield, ChevronDown, Search, X } from 'lucide-react'
import { useServers } from '../../store/ServerContext'
import { useToast } from '../ui/Toast'
import type { Server as ServerType } from '../../types/server'

interface Props {
  server: ServerType
  open: boolean
  onClose: () => void
}

export default function EditServerModal({ server, open, onClose }: Props) {
  const { servers, updateServer } = useServers()
  const { showToast } = useToast()
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({
    name: server.name,
    host: server.host,
    port: String(server.port),
    username: server.username,
    authType: server.authType,
    password: server.password || '',
    keyData: '',
    keyPassphrase: '',
    tags: server.tags.join(', '),
    jumpServerId: server.jumpServerId || '',
  })
  const [jumpSearch, setJumpSearch] = useState('')
  const [showJumpPicker, setShowJumpPicker] = useState(false)

  const availableJumps = servers.filter(s =>
    s.id !== server.id && s.password
  ).filter(s =>
    !jumpSearch || s.name.toLowerCase().includes(jumpSearch.toLowerCase()) ||
    s.host.toLowerCase().includes(jumpSearch.toLowerCase())
  )

  const selectedJump = servers.find(s => s.id === form.jumpServerId)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.host.trim()) {
      showToast('请填写服务器名称和主机地址', 'error')
      return
    }
    updateServer(server.id, {
      name: form.name.trim(),
      host: form.host.trim(),
      port: parseInt(form.port) || 22,
      username: form.username.trim() || 'root',
      authType: form.authType,
      password: form.password || undefined,
      jumpServerId: form.jumpServerId || undefined,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    })
    showToast('服务器信息已更新', 'success')
    onClose()
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        <div
          className="relative z-50 bg-surface-dark w-full sm:max-w-lg sm:rounded-2xl max-h-[85vh] overflow-y-auto animate-slide-up"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-surface-dark/95 backdrop-blur-xl z-10 px-4 py-3 flex items-center justify-between border-b border-white/5">
            <h2 className="text-base font-semibold text-text-primary">编辑服务器</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5">
              <X size={18} className="text-text-muted" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
            <div className="flex justify-center py-2">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <Server size={28} className="text-white" />
              </div>
            </div>

            <div className="glass rounded-2xl px-4 py-3">
              <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">名称 *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted/40" required />
            </div>

            <div className="glass rounded-2xl px-4 py-3 flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">主机地址 *</label>
                <input type="text" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}
                  className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted/40" required />
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
                    className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted/40" />
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
                    rows={3} className="w-full bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted/40 font-mono resize-none" />
                </div>
                <div className="glass rounded-2xl px-4 py-3">
                  <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 block">密钥密码 (如有)</label>
                  <input type="password" value={form.keyPassphrase}
                    onChange={e => setForm({ ...form, keyPassphrase: e.target.value })}
                    className="w-full bg-transparent text-sm text-text-primary outline-none" />
                </div>
              </>
            )}

            <div className="glass rounded-2xl px-4 py-3 relative z-10">
              <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Shield size={10} /> 跳板服务器 (可选)
              </label>
              {selectedJump ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 text-sm text-text-primary min-w-0">
                    <span className="text-success text-[9px]">&#9679;</span>
                    <span className="truncate">{selectedJump.name}</span>
                    <span className="text-text-muted text-xs truncate">{selectedJump.host}:{selectedJump.port}</span>
                  </div>
                  <button type="button" onClick={() => setForm({ ...form, jumpServerId: '' })}
                    className="p-1 rounded-lg hover:bg-white/5 text-text-muted">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setShowJumpPicker(!showJumpPicker)}
                  className="w-full flex items-center justify-between text-sm text-text-muted py-1">
                  <span className="flex items-center gap-2">
                    <Search size={12} />
                    <span>搜索已保存的服务器...</span>
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
                      <div className="px-3 py-2 text-xs text-text-muted">无可用跳板服务器</div>
                    ) : availableJumps.map(s => (
                      <button key={s.id} type="button" onClick={() => {
                        setForm({ ...form, jumpServerId: s.id })
                        setShowJumpPicker(false)
                        setJumpSearch('')
                      }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 flex items-center gap-2">
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

            <div className="flex gap-3 pt-2 pb-2">
              <button type="button" onClick={onClose}
                className="flex-1 py-3.5 rounded-2xl glass text-text-secondary text-sm font-medium hover:bg-white/5">
                取消
              </button>
              <button type="submit"
                className="flex-[2] py-3.5 rounded-2xl bg-gradient-to-r from-primary to-accent text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all">
                保存修改
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
