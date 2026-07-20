import { NavLink, useLocation } from 'react-router-dom'
import { useRef } from 'react'
import { Server, Terminal, FolderOpen, Settings } from 'lucide-react'

const tabs = [
  { to: '/servers', icon: Server, label: '服务器' },
  { to: '/terminal', icon: Terminal, label: '终端' },
  { to: '/files', icon: FolderOpen, label: '文件' },
  { to: '/settings', icon: Settings, label: '设置' },
]

export default function BottomNav({ hidden = false }: { hidden?: boolean }) {
  const location = useLocation()
  const lastServersTapRef = useRef(0)
  const filesPage = location.pathname.startsWith('/files')

  const handleServersTap = (active: boolean) => {
    if (!active) return
    const now = Date.now()
    if (now - lastServersTapRef.current < 350) {
      lastServersTapRef.current = 0
      window.dispatchEvent(new Event('servers-tab-double-tap'))
      return
    }
    lastServersTapRef.current = now
  }

  return (
    <nav className={`shrink-0 safe-bottom ${filesPage ? 'h-[88px] border-t border-[#e6e9f0] bg-white' : 'border-t border-border/70 bg-surface-card'} ${hidden ? 'hidden' : ''}`}>
      <div className={filesPage ? 'h-full px-2 py-1' : 'px-2 py-1.5'}>
        <div className="flex items-center justify-around">
          {tabs.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to ||
              (to !== '/' && location.pathname.startsWith(to))
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => to === '/servers' && handleServersTap(active)}
                className={filesPage
                  ? `flex h-[72px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-3 transition-all duration-200 ${active ? 'text-[#6670f5]' : 'text-[#a0a8b8]'}`
                  : `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-200 min-w-0 ${active ? 'text-primary-light bg-primary/15 shadow-[0_0_12px_rgba(88,166,255,0.15)]' : 'text-text-muted hover:text-text-secondary'}`
                }
              >
                <div className={`relative flex h-10 w-10 items-center justify-center ${filesPage && active ? 'rounded-2xl bg-[#eef0ff] shadow-[0_0_14px_rgba(102,112,245,0.18)]' : active ? 'animate-pulse-glow rounded-full' : ''}`}>
                  <Icon size={filesPage ? 24 : 22} strokeWidth={active ? 2.4 : 1.8} />
                  {active && (
                    <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-primary rounded-full" />
                  )}
                </div>
                <span className={`text-[10px] font-medium ${filesPage ? 'opacity-100' : active ? 'opacity-100' : 'opacity-60'}`}>
                  {label}
                </span>
              </NavLink>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
