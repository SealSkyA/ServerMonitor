import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { Preferences } from '@capacitor/preferences'

export type ThemeMode = 'dark' | 'light' | 'system'

interface ThemeContextType {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextType | null>(null)
const STORAGE_KEY = 'servermonitor_theme'

async function readTheme(): Promise<ThemeMode> {
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY })
    if (value === 'dark' || value === 'light' || value === 'system') return value
  } catch {}
  const saved = localStorage.getItem(STORAGE_KEY)
  const v = (saved === 'dark' || saved === 'light' || saved === 'system') ? saved : 'dark'
  return v as ThemeMode
}

async function writeTheme(mode: ThemeMode) {
  try {
    await Preferences.set({ key: STORAGE_KEY, value: mode })
  } catch {}
  localStorage.setItem(STORAGE_KEY, mode)
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', isDark)
  root.classList.toggle('light', !isDark)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark')
  const [, setTick] = useState(0)

  useEffect(() => {
    readTheme().then(setModeState)
  }, [])

  const setMode = useCallback((m: ThemeMode) => {
    writeTheme(m)
    setModeState(m)
  }, [])

  useEffect(() => {
    applyTheme(mode)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (mode === 'system') {
        applyTheme('system')
        setTick(t => t + 1)
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <ThemeContext.Provider value={{ mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
