import { Routes, Route, Navigate, useLocation, useNavigate, matchPath } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { StatusBar, Style } from '@capacitor/status-bar'
import { App as CapacitorApp } from '@capacitor/app'
import { ServerProvider } from './store/ServerContext'
import { ThemeProvider, useTheme } from './store/ThemeContext'
import { KeyboardProvider, useKeyboard } from './store/KeyboardContext'
import { ToastProvider } from './components/ui/Toast'
import BottomNav from './components/layout/BottomNav'
import ServersPage from './pages/ServersPage'
import ServerDetail from './pages/ServerDetail'
import TerminalPage from './pages/TerminalPage'
import FilesPage from './pages/FilesPage'
import ServicesPage from './pages/ServicesPage'
import Settings from './pages/Settings'
import AddServer from './pages/AddServer'

function StatusBarController() {
  const { isDark } = useTheme()
  const location = useLocation()

  useEffect(() => {
    const isFilesPage = location.pathname.startsWith('/files')
    StatusBar.setStyle({ style: isFilesPage && !isDark ? Style.Dark : isDark ? Style.Dark : Style.Light })
    StatusBar.setBackgroundColor({ color: isFilesPage ? (isDark ? '#2b2b2b' : '#e9eef6') : (isDark ? '#0f0f1a' : '#FFFBFE') })
  }, [isDark, location.pathname])

  return null
}

function AppRoutes() {
  const location = useLocation()
  const navigate = useNavigate()
  const { keyboardOpen } = useKeyboard()
  const hideNav = location.pathname.startsWith('/add-server') || keyboardOpen
  const [detailNavHidden, setDetailNavHidden] = useState(false)

  useEffect(() => {
    const handleDetailNavVisibility = (event: Event) => {
      setDetailNavHidden(Boolean((event as CustomEvent<boolean>).detail))
    }
    window.addEventListener('detail-nav-visibility', handleDetailNavVisibility)
    return () => window.removeEventListener('detail-nav-visibility', handleDetailNavVisibility)
  }, [])

  useEffect(() => {
    if (!location.pathname.startsWith('/server/')) setDetailNavHidden(false)
  }, [location.pathname])

  useEffect(() => {
    let removed = false
    let listener: { remove: () => Promise<void> } | undefined
    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const intercept = new Event('app-back-button', { cancelable: true })
      window.dispatchEvent(intercept)
      if (intercept.defaultPrevented) return

      const servicesMatch = matchPath('/services/:id', location.pathname)
      if (servicesMatch?.params.id) {
        navigate(`/server/${servicesMatch.params.id}`)
      } else if (location.pathname.startsWith('/server/')) {
        navigate('/servers')
      } else if (location.pathname.startsWith('/add-server')) {
        navigate('/servers')
      } else if (location.pathname.startsWith('/terminal/')) {
        navigate('/terminal')
      } else if (location.pathname.startsWith('/files/')) {
        navigate('/files')
      } else if (canGoBack) {
        window.history.back()
      } else {
        void CapacitorApp.exitApp()
      }
    }).then(handle => {
      if (removed) handle.remove()
      else listener = handle
    })
    return () => {
      removed = true
      listener?.remove()
    }
  }, [location.pathname, navigate])

  const [viewHeight, setViewHeight] = useState(window.innerHeight)
  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport
      if (vv) setViewHeight(vv.height)
      else setViewHeight(window.innerHeight)
    }
    update()
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)
    }
    window.addEventListener('resize', update)
    return () => {
      if (vv) {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
      }
      window.removeEventListener('resize', update)
    }
  }, [])

  const activeMain = matchPath('/terminal/*', location.pathname) ? 'terminal'
    : matchPath('/files/*', location.pathname) ? 'files'
    : matchPath('/settings', location.pathname) ? 'settings'
    : matchPath('/servers', location.pathname) ? 'servers'
    : matchPath('/', location.pathname) ? 'servers'
    : ''

  return (
    <div className="bg-surface-dark flex flex-col overflow-hidden" style={{ height: `${viewHeight}px` }}>
      <div
        className="flex-1 min-h-0"
      >
        {/* Redirect root */}
        {location.pathname === '/' && <Navigate to="/servers" replace />}

        <div style={{ display: activeMain === 'servers' ? 'flex' : 'none' }} className="h-full flex-col">
          <ServersPage />
        </div>
        <div style={{ display: activeMain === 'terminal' ? 'flex' : 'none' }} className="h-full flex-col">
          <TerminalPage />
        </div>
        <div style={{ display: activeMain === 'files' ? 'flex' : 'none' }} className="h-full flex-col">
          <FilesPage />
        </div>
        <div style={{ display: activeMain === 'settings' ? 'flex' : 'none' }} className="h-full flex-col">
          <Settings />
        </div>

        {/* Sub-pages (overlay on hidden main tabs) */}
        <Routes>
          <Route path="/server/:id" element={<ServerDetail />} />
          <Route path="/services/:id" element={<ServicesPage />} />
          <Route path="/add-server" element={<AddServer />} />
        </Routes>
      </div>
      {!hideNav && <BottomNav hidden={detailNavHidden} />}
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <StatusBarController />
      <KeyboardProvider>
      <ServerProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </ServerProvider>
      </KeyboardProvider>
    </ThemeProvider>
  )
}
