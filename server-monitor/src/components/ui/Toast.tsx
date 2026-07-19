import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastContextType {
  toasts: Toast[]
  showToast: (message: string, type?: Toast['type']) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

let toastId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 2500)
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, showToast }}>
      {children}
      <div className="fixed top-4 left-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        {toasts.map(t => (
          <div
            key={t.id}
            className={`animate-slide-up px-4 py-3 rounded-xl text-sm font-medium shadow-lg pointer-events-auto ${
              t.type === 'success' ? 'bg-success/90 text-white' :
              t.type === 'error' ? 'bg-danger/90 text-white' :
              'bg-surface-light/95 text-text-primary border border-border/50'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
