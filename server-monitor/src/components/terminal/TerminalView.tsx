import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, matchPath } from 'react-router-dom'
import { Preferences } from '@capacitor/preferences'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ChevronDown, Search, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Slash, Minus, File, FileText, Upload, Save, RefreshCw, FolderOpen, FolderPlus, FolderUp, Trash2, FileCode, Hash, X, Maximize2, Minimize2 } from 'lucide-react'
import { useServers } from '../../store/ServerContext'
import { useTheme } from '../../store/ThemeContext'
import { useKeyboard } from '../../store/KeyboardContext'
import { useToast } from '../ui/Toast'
import { sshManager } from '../../services/sshManager'
import { transferManager, type TransferTask } from '../../services/transferManager'
import { getHistory } from '../../services/commandHistory'
import '@xterm/xterm/css/xterm.css'

const shellStates = new Map<string, { connected: boolean }>()
const shellBuffers = new Map<string, string>()
const cmdHistories = new Map<string, string[]>()
const shellPwds = new Map<string, string>()
let activeServerId = ''
let globalTerm: XTerm | null = null
let terminalRenderVersion = 0
const LARGE_FILE_CHUNK_BYTES = 5 * 1024 * 1024

function writeTerminalBytes(term: XTerm, data: string, done?: () => void) {
  const bytes = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i)
  term.write(bytes, done)
}

function renderBufferedTerminal(serverId: string) {
  const term = globalTerm
  if (!term) return
  const version = ++terminalRenderVersion

  // The empty write waits for output already queued by xterm. A newer switch
  // invalidates prior callbacks, keeping stale terminal frames off screen.
  term.write('', () => {
    if (version !== terminalRenderVersion || globalTerm !== term) return
    term.reset()
    const buffer = shellBuffers.get(serverId) || ''
    if (!buffer) {
      term.scrollToBottom()
      return
    }
    writeTerminalBytes(term, buffer, () => {
      if (version === terminalRenderVersion && globalTerm === term) term.scrollToBottom()
    })
  })
}

function appendBuffer(srvId: string, data: string) {
  const cur = shellBuffers.get(srvId) || ''
  const combined = cur + data
  if (combined.length <= 50000) {
    shellBuffers.set(srvId, combined)
    return
  }
  // Resume at a line boundary so restored scrollback cannot start mid-escape.
  const trimmed = combined.slice(-50000)
  const firstLineEnd = trimmed.indexOf('\n')
  shellBuffers.set(srvId, firstLineEnd === -1 ? trimmed : trimmed.slice(firstLineEnd + 1))
}

async function loadHistory(srvId: string) {
  if (cmdHistories.has(srvId)) return cmdHistories.get(srvId)!
  const h = await getHistory(srvId)
  cmdHistories.set(srvId, h)
  return h
}

async function saveHistory(srvId: string, cmd: string): Promise<string[]> {
  const cmds = cmdHistories.get(srvId) || []
  const idx = cmds.indexOf(cmd)
  if (idx !== -1) cmds.splice(idx, 1)
  cmds.unshift(cmd)
  if (cmds.length > 99) cmds.pop()
  cmdHistories.set(srvId, cmds)
  // Persist full list directly to avoid read-write race
  const key = `servermonitor_cmdhist_${srvId}`
  const json = JSON.stringify(cmds)
  try {
    await Preferences.set({ key, value: json })
  } catch {
    localStorage.setItem(key, json)
  }
  return [...cmds]
}

function formatSize(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + 'G'
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + 'M'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + 'K'
  return bytes + 'B'
}

function focusXterm() {
  globalTerm?.focus()
}

export default function TerminalView() {
  const location = useLocation()
  const paramId = matchPath('/terminal/:id', location.pathname)?.params?.id
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { servers, isConnected, connectServer, execCommand } = useServers()
  const { isDark } = useTheme()
  const { showToast } = useToast()
  const { keyboardOpen, keyboardHeight } = useKeyboard()
  const [input, setInput] = useState('')

  const getInitialTabs = () => {
    const ids = Array.from(shellStates.keys()).filter(k => shellStates.get(k)?.connected)
    if (ids.length) return ids
    if (paramId) return [paramId]
    return []
  }
  const getInitialActive = () => {
    if (activeServerId && shellStates.get(activeServerId)?.connected) return activeServerId
    const ids = Array.from(shellStates.keys()).filter(k => shellStates.get(k)?.connected)
    return ids[0] || paramId || ''
  }

  const [tabServers, setTabServers] = useState<string[]>(getInitialTabs)
  const [activeTab, setActiveTab] = useState(getInitialActive)
  const [connected, setConnected] = useState(() => shellStates.get(getInitialActive())?.connected ?? false)
  const [history, setHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [shiftOn, setShiftOn] = useState(false)
  const [ctrlOn, setCtrlOn] = useState(false)
  const [altOn, setAltOn] = useState(false)
  const shiftOnRef = useRef(false)
  const ctrlOnRef = useRef(false)
  const altOnRef = useRef(false)
  const setShift = (v: boolean) => { shiftOnRef.current = v; setShiftOn(v) }
  const setCtrl = (v: boolean) => { ctrlOnRef.current = v; setCtrlOn(v) }
  const setAlt = (v: boolean) => { altOnRef.current = v; setAltOn(v) }
  const connectingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputBufRef = useRef('')
  const [files, setFiles] = useState<Array<{ name: string; type: string; size: number; perms: string; date: string }>>([])
  const [currDir, setCurrDir] = useState('')
  const [editingFile, setEditingFile] = useState<{ path: string; content: string; loading?: boolean; chunk?: { page: number; offset: number; size: number; bytes: number; firstLine: number } } | null>(null)
  const [newItemInput, setNewItemInput] = useState<'file' | 'folder' | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; isDir: boolean } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [searchIndex, setSearchIndex] = useState(0)
  const [chunkPageInput, setChunkPageInput] = useState('1')
  const [isMaximized, setIsMaximized] = useState(false)
  const [holdFilePanel, setHoldFilePanel] = useState(false)
  const [isFilePanelFullscreen, setIsFilePanelFullscreen] = useState(false)
  const [showUploadProgress, setShowUploadProgress] = useState(false)
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>(() => [...transferManager.getTasks()])
  const [directoryUpload, setDirectoryUpload] = useState<{ active: boolean; name: string; progress: number; uploadedFiles: number; totalFiles: number } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null)
  const largeEditorTextareaRef = useRef<HTMLTextAreaElement>(null)
  const editorScrollRef = useRef<HTMLDivElement>(null)
  const chunkPagesRef = useRef(new Map<number, { offset: number; firstLine: number }>())
  const terminalTouchYRef = useRef<number | null>(null)
  const terminalGestureMovedRef = useRef(false)
  const activeTabRef = useRef(activeTab)
  const fileRequestRef = useRef(0)

  useEffect(() => transferManager.subscribe(() => {
    setTransferTasks([...transferManager.getTasks()])
  }), [])

  useEffect(() => sshManager.onDirectoryUploadProgress(event => {
    if (event.serverId !== activeTab) return
    setDirectoryUpload(current => current ? {
      ...current,
      name: event.fileName,
      progress: event.progress,
      uploadedFiles: event.uploadedFiles,
      totalFiles: event.totalFiles,
    } : current)
  }), [activeTab])

  useEffect(() => {
    const handleBackButton = (event: Event) => {
      if (!location.pathname.startsWith('/terminal')) return
      if (editingFile) {
        event.preventDefault()
        setEditingFile(null)
      } else if (isFilePanelFullscreen) {
        event.preventDefault()
        setIsFilePanelFullscreen(false)
      }
    }
    window.addEventListener('app-back-button', handleBackButton)
    return () => window.removeEventListener('app-back-button', handleBackButton)
  }, [editingFile, isFilePanelFullscreen, location.pathname])

  // Refs for OSC handler closure safety
  const currDirRef = useRef(currDir)
  currDirRef.current = currDir
  const execCommandRef = useRef(execCommand)
  execCommandRef.current = execCommand
  const isDarkRef = useRef(isDark)
  isDarkRef.current = isDark

  // Parse ls -la output into file entries
  const parseLsOutput = useCallback((out: string) => {
    const entries: typeof files = []
    for (const line of out.split('\n')) {
      if (!line.trim() || line.startsWith('total ')) continue
      const cols = line.trim().split(/\s+/)
      if (cols.length < 9) continue
      entries.push({
        perms: cols[0],
        type: cols[0].startsWith('d') ? 'dir' : 'file',
        size: parseInt(cols[4]) || 0,
        date: cols.slice(5, 8).join(' '),
        name: cols.slice(8).join(' '),
      })
    }
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
  }, [])

  useEffect(() => {
    activeServerId = activeTab
    activeTabRef.current = activeTab
    setCurrDir(shellPwds.get(activeTab) || '')
    setFiles([])
  }, [activeTab])

  // Refresh file listing for currDir (uses explicit path, no execCommand pwd needed)
  const refreshFiles = useCallback(async () => {
    if (!activeTab || !currDir) return
    const request = ++fileRequestRef.current
    try {
      const out = await execCommand(activeTab, `ls -la --color=never "${currDir}"`)
      if (request === fileRequestRef.current && activeTabRef.current === activeTab && shellPwds.get(activeTab) === currDir) {
        setFiles(parseLsOutput(out))
      }
    } catch {}
  }, [activeTab, currDir, execCommand, parseLsOutput])

  // Poll disabled: 3s execCommand('ls -la') opens ChannelExec which may interfere with shell channel during vim
  // File listing now relies on OSC 777 pwd handler + manual refresh button only

  // Initial fetch on connect
  useEffect(() => {
    if (connected && activeTab) {
      const serverId = activeTab;
      (async () => {
        await new Promise(r => setTimeout(r, 1200))
        try {
          let dir = shellPwds.get(serverId)
          if (!dir) {
            const pwdOut = await execCommand(serverId, 'pwd')
            dir = pwdOut.trim()
            if (dir) shellPwds.set(serverId, dir)
          }
          if (dir && activeTabRef.current === serverId) {
            setCurrDir(dir)
            const request = ++fileRequestRef.current
            const out = await execCommand(serverId, `ls -la --color=never "${dir}"`)
            if (request === fileRequestRef.current && activeTabRef.current === serverId && shellPwds.get(serverId) === dir) {
              setFiles(parseLsOutput(out))
            }
          }
        } catch {}
      })()
    }
  }, [connected, activeTab, execCommand, parseLsOutput])

  useEffect(() => {
    if (activeTab) {
      const serverId = activeTab
      loadHistory(serverId).then(items => {
        if (activeTabRef.current === serverId) setHistory(items)
      })
      setShowHistory(false)
    }
  }, [activeTab])

  useEffect(() => {
    const removeShellDataListener = sshManager.onShellData((srvId, data) => {
        // Decode base64 (PtyBridge encodes to prevent JNI bridge data corruption)
        let raw: string
        try { raw = atob(data) } catch { return }
        if (!raw) return

        appendBuffer(srvId, raw)

        if (srvId === activeServerId && globalTerm) {
          writeTerminalBytes(globalTerm, raw)
        }
    })
    const removeShellRestartedListener = sshManager.onShellRestarted((srvId) => {
        shellBuffers.set(srvId, '')
        if (srvId === activeServerId && globalTerm) {
          globalTerm.reset()
          inputBufRef.current = ''
          setInput('')
        }
    })
    return () => {
      removeShellDataListener()
      removeShellRestartedListener()
    }
  }, [])

  useEffect(() => {
    if (!termRef.current) return
    const darkTheme = {
      background: '#0f0f1a', foreground: '#f1f5f9', cursor: '#35e07a',
      selectionBackground: 'rgba(88,166,255,0.3)',
      black: '#161b22', red: '#f85149', green: '#3fb950', yellow: '#d29922',
      blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#c9d1d9',
    }
    const lightTheme = {
      background: '#f8fafc', foreground: '#1e293b', cursor: '#2563eb',
      selectionBackground: 'rgba(37,99,235,0.2)',
      black: '#e2e8f0', red: '#dc2626', green: '#16a34a', yellow: '#ca8a04',
      blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#0f172a',
    }
    const term = new XTerm({
      theme: isDarkRef.current ? darkTheme : lightTheme,
      fontSize: 14,
      fontFamily: "'JetBrains Mono','Fira Code',monospace",
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 3000,
      smoothScrollDuration: 0,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    // WebLinksAddon removed for vim debugging — link parsing might cause rendering issues on mobile
    term.open(termRef.current)

    const helperTa = term.textarea
    if (helperTa) {
      helperTa.setAttribute('autocorrect', 'off')
      helperTa.setAttribute('autocomplete', 'off')
      helperTa.setAttribute('autocapitalize', 'off')
      helperTa.setAttribute('spellcheck', 'false')
      helperTa.setAttribute('data-gramm', 'false')
      helperTa.setAttribute('inputmode', 'text')
    }

    // OSC 777: shell trap sends executed commands via '\e]777;cmd;<command>\e\\'
    term.parser.registerOscHandler(777, (data) => {
      if (data.startsWith('cmd;')) {
        const cmd = data.slice(4).trim()
        if (cmd && activeServerId && !cmd.includes('stty echo') && !cmd.startsWith('{ trap')) {
          const serverId = activeServerId
          saveHistory(serverId, cmd).then(items => {
            if (activeTabRef.current === serverId) setHistory(items)
          })
        }
      } else if (data.startsWith('pwd;')) {
        const pwd = data.slice(4).trim()
        if (pwd && activeServerId && shellPwds.get(activeServerId) !== pwd) {
          const serverId = activeServerId
          shellPwds.set(serverId, pwd)
          if (activeTabRef.current !== serverId) return true
          setCurrDir(pwd)
          const request = ++fileRequestRef.current
          execCommandRef.current(serverId, `ls -la --color=never "${pwd}"`)
            .then(o => {
              if (request === fileRequestRef.current && activeTabRef.current === serverId && shellPwds.get(serverId) === pwd) {
                setFiles(parseLsOutput(o))
              }
            })
            .catch(() => {})
        }
      }
      return true // don't render the escape sequence
    })

    const mouseModes = new Set([9, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1015, 1016])
    const suppressMouseMode = (params: (number | number[])[]) =>
      params.length > 0 && params.every(param => mouseModes.has(typeof param === 'number' ? param : param[0]))
    // Vim enables DEC mouse tracking while it is active. Android touch events
    // must remain local focus gestures, never SSH input for the remote editor.
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => suppressMouseMode(params))
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => suppressMouseMode(params))

    // Older xterm mouse reports are six bytes long. Android WebView may split
    // those bytes across input callbacks, leaving coordinate bytes such as
    // "@K" to be inserted into vim unless the report is tracked across calls.
    let legacyMouseBytesRemaining = 0
    term.onData(data => {
      const srvId = activeServerId
      if (!srvId) return
      setShowHistory(false)
      if (legacyMouseBytesRemaining > 0) {
        if (data.length <= legacyMouseBytesRemaining) {
          legacyMouseBytesRemaining -= data.length
          return
        }
        data = data.slice(legacyMouseBytesRemaining)
        legacyMouseBytesRemaining = 0
      }
      if (data.startsWith('\x1b[M')) {
        const mouseReportLength = 6
        if (data.length <= mouseReportLength) {
          legacyMouseBytesRemaining = mouseReportLength - data.length
          return
        }
        data = data.slice(mouseReportLength)
      }
      // Mobile taps can be encoded as terminal mouse reports while vim has
      // mouse tracking enabled. They are not keyboard input and can leave
      // visible CSI fragments when a report is split during a redraw.
      if (
        /^\x1b\[<\d+;\d+;\d+[mM]$/.test(data) ||
        /^\x1b\[\d+;\d+;\d+M$/.test(data) ||
        (data.length === 6 && data.startsWith('\x1b[M'))
      ) return
      // Modifier interception: Ctrl / Alt / Shift toggle modifies next key sent to shell
      if (ctrlOnRef.current && data.length === 1 && /[a-z]/i.test(data)) {
        const code = String.fromCharCode(data.toLowerCase().charCodeAt(0) - 96)
        sshManager.writeToShell(srvId, code)
        setCtrl(false)
        return
      }
      if (altOnRef.current && data.length === 1) {
        sshManager.writeToShell(srvId, '\x1b' + data)
        setAlt(false)
        return
      }
      if (shiftOnRef.current && data.length === 1 && /[a-z]/.test(data)) {
        sshManager.writeToShell(srvId, data.toUpperCase())
        setShift(false)
        return
      }
      setShift(false)
      sshManager.writeToShell(srvId, data)
    })

    if (activeTab && shellBuffers.has(activeTab)) {
      writeTerminalBytes(term, shellBuffers.get(activeTab)!)
    }

    const doFit = () => {
      fitAddon.fit()
      term.scrollToBottom()
    }
    let fitFrame = 0
    const scheduleFit = () => {
      cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(doFit)
    }
    doFit()
    const viewport = window.visualViewport
    window.addEventListener('resize', scheduleFit)
    viewport?.addEventListener('resize', scheduleFit)
    const resizeSubscription = term.onResize(({ cols, rows }) => {
      if (activeServerId) sshManager.resizePty(activeServerId, cols, rows)
    })

    xtermRef.current = term
    globalTerm = term
    fitAddonRef.current = fitAddon
    return () => {
      if (globalTerm === term) globalTerm = null
      cancelAnimationFrame(fitFrame)
      window.removeEventListener('resize', scheduleFit)
      viewport?.removeEventListener('resize', scheduleFit)
      resizeSubscription.dispose()
      term.dispose()
      xtermRef.current = null
    }
  }, [])

  // Re-fit XTerm when tab becomes visible (keep-alive pattern)
  const isTabVisible = location.pathname.startsWith('/terminal')
  useEffect(() => {
    if (!isTabVisible) return
    const timer = requestAnimationFrame(() => {
      if (!xtermRef.current || !fitAddonRef.current) return
      fitAddonRef.current.fit()
      xtermRef.current.refresh(0, xtermRef.current.rows)
      xtermRef.current.scrollToBottom()
    })
    return () => cancelAnimationFrame(timer)
  }, [isTabVisible])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const term = xtermRef.current
      if (!term || !fitAddonRef.current) return
      fitAddonRef.current.fit()
      term.refresh(0, term.rows)
      if (!isMaximized) term.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [isMaximized])

  useEffect(() => {
    if (keyboardOpen) setHoldFilePanel(false)
  }, [keyboardOpen])

  useEffect(() => {
    const terminalElement = termRef.current
    if (!terminalElement || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const fitTerminal = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const term = xtermRef.current
        if (!term || !fitAddonRef.current) return
        fitAddonRef.current.fit()
        term.scrollToBottom()
      })
    }
    const observer = new ResizeObserver(fitTerminal)
    observer.observe(terminalElement)
    if (bottomRef.current) observer.observe(bottomRef.current)
    fitTerminal()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [isMaximized])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const term = xtermRef.current
      if (!term || !fitAddonRef.current) return
      fitAddonRef.current.fit()
      term.scrollToBottom()
    })
    return () => cancelAnimationFrame(frame)
  }, [keyboardHeight])

  // Update terminal theme when dark/light changes
  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    if (isDark) {
      term.options.theme = {
        background: '#0f0f1a', foreground: '#f1f5f9', cursor: '#35e07a',
        selectionBackground: 'rgba(88,166,255,0.3)',
        black: '#161b22', red: '#f85149', green: '#3fb950', yellow: '#d29922',
        blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#c9d1d9',
      }
    } else {
      term.options.theme = {
        background: '#f8fafc', foreground: '#1e293b', cursor: '#2563eb',
        selectionBackground: 'rgba(37,99,235,0.2)',
        black: '#e2e8f0', red: '#dc2626', green: '#16a34a', yellow: '#ca8a04',
        blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#0f172a',
      }
    }
    term.refresh(0, term.rows)
  }, [isDark])

  useEffect(() => {
    if (!paramId || tabServers.includes(paramId) || connectingRef.current) return
    const server = servers.find(s => s.id === paramId)
    if (!server?.password) return
    doConnect(paramId)
  }, [paramId, servers])

  useEffect(() => {
    if (activeTab && shellStates.get(activeTab)?.connected && isConnected(activeTab)) {
      setConnected(true)
    }
  }, [])

  const doConnect = useCallback(async (serverId: string) => {
    if (connectingRef.current) return
    connectingRef.current = true
    const server = servers.find(s => s.id === serverId)
    if (!server) { connectingRef.current = false; return }
    try {
      if (!isConnected(serverId)) {
        if (!server.password) {
          const pwd = prompt(`输入 ${server.name} (${server.host}) 的 SSH 密码:`)
          if (!pwd) { connectingRef.current = false; return }
          const result = await connectServer(serverId, pwd)
          if (!result.success) {
            showToast(result.error || '连接失败', 'error')
            connectingRef.current = false
            return
          }
        } else {
          const result = await connectServer(serverId)
          if (!result.success) {
            showToast(result.error || '连接失败', 'error')
            connectingRef.current = false
            return
          }
        }
      }

      // Try startShell with retries
      for (let attempt = 0; attempt < 3; attempt++) {
        // PTY now forwards the server banner during startShell, before the
        // async call resolves. Set this synchronously so the banner renders.
        activeServerId = serverId
        const ok = await sshManager.startShell(serverId)
        if (ok) {
          if (xtermRef.current) {
            sshManager.resizePty(serverId, xtermRef.current.cols, xtermRef.current.rows)
          }
          shellStates.set(serverId, { connected: true })
          setTabServers(prev => prev.includes(serverId) ? prev : [...prev, serverId])
          setActiveTab(serverId)
          setConnected(true)
          inputBufRef.current = ''
          setInput('')
          // The new shell can emit its banner before React commits activeTab.
          // Repaint from its own buffer so the previous server never remains.
          renderBufferedTerminal(serverId)
          connectingRef.current = false
          return
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 800))
      }
      showToast('Shell 启动失败，请确认连接正常后重试', 'error')
      activeServerId = activeTab
    } finally { connectingRef.current = false }
  }, [servers, isConnected, connectServer, showToast])

  const switchTab = useCallback(async (serverId: string) => {
    if (serverId === activeTab) return
    // Input and PTY output can arrive before React applies setActiveTab.
    // Switch this routing key synchronously to keep rapid tab changes isolated.
    activeServerId = serverId
    setActiveTab(serverId)
    setConnected(!!shellStates.get(serverId)?.connected)
    inputBufRef.current = ''
    setInput('')
    if (xtermRef.current) {
      fitAddonRef.current?.fit()
      sshManager.resizePty(serverId, xtermRef.current.cols, xtermRef.current.rows)
      renderBufferedTerminal(serverId)
    }
  }, [activeTab])

  const closeTab = useCallback(async (serverId: string) => {
    await sshManager.stopShell(serverId)
    shellStates.delete(serverId)
    shellBuffers.delete(serverId)
    setTabServers(prev => {
        const next = prev.filter(id => id !== serverId)
        if (activeTab === serverId) {
          const newActive = next[0] || ''
          activeServerId = newActive
          setActiveTab(newActive)
          setConnected(newActive ? !!shellStates.get(newActive)?.connected : false)
          inputBufRef.current = ''
          setInput('')
          if (xtermRef.current) {
            fitAddonRef.current?.fit()
            renderBufferedTerminal(newActive)
          }
      }
      return next
    })
  }, [activeTab])

  const filteredHistory = input ? history.filter(cmd => cmd.toLowerCase().includes(input.toLowerCase())) : []

  const sendKey = (key: string) => {
    if (connected && activeServerId) sshManager.writeToShell(activeServerId, key)
    focusXterm()
  }

  const toggleCtrl = () => { setCtrl(!ctrlOnRef.current); shiftOnRef.current = false; setShiftOn(false); altOnRef.current = false; setAltOn(false); focusXterm(); resetModTimer() }
  const toggleShift = () => { setShift(!shiftOnRef.current); ctrlOnRef.current = false; setCtrlOn(false); altOnRef.current = false; setAltOn(false); focusXterm(); resetModTimer() }
  const toggleAlt = () => { setAlt(!altOnRef.current); shiftOnRef.current = false; setShiftOn(false); ctrlOnRef.current = false; setCtrlOn(false); focusXterm(); resetModTimer() }
  const modTimerRef = useRef(0)

  useEffect(() => () => clearTimeout(modTimerRef.current), [])
  const resetModTimer = () => {
    clearTimeout(modTimerRef.current)
    if (ctrlOnRef.current || altOnRef.current || shiftOnRef.current) {
      modTimerRef.current = window.setTimeout(() => {
        setCtrl(false); setAlt(false); setShift(false)
      }, 3000)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const serverId = activeServerId
      if (!serverId) return
      sshManager.writeToShell(serverId, input + '\r')
      saveHistory(serverId, input).then(setHistory)
      inputBufRef.current = ''
      setInput(''); setShowHistory(false); setShift(false); setCtrl(false); setAlt(false)
    }
  }

  const toggleMaximize = () => {
    if (!isMaximized) {
      // Releasing the focused control dismisses the Android IME before resize.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      globalTerm?.textarea?.blur()
    }
    setIsMaximized(value => !value)
  }

  const preventBlur = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault()
    fn()
  }

  // ─── File panel operations ───

  const navigateTo = async (target: string) => {
    if (!activeTab) return
    const fullPath = target.startsWith('/') ? target : currDir + '/' + target
    sshManager.writeToShell(activeTab, `cd "${fullPath}"\r`)
  }

  const goUp = () => {
    if (!currDir || currDir === '/') return
    const parent = currDir.split('/').slice(0, -1).join('/') || '/'
    sshManager.writeToShell(activeTab, `cd "${parent}"\r`)
  }

  const createItem = async (type: 'file' | 'folder') => {
    if (!activeTab || !newItemName.trim()) return
    const path = currDir + '/' + newItemName.trim()
    try {
      if (type === 'file') {
        await execCommand(activeTab, `touch "${path}"`)
      } else {
        await execCommand(activeTab, `mkdir -p "${path}"`)
      }
      setNewItemInput(null)
      setNewItemName('')
      refreshFiles()
      showToast(`${type === 'file' ? '文件' : '文件夹'}已创建`, 'success')
    } catch {
      showToast('创建失败', 'error')
    }
  }

  const deleteItem = async (fileName: string, isDir: boolean) => {
    if (!activeTab) return
    setDeleteTarget({ name: fileName, isDir })
  }

  const confirmDelete = async () => {
    if (!activeTab || !deleteTarget) return
    const path = currDir + '/' + deleteTarget.name
    try {
      await execCommand(activeTab, deleteTarget.isDir ? `rm -rf "${path}"` : `rm -f "${path}"`)
      setDeleteTarget(null)
      refreshFiles()
      showToast(`已删除 ${deleteTarget.name}`, 'success')
    } catch {
      setDeleteTarget(null)
      showToast('删除失败', 'error')
    }
  }

  const openEditor = async (fileName: string) => {
    if (!activeTab) return
    const path = currDir + '/' + fileName
    setEditingFile({ path, content: '', loading: true })
    try {
      const result = await sshManager.readFileChunk(activeTab, path, 0, LARGE_FILE_CHUNK_BYTES)
      if (result.error) throw new Error(result.content)
      chunkPagesRef.current.clear()
      chunkPagesRef.current.set(1, { offset: 0, firstLine: 1 })
      setChunkPageInput('1')
      setEditingFile({ path, content: result.content, chunk: result.size > LARGE_FILE_CHUNK_BYTES ? { page: 1, offset: 0, size: result.size, bytes: result.bytes, firstLine: 1 } : undefined })
    } catch (error) {
      setEditingFile(null)
      const message = error instanceof Error ? error.message : ''
      showToast(message.includes('editor limit') ? '文件超过 5 MiB，无法在移动端编辑，请下载后处理' : '无法读取文件', 'error')
    }
  }

  const saveFile = async () => {
    if (!editingFile || !activeTab) return
    if (editingFile.chunk) {
      showToast('大文件当前以分块预览方式打开，暂不支持直接保存', 'error')
      return
    }
    try {
      const encoded = btoa(unescape(encodeURIComponent(editingFile.content)))
      const saved = await sshManager.uploadFile(activeTab, editingFile.path, encoded)
      if (!saved) throw new Error('Upload failed')
      setEditingFile(null)
      refreshFiles()
      showToast('文件已保存', 'success')
    } catch {
      showToast('保存失败', 'error')
    }
  }

  const handleUpload = (mode: 'file' | 'folder') => {
    if (!activeTab || !currDir) return
    if (mode === 'folder') {
      setDirectoryUpload({ active: true, name: '正在选择文件夹', progress: 0, uploadedFiles: 0, totalFiles: 0 })
      setShowUploadProgress(true)
      sshManager.uploadDirectory(activeTab, currDir).then(success => {
        setDirectoryUpload(current => current ? { ...current, active: false, progress: success ? 100 : current.progress } : current)
        if (success) {
          refreshFiles()
          showToast('文件夹上传完成', 'success')
        } else {
          showToast('文件夹上传未完成', 'error')
        }
      })
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.onchange = async (e: Event) => {
      const selected = Array.from((e.target as HTMLInputElement).files || [])
      if (selected.length === 0) return
      try {
        const root = currDir.endsWith('/') ? currDir.slice(0, -1) : currDir
        const directories = new Set<string>()
        const uploads = selected.map(file => {
          const relative = file.name
          const path = `${root}/${relative}`
          const parent = path.slice(0, path.lastIndexOf('/'))
          if (parent) directories.add(parent)
          return { file, path }
        })
        for (const directory of Array.from(directories).sort((a, b) => a.length - b.length)) {
          await execCommand(activeTab, `mkdir -p "${directory}"`)
        }
        for (const upload of uploads) transferManager.addUpload(activeTab, activeServer?.name || '服务器', upload.path, upload.file)
        setShowUploadProgress(true)
        showToast(`已开始上传 ${uploads.length} 个文件`, 'success')
        refreshFiles()
      } catch {
        showToast('上传失败', 'error')
      }
    }
    input.click()
  }

  const showPanel = isFilePanelFullscreen || (!isMaximized && !holdFilePanel && connected && (!keyboardOpen || !!newItemInput || !!editingFile) && currDir)

  const serverList = servers.filter(s => !tabServers.includes(s.id))
  const activeServer = servers.find(s => s.id === activeTab)
  const activeTransfers = transferTasks.filter(task => task.serverId === activeTab && (task.status === 'pending' || task.status === 'transferring'))
  const activeTransferCount = activeTransfers.length + (directoryUpload?.active ? 1 : 0)
  const transferProgress = activeTransferCount === 0 ? 0 : Math.round((activeTransfers.reduce((sum, task) => sum + task.progress, 0) + (directoryUpload?.active ? directoryUpload.progress : 0)) / activeTransferCount)

  const btnBase = isDark
    ? 'glass rounded text-slate-300'
    : 'bg-slate-200/60 border border-slate-300/30 rounded text-text-secondary'

  return (
    <div className="relative flex flex-col bg-surface-dark h-full"
      style={{
        paddingTop: 'env(safe-area-inset-top,0px)',
        paddingBottom: isMaximized ? 'max(env(safe-area-inset-bottom, 0px), 16px)' : undefined,
      }}>

      {/* Top bar */}
      {!isMaximized && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2">
          {tabServers.length === 0 ? (
            <ServerSelect servers={servers} onSelect={s => doConnect(s)} />
          ) : (
            <>
              <ServerSelector
                servers={servers.filter(s => tabServers.includes(s.id))}
                selectedId={activeTab}
                tabServers={tabServers}
                onSelect={switchTab}
                onCloseTab={closeTab}
              />
              {serverList.length > 0 && (
                <ServerSelect servers={serverList} onSelect={s => doConnect(s)} compact />
              )}
            </>
          )}
          {activeServer && (
            <span className="text-xs text-text-muted ml-auto truncate">{activeServer.host}</span>
          )}
          <button onClick={toggleMaximize} aria-label="最大化终端"
            className="ml-auto p-1.5 rounded-lg text-text-muted hover:bg-white/10 hover:text-text-primary transition-colors">
            <Maximize2 size={16} />
          </button>
        </div>
      )}

      {activeTransferCount > 0 && !isFilePanelFullscreen && (
        <button onClick={() => setShowUploadProgress(true)} className={`shrink-0 mx-3 mb-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-left ${isDark ? 'bg-primary/15 text-primary-light' : 'bg-primary/10 text-primary'}`}>
          <Upload size={13} />
          <span className="text-xs flex-1">后台上传中：{activeTransferCount} 个任务</span>
          <span className="text-xs font-mono">{transferProgress}%</span>
          <span className="h-1 w-16 overflow-hidden rounded-full bg-primary/20"><span className="block h-full bg-primary" style={{ width: `${transferProgress}%` }} /></span>
        </button>
      )}

      {isMaximized && (
        <button onClick={toggleMaximize} aria-label="恢复终端布局"
          className="absolute right-3 top-[max(env(safe-area-inset-top,0px),0.75rem)] z-20 p-2 rounded-lg bg-black/30 text-slate-200 hover:bg-black/50 transition-colors">
          <Minimize2 size={18} />
        </button>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-5" onClick={() => setDeleteTarget(null)}>
          <div className={`w-full max-w-sm rounded-2xl p-5 shadow-2xl ${isDark ? 'bg-[#161b22]' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
            <div className="mb-2 text-base font-semibold text-text-primary">确认删除{deleteTarget.isDir ? '文件夹' : '文件'}</div>
            <p className="mb-1 text-sm text-text-secondary">将删除以下{deleteTarget.isDir ? '文件夹及其全部内容' : '文件'}：</p>
            <p className={`mb-5 break-all rounded-lg px-3 py-2 text-sm ${isDark ? 'bg-white/5 text-text-primary' : 'bg-slate-100 text-slate-800'}`}>{deleteTarget.name}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className={`flex-1 rounded-xl py-2.5 text-sm font-medium ${isDark ? 'bg-white/10 text-text-secondary' : 'bg-slate-100 text-slate-700'}`}>取消</button>
              <button onClick={confirmDelete} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white">确认删除</button>
            </div>
          </div>
        </div>
      )}

      {/* Terminal */}
      <div className="flex-1 min-h-0">
          <div className="h-full flex flex-col bg-surface-dark">
          <div
            ref={termRef}
            className="terminal-viewport-lock flex-1 min-h-0"
            onTouchStartCapture={(e) => {
              terminalTouchYRef.current = e.touches[0]?.clientY ?? null
              terminalGestureMovedRef.current = false
            }}
            onTouchMoveCapture={(e) => {
              const startY = terminalTouchYRef.current
              const currentY = e.touches[0]?.clientY
              if (startY !== null && currentY !== undefined && Math.abs(currentY - startY) > 8) {
                terminalGestureMovedRef.current = true
                const isUpwardSwipe = currentY < startY
                // Keep keyboard-dismiss and normal-layout upward gestures from
                // revealing the file panel beneath the terminal.
                if (keyboardOpen || (!isMaximized && isUpwardSwipe)) setHoldFilePanel(true)
                terminalTouchYRef.current = null
              }
            }}
            onTouchEndCapture={() => { terminalTouchYRef.current = null }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button')) return
              if (terminalGestureMovedRef.current) {
                terminalGestureMovedRef.current = false
                return
              }
              if (isMaximized) {
                toggleMaximize()
                return
              }
              focusXterm()
            }}
          />

          {/* Bottom bar */}
          {!isMaximized && (
          <div ref={bottomRef} className={`shrink-0 relative ${isDark ? 'border-t border-white/5 bg-black/20' : 'border-t border-black/5 bg-black/5'}`}>
            {/* History dropdown */}
            {showHistory && filteredHistory.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 glass rounded-xl py-1 max-h-40 overflow-y-auto border border-border/30 z-10 mx-2">
                {filteredHistory.map((cmd, idx) => (
                  <button key={idx} onClick={() => {
                    setInput(cmd)
                    setShowHistory(false)
                    inputRef.current?.focus()
                  }}
                  className="w-full text-left px-3 py-1.5 text-[12px] font-mono hover:bg-white/5 truncate text-text-secondary">
                    {cmd}
                  </button>
                ))}
              </div>
            )}

            {/* Command input row */}
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <span className="text-accent text-xs font-mono shrink-0">$</span>
              <input ref={inputRef} type="text" value={input}
                onChange={e => {
                  const v = e.target.value
                  inputBufRef.current = v
                  setInput(v)
                  setShowHistory(v.length > 0)
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (input.length > 0) setShowHistory(true) }}
                placeholder={connected ? '输入命令后回车发送' : '未连接'}
                disabled={!connected}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                enterKeyHint="send"
                className="flex-1 bg-transparent text-xs text-text-primary outline-none font-mono placeholder:text-text-muted/60 min-w-0"
              />
              <button onClick={() => setShowHistory(p => !p)}
                className={`p-0.5 rounded ${showHistory ? 'text-primary-light' : 'text-text-muted'}`}>
                <ChevronDown size={11} />
              </button>
            </div>

            {/* Function key grid: 7 columns */}
            {connected && (
              <div className="grid grid-cols-7 gap-1 px-2 pb-2">
                {/* Row 1: Esc Alt Home ↑ End Shift / */}
                <button onMouseDown={preventBlur(() => sendKey('\x1b'))}
                  className={`${btnBase} text-[11px] flex items-center justify-center min-h-[28px]`}>Esc</button>
                <button onMouseDown={preventBlur(toggleAlt)}
                  className={`rounded text-[11px] flex items-center justify-center min-h-[28px] ${
                    altOn ? 'bg-accent/20 text-accent-light' : btnBase
                  }`}>Alt</button>
                <button onMouseDown={preventBlur(() => sendKey('\x1bOH'))}
                  className={`${btnBase} text-[11px] flex items-center justify-center min-h-[28px]`}>Home</button>
                <button onMouseDown={preventBlur(() => sendKey('\x1b[A'))}
                  className={`${btnBase} flex items-center justify-center min-h-[28px]`}><ArrowUp size={13} /></button>
                <button onMouseDown={preventBlur(() => sendKey('\x1bOF'))}
                  className={`${btnBase} text-[11px] flex items-center justify-center min-h-[28px]`}>End</button>
                <button onMouseDown={preventBlur(toggleShift)}
                  className={`rounded text-[11px] flex items-center justify-center min-h-[28px] ${
                    shiftOn ? 'bg-primary/20 text-primary-light' : btnBase
                  }`}>Shift</button>
                <button onMouseDown={preventBlur(() => sendKey('/'))}
                  className={`${btnBase} flex items-center justify-center min-h-[28px]`}><Slash size={13} /></button>

                {/* Row 2: Tab Ctrl ← ↓ → | - */}
                <button onMouseDown={preventBlur(() => sendKey('\t'))}
                  className={`${btnBase} text-[11px] flex items-center justify-center min-h-[28px]`}>Tab</button>
                <button onMouseDown={preventBlur(toggleCtrl)}
                  className={`rounded text-[11px] flex items-center justify-center min-h-[28px] ${
                    ctrlOn ? 'bg-accent/20 text-accent-light' : btnBase
                  }`}>Ctrl</button>
                <button onMouseDown={preventBlur(() => sendKey('\x1b[D'))}
                  className={`${btnBase} flex items-center justify-center min-h-[28px]`}><ArrowLeft size={13} /></button>
                <button onMouseDown={preventBlur(() => sendKey('\x1b[B'))}
                  className={`${btnBase} flex items-center justify-center min-h-[28px]`}><ArrowDown size={13} /></button>
                <button onMouseDown={preventBlur(() => sendKey('\x1b[C'))}
                  className={`${btnBase} flex items-center justify-center min-h-[28px]`}><ArrowRight size={13} /></button>
                <button onMouseDown={preventBlur(() => sendKey('|'))}
                  className={`${btnBase} text-[11px] flex items-center justify-center min-h-[28px]`}>|</button>
                <button onMouseDown={preventBlur(() => sendKey('-'))}
                  className={`${btnBase} flex items-center justify-center min-h-[28px]`}><Minus size={13} /></button>
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {/* File browser panel */}
      {showPanel && (
        <div className={`${isFilePanelFullscreen ? 'fixed inset-0 z-50 pt-safe pb-safe' : 'flex-1 min-h-0 border-t'} flex flex-col ${isDark ? 'bg-[#0d1117] border-white/5' : 'bg-white border-black/5'}`}>
          {/* Breadcrumb + actions */}
          <div className="shrink-0 px-3 py-2 flex items-center gap-2">
            <button onClick={goUp} className="p-2 rounded-xl hover:bg-white/5 transition-colors flex-shrink-0" title="返回上级目录">
              <ArrowUp size={17} className="text-text-secondary" />
            </button>
            <button onClick={refreshFiles} className="p-2 rounded-xl hover:bg-white/5 transition-colors flex-shrink-0" title="刷新文件列表">
              <RefreshCw size={16} className="text-text-muted" />
            </button>
            <span className="text-xs text-text-secondary truncate flex-1">{currDir}</span>
            <button onClick={() => setIsFilePanelFullscreen(value => !value)} className="p-2 rounded-xl hover:bg-white/5 transition-colors flex-shrink-0" title={isFilePanelFullscreen ? '退出全屏' : '文件面板全屏'}>
              {isFilePanelFullscreen ? <Minimize2 size={17} className="text-text-muted" /> : <Maximize2 size={17} className="text-text-muted" />}
            </button>
          </div>

          <div className="shrink-0 flex gap-2 overflow-x-auto px-3 pb-2">
            <button onClick={() => setNewItemInput('file')} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary/10 px-3 text-xs font-medium text-primary-light hover:bg-primary/20" title="新建文件">
              <FileText size={17} /> 新建文件
            </button>
            <button onClick={() => setNewItemInput('folder')} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent/10 px-3 text-xs font-medium text-accent hover:bg-accent/20" title="新建文件夹">
              <FolderPlus size={17} /> 新建文件夹
            </button>
            <button onClick={() => handleUpload('file')} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-blue-500/10 px-3 text-xs font-medium text-blue-400 hover:bg-blue-500/20" title="上传文件">
              <Upload size={17} /> 上传文件
            </button>
            <button onClick={() => handleUpload('folder')} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-violet-500/10 px-3 text-xs font-medium text-violet-400 hover:bg-violet-500/20" title="上传文件夹">
              <FolderUp size={17} /> 上传文件夹
            </button>
          </div>

          {/* New item input */}
          {newItemInput && (
            <div className={`mx-3 mb-1.5 flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${isDark ? 'border-primary/50 bg-primary/10' : 'border-primary/40 bg-primary/5'}`}>
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary-light">新建{newItemInput === 'file' ? '文件' : '文件夹'}</span>
              <input value={newItemName} onChange={e => setNewItemName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createItem(newItemInput); if (e.key === 'Escape') { setNewItemInput(null); setNewItemName(''); } }}
                autoFocus className="flex-1 bg-white/5 rounded-lg px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted"
                placeholder={`输入${newItemInput === 'file' ? '文件' : '文件夹'}名称后回车`} />
              <button onClick={() => { setNewItemInput(null); setNewItemName(''); }} className="text-xs text-text-muted px-1">取消</button>
            </div>
          )}

          {/* File list */}
          <div className="flex-1 overflow-y-auto px-3 pb-20">
            {files.length === 0 ? (
              <div className="text-center py-6 text-xs text-text-muted">空目录</div>
            ) : files.map((f, i) => (
              <div key={f.name + i}
                className="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors group border-b border-white/[0.03] last:border-b-0">
                <button
                  onClick={() => f.type === 'dir' ? navigateTo(f.name) : openEditor(f.name)}
                  className="flex-1 min-w-0 text-left flex items-start gap-2">
                  {f.type === 'dir' ? <FolderOpen size={14} className="text-blue-400 flex-shrink-0 mt-0.5" /> : <File size={14} className="text-text-muted flex-shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-text-primary break-all leading-relaxed">{f.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-text-muted">{formatSize(f.size)}</span>
                      {f.date && <span className="text-[9px] text-text-muted">{f.date}</span>}
                      <span className="text-[9px] text-text-muted font-mono">{f.perms}</span>
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteItem(f.name, f.type === 'dir') }}
                  className="p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-400 flex-shrink-0">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showUploadProgress && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-5" onClick={() => setShowUploadProgress(false)}>
          <div className={`w-full rounded-2xl p-4 ${isDark ? 'bg-[#161b22]' : 'bg-white'}`} onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <Upload size={18} className="text-primary" />
              <div className="flex-1">
                <div className="text-sm font-medium text-text-primary">上传进度</div>
                <div className="text-xs text-text-muted">传输会在后台持续运行</div>
              </div>
              <button onClick={() => setShowUploadProgress(false)} className="p-1 text-text-muted"><X size={16} /></button>
            </div>
            <div className="max-h-64 space-y-3 overflow-y-auto">
              {directoryUpload && (
                <div className={`rounded-xl p-3 ${isDark ? 'bg-white/5' : 'bg-slate-100'}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate text-text-secondary">文件夹：{directoryUpload.name}</span>
                    <span className="text-text-muted">{directoryUpload.active ? `${directoryUpload.progress}%` : '已完成'}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-primary" style={{ width: `${directoryUpload.progress}%` }} /></div>
                  <div className="mt-1 text-[10px] text-text-muted">{directoryUpload.totalFiles > 0 ? `${directoryUpload.uploadedFiles} / ${directoryUpload.totalFiles} 个文件` : '等待选择文件夹'}</div>
                </div>
              )}
              {transferTasks.filter(task => task.serverId === activeTab && task.direction === 'upload').map(task => (
                <div key={task.id} className={`rounded-xl p-3 ${isDark ? 'bg-white/5' : 'bg-slate-100'}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate text-text-secondary">{task.fileName}</span>
                    <span className={task.status === 'failed' ? 'text-red-400' : 'text-text-muted'}>{task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : `${task.progress}%`}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={task.status === 'failed' ? 'h-full bg-red-400' : task.status === 'completed' ? 'h-full bg-green-400' : 'h-full bg-primary'} style={{ width: `${task.progress}%` }} /></div>
                  <div className="mt-1 text-[10px] text-text-muted">{formatSize(task.transferredBytes)} / {formatSize(task.totalBytes)}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowUploadProgress(false)} className="mt-4 w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-white">后台运行</button>
          </div>
        </div>
      )}

      {/* File editor modal */}
      {editingFile && (() => {
        const ext = editingFile.path.split('.').pop()?.toLowerCase() || ''
        const content = editingFile.content
        const loading = editingFile.loading === true
        const isShell = ext === 'sh' || ext === 'bash'
        const isChunked = !!editingFile.chunk
        const isLarge = isChunked || content.length > 500000

        const lineCount = loading ? 0 : content.split('\n').length
        const lineNumbers = isChunked
          ? Array.from({ length: Math.max(lineCount, 1) }, (_, i) => editingFile.chunk!.firstLine + i).join('\n')
          : Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1).join('\n')

        const searchLower = searchQuery.toLowerCase()
        const searchMatches: number[] = !loading && searchLower ? (() => {
          const m: number[] = []
          let idx = -1
          const cl = content.toLowerCase()
          while ((idx = cl.indexOf(searchLower, idx + 1)) !== -1) m.push(idx)
          return m
        })() : []
        const safeIdx = searchMatches.length > 0 ? ((searchIndex % searchMatches.length) + searchMatches.length) % searchMatches.length : 0

        const scrollToMatch = (matchPos: number) => {
          if (searchMatches.length === 0) return
          const ta = isLarge ? largeEditorTextareaRef.current : editorTextareaRef.current
          if (!ta) return
          ta.focus()
          ta.setSelectionRange(matchPos, matchPos + searchQuery.length)
          const line = content.slice(0, matchPos).split('\n').length - 1
          const scroll = editorScrollRef.current
          if (scroll) scroll.scrollTop = Math.max(0, line * 22 - scroll.clientHeight / 3)
        }

        const navigateSearch = (dir: number) => {
          if (searchMatches.length === 0) return
          const nextIndex = ((safeIdx + dir) + searchMatches.length) % searchMatches.length
          setSearchIndex(nextIndex)
          requestAnimationFrame(() => scrollToMatch(searchMatches[nextIndex]))
        }

        const focusEditor = () => (isLarge ? largeEditorTextareaRef.current : editorTextareaRef.current)?.focus()
        const loadChunk = async (targetPage: number) => {
          if (!editingFile.chunk || !activeTab) return
          const maxPage = Math.max(1, Math.ceil(editingFile.chunk.size / LARGE_FILE_CHUNK_BYTES))
          const page = Math.max(1, Math.min(targetPage, maxPage))
          const current = editingFile.chunk
          chunkPagesRef.current.set(current.page + 1, {
            offset: current.offset + current.bytes,
            firstLine: current.firstLine + lineCount,
          })

          let pageMeta = chunkPagesRef.current.get(page)
          if (!pageMeta) {
            const knownPages = Array.from(chunkPagesRef.current.keys()).filter(p => p < page)
            let knownPage = Math.max(...knownPages)
            let knownMeta = chunkPagesRef.current.get(knownPage)!
            while (knownPage < page) {
              const result = await sshManager.readFileChunk(activeTab, editingFile.path, knownMeta.offset, LARGE_FILE_CHUNK_BYTES)
              if (result.error || result.bytes === 0) {
                showToast('无法读取目标页', 'error')
                return
              }
              knownPage++
              knownMeta = {
                offset: knownMeta.offset + result.bytes,
                firstLine: knownMeta.firstLine + result.content.split('\n').length,
              }
              chunkPagesRef.current.set(knownPage, knownMeta)
            }
            pageMeta = knownMeta
          }
          setEditingFile({ ...editingFile, loading: true })
          const result = await sshManager.readFileChunk(activeTab, editingFile.path, pageMeta.offset, LARGE_FILE_CHUNK_BYTES)
          if (result.error) {
            setEditingFile(null)
            showToast('无法读取文件区块', 'error')
            return
          }
          setSearchIndex(0)
          setChunkPageInput(String(page))
          setEditingFile({ path: editingFile.path, content: result.content, chunk: { page, offset: pageMeta.offset, size: result.size, bytes: result.bytes, firstLine: pageMeta.firstLine } })
          requestAnimationFrame(() => {
            if (editorScrollRef.current) editorScrollRef.current.scrollTop = 0
          })
        }

        const extColor = ext === 'sh' || ext === 'bash' ? 'text-orange-400' :
          ext === 'py' ? 'text-blue-400' : ext === 'js' || ext === 'ts' ? 'text-yellow-400' :
          ext === 'json' ? 'text-green-400' : ext === 'yml' || ext === 'yaml' ? 'text-red-400' : 'text-text-muted'
        const extBg = ext === 'sh' || ext === 'bash' ? 'bg-orange-400/10' :
          ext === 'py' ? 'bg-blue-400/10' : ext === 'js' || ext === 'ts' ? 'bg-yellow-400/10' :
          ext === 'json' ? 'bg-green-400/10' : ext === 'yml' || ext === 'yaml' ? 'bg-red-400/10' : 'bg-white/5'

        const escapeHtml = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        const highlights = isShell && !isLarge ? (() => {
          const hl = isDark ? { comment:'#6e7681',str:'#d2a864',kw:'#c586c0',var:'#e06c75',num:'#79c0ff',op:'#dcdcaa',cmd:'#7dcfff',text:'#c9d1d9' }
            : { comment:'#6a737d',str:'#6f42c1',kw:'#d73a49',var:'#e36209',num:'#005cc5',op:'#dcdcaa',cmd:'#1b7c83',text:'#24292e' }
          const kw = new Set(['if','then','else','elif','fi','for','while','do','done','case','esac','function','return','exit','export','source','alias','unalias','readonly','local','declare','typeset','in','break','continue','select','until','trap','unset','shift','set'])
          const cmd = new Set(['echo','cd','ls','cat','grep','awk','sed','chmod','chown','mkdir','rm','cp','mv','printf','read','test','kill','wait','sleep','tar','gzip','gunzip','find','sort','uniq','wc','head','tail','cut','tr','tee','xargs','basename','dirname'])
          let html = '', i = 0
          const e=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          while (i < content.length) {
            if (content[i] === '#' && (i===0||content[i-1]===' '||content[i-1]==='\t'||content[i-1]==='\n')) { let j=i; while(j<content.length&&content[j]!=='\n')j++; html+=`<span style="color:${hl.comment}">${e(content.slice(i,j))}</span>`; i=j; continue }
            if (content[i]==="'") { let j=i+1; while(j<content.length&&content[j]!=="'")j++; if(j<content.length)j++; html+=`<span style="color:${hl.str}">${e(content.slice(i,j))}</span>`; i=j; continue }
            if (content[i]==='"') { let j=i+1; while(j<content.length&&content[j]!=='"') { if(content[j]==='\\')j++; j++ } if(j<content.length)j++; html+=`<span style="color:${hl.str}">${e(content.slice(i,j))}</span>`; i=j; continue }
            if (content[i]==='$'&&i+1<content.length) { let j=i+1; if(content[j]==='{'){while(j<content.length&&content[j]!=='}')j++;if(j<content.length)j++}else if(/\d/.test(content[j])||'?!@#*'.includes(content[j]))j++;else{while(j<content.length&&/[a-zA-Z0-9_]/.test(content[j]))j++} html+=`<span style="color:${hl.var}">${e(content.slice(i,j))}</span>`; i=j; continue }
            if (/[a-zA-Z_]/.test(content[i])) { let j=i; while(j<content.length&&/[a-zA-Z0-9_-]/.test(content[j]))j++; const w=content.slice(i,j); html+=kw.has(w)?`<span style="color:${hl.kw}">${w}</span>`:cmd.has(w)?`<span style="color:${hl.cmd}">${w}</span>`:`<span style="color:${hl.text}">${w}</span>`; i=j; continue }
            if (/\d/.test(content[i])) { let j=i; while(j<content.length&&/\d/.test(content[j]))j++; html+=`<span style="color:${hl.num}">${e(content.slice(i,j))}</span>`; i=j; continue }
            if ('&|;<>(){}[]!='.includes(content[i])) { html+=`<span style="color:${hl.op}">${e(content[i])}</span>`; i++; continue }
            html += e(content[i]); i++
          }
          return html
        })() : escapeHtml(content)

        const enhancedHtml = !loading && searchQuery && (!isLarge || isChunked) ? (() => {
          const escQ = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const regex = new RegExp('(' + escQ + ')', 'gi')
          let matchI = 0
          const markBg = isDark ? 'bg-primary/40' : 'bg-yellow-300/60'
          const curBg = isDark ? 'bg-amber-400/60 text-black' : 'bg-amber-400 text-black'
          return highlights.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag, text) => {
            if (tag) return tag
            return text.replace(regex, (matched: string) => {
              const isCur = matchI === safeIdx
              matchI++
              return `<mark class="${isCur ? curBg : markBg} rounded-sm">${matched}</mark>`
            })
          })
        })() : highlights

        const editorFont = 'text-[12px] font-mono leading-[22px]'
        const editorBg = isDark ? 'bg-[#0a0a14]' : 'bg-[#fafbfc]'

        return (
        <div className="fixed inset-0 z-[120] flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top,0px)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
          <div className={`shrink-0 flex items-center gap-2 px-3 py-2.5 border-b ${isDark ? 'bg-[#0d1117] border-white/[0.06]' : 'bg-white border-black/[0.06]'}`}>
            <button onClick={() => { setEditingFile(null); setShowSearch(false); setSearchQuery('') }}
              className="text-xs text-text-muted px-2 py-1 hover:bg-white/5 rounded-lg flex items-center gap-1">
              <ArrowLeft size={12} /> 返回
            </button>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <FileCode size={14} className="text-text-muted flex-shrink-0" />
              <span className="text-xs text-text-primary font-mono truncate">{editingFile.path.split('/').pop()}</span>
              {ext && <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-medium ${extColor} ${extBg} flex-shrink-0`}>.{ext}</span>}
              {isChunked && <span className="text-[9px] text-yellow-400 font-medium flex-shrink-0">分块预览</span>}
              {isLarge && !isChunked && <span className="text-[9px] text-yellow-400 font-medium flex-shrink-0">大文件</span>}
            </div>
            {!loading && (
              <button onClick={() => { setShowSearch(!showSearch); if (!showSearch) { setSearchQuery(''); setSearchIndex(0); requestAnimationFrame(() => searchInputRef.current?.focus()) } else { focusEditor() } }}
                className={`text-xs px-2 py-1 rounded-lg flex items-center gap-1 transition-colors ${showSearch ? 'bg-primary/20 text-primary' : 'text-text-muted hover:bg-white/5'}`}>
                <Search size={14} />
              </button>
            )}
            {!loading && !isChunked && <button onClick={saveFile} className="flex items-center gap-1 text-xs text-white px-3 py-1.5 bg-primary hover:bg-primary/80 rounded-lg font-medium transition-colors"><Save size={12} /> 保存</button>}
          </div>
          {!loading && showSearch && (
            <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b ${isDark ? 'bg-[#0d1117]/80 border-white/[0.06]' : 'bg-white/80 border-black/[0.06]'}`}>
              <Search size={12} className="text-text-muted shrink-0" />
              <input ref={searchInputRef} value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSearchIndex(0) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); navigateSearch(e.shiftKey ? -1 : 1) }
                  if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); focusEditor() }
                }}
                placeholder="查找..."
                className={`flex-1 rounded-md border px-2 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none min-w-0 ${isDark ? 'bg-[#161b22] border-white/10 focus:border-primary/60' : 'bg-slate-100 border-slate-300 focus:border-primary/60'}`} />
              {searchQuery && (
                <span className={`text-[10px] shrink-0 ${searchMatches.length > 0 ? 'text-text-secondary' : 'text-red-400'}`}>
                  {searchMatches.length > 0 ? `${safeIdx + 1} / ${searchMatches.length}` : '无结果'}
                </span>
              )}
              <button onClick={() => navigateSearch(-1)} disabled={searchMatches.length === 0}
                className="p-1 text-text-muted hover:text-text-secondary disabled:opacity-30 rounded"><ArrowUp size={14} /></button>
              <button onClick={() => navigateSearch(1)} disabled={searchMatches.length === 0}
                className="p-1 text-text-muted hover:text-text-secondary disabled:opacity-30 rounded"><ArrowDown size={14} /></button>
              <button onClick={() => { setShowSearch(false); setSearchQuery(''); focusEditor() }}
                className="p-1 text-text-muted hover:text-text-secondary rounded"><X size={14} /></button>
            </div>
          )}
          {loading ? (
            <div className={`flex-1 flex items-center justify-center ${editorBg}`}>
              <div className="flex flex-col items-center gap-3 text-text-muted">
                <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-xs">正在读取文件...</span>
              </div>
            </div>
          ) : (
          <div ref={editorScrollRef} className={`flex-1 min-h-0 overflow-auto ${editorBg}`}>
            <div className="flex min-w-full min-h-full">
              <pre className={`sticky left-0 z-10 m-0 shrink-0 self-start py-3 pl-3 pr-2 select-none text-right text-[11px] leading-[22px] font-mono ${isDark ? 'bg-[#0d1117] text-slate-600 border-r border-white/[0.04]' : 'bg-slate-50 text-slate-400 border-r border-black/[0.04]'}`} style={{ fontFamily: 'inherit', tabSize: 2 }}>{lineNumbers}</pre>
              <div className="relative min-w-0 flex-1 self-stretch">
              {(!isLarge || isChunked) && <pre className={`absolute inset-0 m-0 p-3 whitespace-pre-wrap break-words pointer-events-none ${editorFont} ${isDark ? 'text-[#c9d1d9]' : 'text-slate-800'}`}
                style={{ fontFamily: 'inherit', tabSize: 2 }}
                dangerouslySetInnerHTML={{ __html: enhancedHtml + '\n' }} />}
              <textarea ref={isLarge ? largeEditorTextareaRef : editorTextareaRef} value={content} readOnly={isChunked} onChange={e => setEditingFile({ path: editingFile.path, content: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Tab') { e.preventDefault(); const ta = e.currentTarget, s = ta.selectionStart, en = ta.selectionEnd, v = content; setEditingFile({ path: editingFile.path, content: v.substring(0, s) + '  ' + v.substring(en) }); requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2 }) }
                }}
                className={`relative block w-full min-h-full p-3 pb-12 outline-none resize-none overflow-hidden border-0 ${isLarge && !isChunked ? `${editorBg} ${isDark ? 'text-[#c9d1d9] placeholder:text-slate-600' : 'text-slate-800 placeholder:text-slate-300'}` : ''}`} style={{ height: `${Math.max(lineCount * 22 + 24, 1)}px`, color: isLarge && !isChunked ? undefined : 'transparent', caretColor: isDark ? '#58a6ff' : '#2563eb', backgroundColor: isLarge && !isChunked ? undefined : 'transparent', fontFamily: 'inherit', tabSize: 2, fontSize: '12px', lineHeight: '22px' }}
                spellCheck={false} autoCorrect="off" autoCapitalize="off" placeholder={isLarge ? '大文件模式，无语法高亮，纯文本编辑...' : '# 在此编辑脚本内容...'} />
              </div>
            </div>
          </div>
          )}
          {!loading && <div className={`shrink-0 flex items-center gap-3 px-3 py-1.5 border-t text-[10px] ${isDark ? 'bg-[#0d1117] border-white/[0.06] text-slate-500' : 'bg-white border-black/[0.06] text-slate-400'}`}>
            {isChunked ? <>
              <button onClick={() => loadChunk(editingFile.chunk!.page - 1)} disabled={editingFile.chunk!.page === 1} className="text-text-secondary disabled:opacity-30">上一页</button>
              <div className="flex items-center gap-1">
                <span>第</span>
                <input type="number" min="1" value={chunkPageInput} onChange={e => setChunkPageInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') loadChunk(Number(chunkPageInput)) }} className={`w-10 rounded border px-1 py-0.5 text-center outline-none ${isDark ? 'bg-[#161b22] border-white/10' : 'bg-slate-100 border-slate-300'}`} />
                <button onClick={() => loadChunk(Number(chunkPageInput))} className="text-primary">跳转</button>
              </div>
              <span>{editingFile.chunk!.firstLine.toLocaleString()}–{(editingFile.chunk!.firstLine + lineCount - 1).toLocaleString()} 行</span>
              <button onClick={() => loadChunk(editingFile.chunk!.page + 1)} disabled={editingFile.chunk!.offset + editingFile.chunk!.bytes >= editingFile.chunk!.size} className="text-text-secondary disabled:opacity-30">下一页</button>
            </> : <>
              <span className="flex items-center gap-1"><Hash size={10} />{content.length.toLocaleString()} 字符</span>
              <span>{lineCount} 行</span>
            </>}
            <span className="flex-1" />
            <span className="font-mono text-text-muted truncate">{editingFile.path}</span>
          </div>}
        </div>
        )
      })()}
    </div>
  )
}

function ServerSelector({ servers, selectedId, tabServers, onSelect, onCloseTab }: {
  servers: any[]
  selectedId: string
  tabServers: string[]
  onSelect: (id: string) => void
  onCloseTab: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const selected = servers.find(s => s.id === selectedId)

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setSearch('')
    setOpen(!open)
  }

  const q = search.toLowerCase()
  const filtered = tabServers.filter(sid => {
    const s = servers.find((x: any) => x.id === sid)
    if (!s) return false
    return s.name.toLowerCase().includes(q) || s.host.toLowerCase().includes(q)
  })

  return (
    <>
      <button ref={btnRef} onClick={toggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass text-sm font-medium text-text-primary">
        <span className={`w-2 h-2 rounded-full shrink-0 ${shellStates.get(selectedId)?.connected ? 'bg-green-400' : 'bg-gray-500'}`} />
        <span className="max-w-[120px] truncate">{selected?.name || '选择'}</span>
        <ChevronDown size={12} className="text-text-muted" />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div className="fixed z-[101] glass rounded-xl py-1 w-56 max-h-64 overflow-hidden flex flex-col"
            style={{ top: pos.top, left: pos.left }}>
            {tabServers.length > 3 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/5">
                <Search size={12} className="text-text-muted shrink-0" />
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="搜索..."
                  className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none" />
              </div>
            )}
            <div className="overflow-y-auto max-h-52">
              {filtered.map(sid => {
                const s = servers.find((x: any) => x.id === sid)
                if (!s) return null
                return (
                  <div key={s.id} className="flex items-center hover:bg-white/5 transition-colors">
                    <button onClick={() => { onSelect(s.id); setOpen(false) }}
                      className={`flex-1 text-left px-3 py-2.5 ${s.id === selectedId ? 'bg-primary/10' : ''}`}>
                      <div className="flex items-center gap-2 text-sm text-text-secondary">
                        {shellStates.get(s.id)?.connected && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />}
                        <span className="truncate">{s.name}</span>
                      </div>
                      <div className="text-text-muted text-xs ml-4">{s.host}:{s.port}</div>
                    </button>
                    {tabServers.length > 1 && (
                      <button onClick={() => { onCloseTab(s.id); if (tabServers.length <= 2) setOpen(false) }}
                        className="shrink-0 px-2 py-2.5 text-danger text-xs hover:bg-danger/5">关闭</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}

function ServerSelect({ servers, onSelect, compact }: {
  servers: any[]
  onSelect: (sid: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: compact ? 192 : r.width })
    }
    setSearch('')
    setOpen(!open)
  }

  const q = search.toLowerCase()
  const filtered = servers.filter(s =>
    s.name.toLowerCase().includes(q) || s.host.toLowerCase().includes(q)
  )

  return (
    <>
      <button ref={btnRef} onClick={toggle}
        className={`glass rounded-lg flex items-center text-[13px] ${
          compact ? 'px-2.5 py-1.5 shrink-0 text-text-secondary' : 'w-full px-3 py-2 justify-between text-text-secondary'
        }`}>
        {compact ? '+' : '选择服务器'}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div className="fixed z-[101] glass rounded-xl py-1 max-h-64 overflow-hidden flex flex-col"
            style={{ top: pos.top, left: pos.left, width: compact ? 192 : pos.width || undefined }}>
            {servers.length > 3 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/5">
                <Search size={12} className="text-text-muted shrink-0" />
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="搜索..."
                  className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none" />
              </div>
            )}
            <div className="overflow-y-auto max-h-52">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-muted">{search ? '无匹配结果' : '没有可用服务器'}</div>
              ) : filtered.map((s: any) => (
                <button key={s.id} onClick={() => { onSelect(s.id); setOpen(false) }}
                  className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors">
                  <div className="text-sm text-text-secondary truncate">{s.name}</div>
                  <div className="text-text-muted text-xs">{s.host}:{s.port}</div>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
