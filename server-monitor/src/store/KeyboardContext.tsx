import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react'

interface KeyboardState {
  keyboardOpen: boolean
  keyboardHeight: number
}

const KeyboardContext = createContext<KeyboardState>({ keyboardOpen: false, keyboardHeight: 0 })

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const viewportHeightRef = useRef(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const handler = () => {
      // Android adjustResize shrinks both innerHeight and visualViewport.height,
      // so their difference stays at zero while the IME is visible. Track the
      // largest keyboard-free visual viewport height instead.
      const viewportHeight = vv.height
      const overlayHeight = Math.max(0, window.innerHeight - viewportHeight)
      const resizeHeight = Math.max(0, viewportHeightRef.current - viewportHeight)
      const h = Math.max(overlayHeight, resizeHeight)
      const open = h > 80

      if (!open) viewportHeightRef.current = Math.max(viewportHeightRef.current, viewportHeight)

      setKeyboardOpen(open)
      setKeyboardHeight(open ? h : 0)
    }

    handler()

    if (vv.addEventListener) {
      vv.addEventListener('resize', handler)
      return () => vv.removeEventListener('resize', handler)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return (
    <KeyboardContext.Provider value={{ keyboardOpen, keyboardHeight }}>
      {children}
    </KeyboardContext.Provider>
  )
}

export function useKeyboard() {
  return useContext(KeyboardContext)
}
