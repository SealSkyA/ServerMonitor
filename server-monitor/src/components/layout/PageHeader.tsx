import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, MoreVertical } from 'lucide-react'

interface Props {
  title: string
  subtitle?: string
  backTo?: string
  action?: ReactNode
}

export default function PageHeader({ title, subtitle, backTo, action }: Props) {
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-40 flex min-h-[76px] items-center px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.25rem)]">
      <div className="glass w-full rounded-2xl px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {backTo && (
              <button
                onClick={() => navigate(backTo)}
                className="p-1 -ml-1 rounded-xl hover:bg-white/5 transition-colors"
              >
                <ChevronLeft size={22} className="text-text-secondary" />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-text-primary truncate">{title}</h1>
              {subtitle && (
                <p className="text-xs text-text-muted truncate mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {action || (
            <button className="p-1.5 rounded-xl hover:bg-white/5 transition-colors">
              <MoreVertical size={18} className="text-text-secondary" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
