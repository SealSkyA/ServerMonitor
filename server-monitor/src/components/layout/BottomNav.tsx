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
    <nav className={`shrink-0 border-t border-border/70 bg-surface-card safe-bottom ${hidden ? 'hidden' : ''}`}>
      <div className="px-2 py-1.5">
        <div className="flex items-center justify-around">
          {tabs.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to ||
              (to !== '/' && location.pathname.startsWith(to))
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => to === '/servers' && handleServersTap(active)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-200 min-w-0 ${
                  active
                    ? 'text-primary-light bg-primary/15 shadow-[0_0_12px_rgba(88,166,255,0.15)]'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                <div className={`relative ${active ? 'animate-pulse-glow rounded-full' : ''}`}>
                  <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                  {active && (
                    <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-primary rounded-full" />
                  )}
                </div>
                <span className={`text-[10px] font-medium ${active ? 'opacity-100' : 'opacity-60'}`}>
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
