import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { Folder, File as LucideFile, ArrowUp, ArrowLeft, ArrowRight, Search, Upload, FileText, FolderPlus, Trash2, Loader2, Server, Download, X, CheckCircle, XCircle, ArrowUpCircle, ArrowDownCircle, Save, FileCode, Copy, RefreshCw, Menu, MoreVertical, Archive, Bookmark, MoveRight, ListFilter, Eye, EyeOff, ChevronRight, Plus, Minus, Maximize, Check, PenLine, FolderArchive, ImageIcon, Zap, FileEdit, Wrench, ChevronLeft } from 'lucide-react'
import { useToast } from '../components/ui/Toast'
import { useServers } from '../store/ServerContext'
import { transferManager } from '../services/transferManager'

const LARGE_FILE_CHUNK_BYTES = 100000
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif'])
const TEXT_EDITABLE_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties',
  '.html', '.htm', '.css', '.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte',
  '.py', '.rb', '.php', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.cs', '.go', '.rs', '.sh', '.bash', '.zsh', '.fish', '.pl', '.pm', '.lua', '.r', '.m', '.mm',
  '.sql', '.graphql', '.proto',
  '.log', '.csv', '.tsv', '.diff', '.patch',
  '.gitignore', '.dockerignore', '.editorconfig',
  '.sln', '.csproj', '.vbproj', '.fsproj',
  '.ps1', '.psm1', '.bat', '.cmd',
])
const NON_EDITABLE_EXTENSIONS = new Set(['.apk', '.ipa', '.exe', '.dll', '.so', '.a', '.o', '.bin', '.dat', '.db', '.sqlite', '.sqlite3', '.class', '.jar', '.war', '.ear', '.dex', '.odex', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tiff', '.tif', '.heic', '.heif', '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.ogg', '.wav', '.flac', '.aac', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.ttf', '.otf', '.woff', '.woff2', '.eot', '.epub', '.mobi', '.dmg', '.iso', '.img', '.psd', '.ai', '.sketch', '.lock', '.sum'])
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.tbz', '.tbz2', '.xz', '.txz', '.7z', '.rar', '.zst', '.lz', '.lz4', '.lzo', '.lzma', '.z', '.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst', '.tar.lz', '.tar.lz4', '.tar.lzo', '.tar.lzma', '.tar.z'])

function isImageFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function isTextEditableFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (!name.includes('.')) return true
  if (TEXT_EDITABLE_EXTENSIONS.has(ext)) return true
  if (NON_EDITABLE_EXTENSIONS.has(ext)) return false
  return true
}

function isArchiveFile(name: string): boolean {
  const lower = name.toLowerCase()
  for (const ext of [...ARCHIVE_EXTENSIONS].sort((a, b) => b.length - a.length)) {
    if (lower.endsWith(ext) && lower !== ext) return true
  }
  return false
}

function imageMimeType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const map: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.tiff': 'image/tiff', '.tif': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif' }
  return map[ext] || 'image/png'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

function formatDateFull(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function permsToOctal(perms: Record<string, boolean>): string {
  let spec = 0
  if (perms.suid) spec += 4
  if (perms.sgid) spec += 2
  if (perms.sticky) spec += 1
  let owner = 0
  if (perms.ur) owner += 4
  if (perms.uw) owner += 2
  if (perms.ux) owner += 1
  let group = 0
  if (perms.gr) group += 4
  if (perms.gw) group += 2
  if (perms.gx) group += 1
  let other = 0
  if (perms.or) other += 4
  if (perms.ow) other += 2
  if (perms.ox) other += 1
  return String(spec * 1000 + owner * 100 + group * 10 + other).padStart(4, '0')
}


interface FileItem {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modified: number
  permissions: string
  owner: string
  group: string
}

interface TabState {
  currentPath: string
  selectedFile: FileItem | null
  fileContent: string
  files: FileItem[]
  loading: boolean
}

function emptyTabState(): TabState {
  return { currentPath: '/', selectedFile: null, fileContent: '', files: [], loading: false }
}

function FileIcon({ file, size = 20 }: { file: FileItem; size?: number }) {
  if (file.type === 'directory') return <Folder size={size} className="text-amber-500" />
  if (isImageFile(file.name)) return <FileText size={size} className="text-green-400" />
  if (isArchiveFile(file.name)) return <Archive size={size} className="text-blue-400" />
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const codeExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.php', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.sh', '.bash', '.zsh', '.sql', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.toml', '.md'])
  if (codeExts.has(ext)) return <FileCode size={size} className="text-purple-400" />
  return <LucideFile size={size} className="text-text-muted" />
}

function parseLsOutput(output: string): FileItem[] {
  const lines = output.split('\n').filter(l => l.trim())
  const files: FileItem[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const parts = line.trim().split(/\s+/)
    if (parts.length < 8) continue
    const permStr = parts[0]
    const ownerName = parts[2]
    const groupName = parts[3]
    const sizeStr = parts[4]
    const datePart1 = parts[5]
    const datePart2 = parts[6]
    const datePart3 = parts[7]
    const nameParts = parts.slice(8)
    let name = nameParts.join(' ')
    if (!name && parts.length === 8) {
      name = datePart3
    }
    if (name === '.' || name === '..') continue
    let type: FileItem['type'] = 'file'
    if (permStr.startsWith('d')) type = 'directory'
    else if (permStr.startsWith('l')) type = 'symlink'
    const permissions = permStr
    const size = parseInt(sizeStr, 10) || 0
    let modified = 0
    const combined = `${datePart1} ${datePart2} ${datePart3}`
    if (/^\d+$/.test(datePart1)) {
      modified = parseInt(datePart1, 10)
    } else {
      const d = new Date(combined)
      if (!isNaN(d.getTime())) modified = Math.floor(d.getTime() / 1000)
    }
    files.push({ name, type, size, modified, permissions, owner: ownerName, group: groupName })
  }
  return files
}

function _TransferPanel({ tasks, onClear, onRemove, onSave }: {
  tasks: any[]
  onClear: () => void
  onRemove: (id: string) => void
  onSave: (t: any) => void
}) {
  const activeCount = tasks.filter(t => t.status === 'pending' || t.status === 'transferring').length
  return (
    <div className="mt-4 glass rounded-2xl p-3 animate-slide-up">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-secondary">传输任务 {activeCount > 0 ? `(${activeCount})` : ''}</span>
        <button onClick={onClear} className="text-xs text-text-muted hover:text-text-secondary">清除已完成</button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {tasks.map(t => (
          <div key={t.id} className="glass rounded-xl p-2.5">
            <div className="flex items-center gap-2">
              {t.direction === 'upload' ? <ArrowUpCircle size={14} className="text-primary-light" /> : <ArrowDownCircle size={14} className="text-accent" />}
              <span className="text-xs text-text-secondary truncate flex-1">{t.fileName}</span>
              <span className="text-[10px] text-text-muted">{t.serverName}</span>
              {t.status === 'completed' && <CheckCircle size={14} className="text-success" />}
              {t.status === 'failed' && <XCircle size={14} className="text-danger" />}
              {t.status !== 'pending' && t.status !== 'transferring' && (
                <button onClick={() => onRemove(t.id)} className="text-text-muted hover:text-text-secondary"><X size={12} /></button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-300 ${
                  t.status === 'failed' ? 'bg-danger' : t.status === 'completed' ? 'bg-success' : 'bg-primary'
                }`} style={{ width: `${t.progress}%` }} />
              </div>
              <span className="text-[10px] text-text-muted w-8 text-right">{t.progress}%</span>
            </div>
            {t.status === 'transferring' && (
              <p className="text-[10px] text-text-muted mt-1">{formatSize(t.transferredBytes)} / {formatSize(t.totalBytes)}</p>
            )}
            {t.status === 'failed' && t.error && <p className="text-[10px] text-danger mt-1">{t.error}</p>}
            {t.direction === 'download' && t.status === 'completed' && t.data && (
              <button onClick={() => onSave(t)} className="mt-2 w-full rounded-lg bg-primary/15 px-2 py-1.5 text-[11px] font-medium text-primary-light hover:bg-primary/25">保存到设备</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function _ConfirmDialog({ open, title, message, confirmLabel, danger, onConfirm, onCancel }: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return createPortal(
    <>
      <div className="fixed inset-0 z-[150] bg-black/50" onClick={onCancel} />
      <div className="fixed inset-0 z-[151] flex items-center justify-center p-6" onClick={onCancel}>
        <div className="glass rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
          <p className="text-base font-semibold text-text-primary mb-2">{title}</p>
          <p className="text-sm text-text-secondary mb-5">{message}</p>
          <div className="flex gap-3 justify-end">
            <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-text-muted hover:bg-white/5">取消</button>
            <button onClick={onConfirm} className={`px-4 py-2 rounded-xl text-sm font-medium text-white ${danger ? 'bg-danger hover:bg-danger/80' : 'bg-primary hover:bg-primary/80'}`}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </>, document.body
  )
}

export default function FilesPage() {
  const [searchParams] = useSearchParams()
  const paramId = searchParams.get('id') || ''

  const { servers, connectServer, disconnectServer: _disconnectServer, isConnected, execCommand } = useServers()
  const { showToast } = useToast()

  const suppressRowClick = useRef(false)
  const longPressTimer = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const chunkPagesRef = useRef(new Map<number, { offset: number; firstLine: number }>())
  const editorChunkOffsetRef = useRef(0)
  const editorFilePathRef = useRef('')
  const editorServerIdRef = useRef('')
  const compressTargetRef = useRef<{ file: FileItem; pane: 'left' | 'right' } | null>(null)
  const touchScaleRef = useRef<{ dist: number; scale: number } | null>(null)

  const [activeTab, setActiveTab] = useState(paramId || '')
  const [activePane, setActivePane] = useState<'left' | 'right'>('left')
  const [rightServerId, setRightServerId] = useState('')
  const [tabState, setTabState] = useState<TabState>(emptyTabState())
  const [rightState, setRightState] = useState<TabState>(emptyTabState())
  const [showHidden, setShowHidden] = useState(false)
  const [selectedPane, _setSelectedPane] = useState<'left' | 'right' | null>(null)
  const [selectedServerId, _setSelectedServerId] = useState('')
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ file: FileItem; pane: 'left' | 'right' } | null>(null)
  const [renameTarget, setRenameTarget] = useState<{ file: FileItem; pane: 'left' | 'right' } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [longPressTarget, setLongPressTarget] = useState<{ file: FileItem; pane: 'left' | 'right' } | null>(null)
  const [imageViewer, setImageViewer] = useState<{ name: string; serverId: string; path: string; file: FileItem; pane: 'left' | 'right' } | null>(null)
  const [imageData, setImageData] = useState<string | null>(null)
  const [imageZoom, setImageZoom] = useState(1)
  const [imageLoading, setImageLoading] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showQuickActions, setShowQuickActions] = useState(false)
  const [_bookmarkName, setBookmarkName] = useState('')
  const [transferTasks, setTransferTasks] = useState<any[]>([])
  const [_backgroundUploadPane, _setBackgroundUploadPane] = useState<'left' | 'right' | null>(null)
  const [uploadStatus, setUploadStatus] = useState<{ success: number; total: number; error: string } | null>(null)
  const [leftSearch, setLeftSearch] = useState('')
  const [rightUploadStatus, setRightUploadStatus] = useState<{ success: number; total: number; error: string } | null>(null)
  const [rightSearch, setRightSearch] = useState('')
  const [_newFolderDialogOpen, setNewFolderDialogOpen] = useState(false)
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false)
  const [newFileType, setNewFileType] = useState<'file' | 'folder'>('file')
  const [newFileName, setNewFileName] = useState('')
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ name: string; path: string }[]>([])
  const [compressOpen, setCompressOpen] = useState(false)
  const [extractOpen, setExtractOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareExpiryHours, setShareExpiryHours] = useState(24)
  const [extractPath, setExtractPath] = useState('')
  const [scale, setScale] = useState(1)
  const [propertySheet, setPropertySheet] = useState<{ file: FileItem; pane?: string; currentPath?: string } | null>(null)
  const [permissionsDialog, setPermissionsDialog] = useState<{ file: FileItem; pane: 'left' | 'right' } | null>(null)
  const [permCheck, setPermCheck] = useState<Record<string, Record<number, boolean>>>({ R: { 0: false, 1: false, 2: false }, W: { 0: false, 1: false, 2: false }, X: { 0: false, 1: false, 2: false } })
  const [permStr, _setPermStr] = useState('---')
  const [_permType, _setPermType] = useState<string>('numeric')
  const [_propsDialog, setPropsDialog] = useState<{ file: FileItem; pane: 'left' | 'right'; statOutput: string; loading: boolean } | null>(null)
  const [_checksumDialog, _setChecksumDialog] = useState<{ file: FileItem; pane: 'left' | 'right'; hashes: { label: string; value: string }[]; verifyInput: string; verifyResult: string | null } | null>(null)
  const [permsDialog, setPermsDialog] = useState<{ file: FileItem; pane: 'left' | 'right'; currentOctal: string } | null>(null)
  const [permsEdit, _setPermsEdit] = useState<Record<string, boolean>>({ ur: false, uw: false, ux: false, gr: false, gw: false, gx: false, or: false, ow: false, ox: false, suid: false, sgid: false, sticky: false })
  const [_permsSaving, setPermsSaving] = useState(false)
  const [extractDialog, setExtractDialog] = useState<{ file: FileItem; pane: 'left' | 'right'; serverId: string; dirPath: string } | null>(null)
  const [_extractRunning, setExtractRunning] = useState(false)
  const [extractMode, _setExtractMode] = useState<'current' | 'folder'>('current')
  const [extractTarget, _setExtractTarget] = useState('')
  const [extractUseOtherPane, _setExtractUseOtherPane] = useState(false)
  const [compressDialog, setCompressDialog] = useState<{ file: FileItem; pane: 'left' | 'right'; serverId: string; dirPath: string } | null>(null)
  const [_compressRunning, setCompressRunning] = useState(false)
  const [compressName, setCompressName] = useState('')
  const [compressFormat, setCompressFormat] = useState<'zip' | 'tar.gz' | 'tar.bz2'>('zip')
  const [compressLevel, setCompressLevel] = useState<'store' | 'fast' | 'normal' | 'max'>('normal')
  const [compressPassword, setCompressPassword] = useState('')
  const [compressShowPass, setCompressShowPass] = useState(false)
  const [_shareLoading, setShareLoading] = useState(false)
  const [progressDialog, setProgressDialog] = useState<{ title: string; message: string } | null>(null)
  const [archiveBrowse, setArchiveBrowse] = useState<{ pane: 'left' | 'right'; serverId: string; archivePath: string; archiveName: string; entries: string[]; dirPath: string } | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [editingFile, setEditingFile] = useState<any>(null)
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpPath, setJumpPath] = useState('')
  const [sortBy, setSortBy] = useState<string>('name')
  const [sortOrder, setSortOrder] = useState<string>('asc')
  const [sortDialogOpen, setSortDialogOpen] = useState(false)
  const [serverDrawerOpen, setServerDrawerOpen] = useState(false)
  const [serverSearch, setServerSearch] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [forwardHistory, setForwardHistory] = useState<Record<string, string[]>>({ left: [], right: [] })
  const [backStack, setBackStack] = useState<string[]>([])
  const [rightBackStack, setRightBackStack] = useState<string[]>([])
  const [showToast_local, setShowToast_local] = useState<string | null>(null)

  const activeServer = servers.find(s => s.id === activeTab)
  const connectedServers = servers.filter(s => isConnected(s.id))
  const drawerServers = servers.filter(server => {
    const query = serverSearch.trim().toLowerCase()
    return !query || `${server.name} ${server.host} ${server.username}`.toLowerCase().includes(query)
  })

  useEffect(() => {
    if (!activeTab && !paramId && servers.length > 0) {
      const firstConnected = servers.find(s => isConnected(s.id))
      if (firstConnected) setActiveTab(firstConnected.id)
    } else if (paramId && !activeTab) {
      setActiveTab(paramId)
    }
  }, [servers, paramId, activeTab, isConnected])

  useEffect(() => {
    if (activeTab && isConnected(activeTab)) {
      loadFiles(activeTab, tabState.currentPath, setTabState)
    }
  }, [activeTab])

  useEffect(() => {
    if (rightServerId && isConnected(rightServerId)) {
      loadFiles(rightServerId, rightState.currentPath, setRightState)
    }
  }, [rightServerId])

  useEffect(() => {
    const interval = setInterval(() => {
      const tasks = transferManager.getTasks()
      setTransferTasks([...tasks])
    }, 500)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (showToast_local) {
      const timer = setTimeout(() => setShowToast_local(null), 2000)
      return () => clearTimeout(timer)
    }
  }, [showToast_local])

  async function loadFiles(serverId: string, path: string, setter: (value: TabState | ((prev: TabState) => TabState)) => void) {
    setter({ ...emptyTabState(), currentPath: path, loading: true, files: [], selectedFile: null, fileContent: '' })
    try {
      const lsOpt = showHidden ? '-la' : '-l'
      const output = await execCommand(serverId, `ls ${lsOpt} --time-style=+%s ${JSON.stringify(path)} 2>/dev/null | tail -n +2 || echo ""`)
      const files = parseLsOutput(output)
      setter(prev => ({ ...prev, files, loading: false }))
    } catch {
      setter(prev => ({ ...prev, loading: false }))
    }
  }

  function getCurrentPaneState() {
    return activePane === 'left' ? { state: tabState, setState: setTabState, serverId: activeTab, pane: 'left' as const } : { state: rightState, setState: setRightState, serverId: rightServerId, pane: 'right' as const }
  }

  function getPaneInfo(pane: 'left' | 'right') {
    return pane === 'left'
      ? { state: tabState, setState: setTabState, serverId: activeTab }
      : { state: rightState, setState: setRightState, serverId: rightServerId }
  }

  const navigateTo = useCallback((path: string, pane: 'left' | 'right') => {
    const { setState, serverId } = getPaneInfo(pane)
    if (!serverId) return
    const key = pane === 'left' ? 'left' : 'right'
    setForwardHistory(prev => ({ ...prev, [key]: [] }))
    loadFiles(serverId, path, (s) => { setState(s) })
    setLongPressTarget(null)
    setSelectedNames([])
  }, [activeTab, rightServerId, showHidden, execCommand])


  const navigateToParent = useCallback((pane: 'left' | 'right') => {
    if (archiveBrowse && archiveBrowse.pane === pane) {
      setArchiveBrowse(null)
      return
    }
    const { state, serverId } = getPaneInfo(pane)
    if (!serverId || state.currentPath === '/') return
    const parent = state.currentPath.split('/').slice(0, -1).join('/') || '/'
    navigateTo(parent, pane)
  }, [archiveBrowse, getPaneInfo])

  const navigateForward = useCallback((pane: 'left' | 'right') => {
    const key = pane === 'left' ? 'left' : 'right'
    const stack = forwardHistory[key] || []
    if (stack.length === 0) return
    const target = stack[stack.length - 1]
    setForwardHistory(prev => ({
      ...prev,
      [key]: prev[key].slice(0, -1)
    }))
    navigateTo(target, pane)
  }, [forwardHistory, activeTab, rightServerId, showHidden, execCommand])

  const navigateBack = useCallback((pane: 'left' | 'right') => {
    const stack = pane === 'left' ? backStack : rightBackStack
    if (stack.length === 0) return
    const target = stack[stack.length - 1]
    if (pane === 'left') setBackStack(prev => prev.slice(0, -1))
    else setRightBackStack(prev => prev.slice(0, -1))
    navigateTo(target, pane)
  }, [backStack, rightBackStack, activeTab, rightServerId, showHidden, execCommand])

  const handleDeleteFile = useCallback(async (file: FileItem, pane: 'left' | 'right') => {
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    try {
      await execCommand(serverId, `rm -rf ${JSON.stringify(state.currentPath + '/' + file.name)}`)
      showToast(`已删除 ${file.name}`, 'success')
      loadFiles(serverId, state.currentPath, pane === 'left' ? setTabState : setRightState)
    } catch (e: any) {
      showToast(`删除失败: ${e.message || e}`, 'error')
    }
    setShowDeleteConfirm(null)
  }, [execCommand, showToast, getPaneInfo])

  const handleRename = useCallback(async () => {
    if (!renameTarget) return
    const { serverId, state } = getPaneInfo(renameTarget.pane)
    if (!serverId || !newFileName.trim()) return
    try {
      const oldPath = state.currentPath + '/' + renameTarget.file.name
      const newPath = state.currentPath + '/' + newFileName.trim()
      await execCommand(serverId, `mv ${JSON.stringify(oldPath)} ${JSON.stringify(newPath)}`)
      showToast(`已重命名为 ${newFileName.trim()}`, 'success')
      loadFiles(serverId, state.currentPath, renameTarget.pane === 'left' ? setTabState : setRightState)
    } catch (e: any) {
      showToast(`重命名失败: ${e.message || e}`, 'error')
    }
    setRenameTarget(null)
    setNewFileName('')
  }, [renameTarget, newFileName, execCommand, showToast, getPaneInfo])

  const _createFolder = useCallback(async () => {
    if (!newFolderName.trim()) return
    const { serverId, state } = getCurrentPaneState()
    if (!serverId) return
    try {
      await execCommand(serverId, `mkdir ${JSON.stringify(state.currentPath + '/' + newFolderName.trim())}`)
      showToast(`已创建文件夹 ${newFolderName.trim()}`, 'success')
      loadFiles(serverId, state.currentPath, state === tabState ? setTabState : setRightState)
    } catch (e: any) {
      showToast(`创建失败: ${e.message || e}`, 'error')
    }
    setNewFolderName('')
  }, [newFolderName, execCommand, showToast, activeTab, rightServerId, activePane, tabState, rightState])

  const openEditor = useCallback(async (file: FileItem, pane: 'left' | 'right') => {
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    const filePath = state.currentPath + '/' + file.name
    if (file.size > LARGE_FILE_CHUNK_BYTES * 2) {
      try {
        const output = await execCommand(serverId, `base64 ${JSON.stringify(filePath)} 2>/dev/null | head -c $(( ${Math.ceil(LARGE_FILE_CHUNK_BYTES / 3) * 4} ))`)
        const content = atob(output.replace(/\s/g, ''))
        const lines = content.split('\n')
        const truncated = lines.slice(0, 200).join('\n')
        editorChunkOffsetRef.current = 0
        editorFilePathRef.current = filePath
        editorServerIdRef.current = serverId
        setEditingFile({ name: file.name, content: truncated, isTruncated: true, totalSize: file.size, pane, serverId, path: filePath })
      } catch (e: any) {
        showToast(`读取失败: ${e.message || e}`, 'error')
      }
    } else if (file.size > LARGE_FILE_CHUNK_BYTES) {
      try {
        const output = await execCommand(serverId, `base64 -w0 ${JSON.stringify(filePath)} 2>/dev/null | head -c $(( ${Math.ceil(LARGE_FILE_CHUNK_BYTES / 3) * 4} ))`)
        const content = atob(output.replace(/\s/g, ''))
        editorChunkOffsetRef.current = 0
        editorFilePathRef.current = filePath
        editorServerIdRef.current = serverId
        chunkPagesRef.current = new Map([[0, { offset: 0, firstLine: 1 }]])
        setEditingFile({ name: file.name, content, isTruncated: true, totalSize: file.size, pane, serverId, path: filePath, chunkOffset: 0 })
      } catch (e: any) {
        showToast(`读取失败: ${e.message || e}`, 'error')
      }
    } else {
      try {
        const output = await execCommand(serverId, `base64 -w0 ${JSON.stringify(filePath)} 2>/dev/null`)
        const content = atob(output.replace(/\s/g, ''))
        editorChunkOffsetRef.current = 0
        editorFilePathRef.current = filePath
        editorServerIdRef.current = serverId
        chunkPagesRef.current = new Map([[0, { offset: 0, firstLine: 1 }]])
        setEditingFile({ name: file.name, content, isTruncated: false, totalSize: file.size, pane, serverId, path: filePath })
      } catch (e: any) {
        showToast(`读取失败: ${e.message || e}`, 'error')
      }
    }
  }, [execCommand, showToast, getPaneInfo])

  const _loadEditorChunk = useCallback(async (newOffset: number) => {
    if (!editingFile || !editorServerIdRef.current || !editorFilePathRef.current) return
    const filePath = editorFilePathRef.current
    const serverId = editorServerIdRef.current
    try {
      const byteOffset = newOffset
      
      const output = await execCommand(serverId, `dd if=${JSON.stringify(filePath)} bs=1 skip=${byteOffset} count=${LARGE_FILE_CHUNK_BYTES} 2>/dev/null | base64 -w0`)
      const content = atob(output.replace(/\s/g, ''))
      editorChunkOffsetRef.current = byteOffset
      chunkPagesRef.current.set(0, { offset: byteOffset, firstLine: 1 })
      setEditingFile((prev: any) => prev ? { ...prev, content, chunkOffset: byteOffset } : null)
    } catch (e: any) {
      showToast(`加载失败: ${e.message || e}`, 'error')
    }
  }, [editingFile, execCommand, showToast])

  async function saveEditorFile() {
    if (!editingFile) return
    const { serverId } = getPaneInfo(editingFile.pane)
    if (!serverId) return
    try {
      setProgressDialog({ title: '保存中...', message: editingFile.file.name })
      const path = editingFile.state.currentPath === '/' ? '/' + editingFile.file.name : editingFile.state.currentPath + '/' + editingFile.file.name
      const b64 = btoa(unescape(encodeURIComponent(editingFile.content)))
      await execCommand(serverId, `echo ${JSON.stringify(b64)} | base64 -d > ${JSON.stringify(path)}`)
      showToast('文件已保存', 'success')
      setEditingFile(null)
    } catch { showToast('保存失败', 'error') }
    setProgressDialog(null)
  }

  const openImageViewer = useCallback(async (file: FileItem, pane: 'left' | 'right') => {
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    setImageLoading(true)
    setImageViewer({ name: file.name, serverId, path: state.currentPath + '/' + file.name, file, pane })
    try {
      const output = await execCommand(serverId, `base64 -w0 ${JSON.stringify(state.currentPath + '/' + file.name)} 2>/dev/null`)
      const binary = atob(output.replace(/\s/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: imageMimeType(file.name) })
      setImageData(URL.createObjectURL(blob))
    } catch (e: any) {
      showToast(`加载图片失败: ${e.message || e}`, 'error')
      setImageViewer(null)
    }
    setImageLoading(false)
  }, [execCommand, showToast, getPaneInfo])

  const _closeImageViewer = useCallback(() => {
    if (imageData) URL.revokeObjectURL(imageData)
    setImageViewer(null)
    setImageData(null)
    setImageZoom(1)
  }, [imageData])

  const _handleImageWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setImageZoom(z => Math.max(0.5, Math.min(5, z - e.deltaY * 0.002)))
  }

  const _handleImageTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      ;(e.currentTarget as HTMLDivElement).dataset['pinchDist'] = String(Math.hypot(dx, dy))
      ;(e.currentTarget as HTMLDivElement).dataset['pinchZoom'] = String(imageZoom)
    }
  }

  const _handleImageTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const el = e.currentTarget as HTMLDivElement
      const prevDist = parseFloat(el.dataset['pinchDist'] || '0')
      if (!prevDist) return
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      const prevZoom = parseFloat(el.dataset['pinchZoom'] || '1')
      setImageZoom(Math.max(0.5, Math.min(5, prevZoom * (dist / prevDist))))
    }
  }

  function getArchiveListCommand(archiveName: string): string | null {
    const lower = archiveName.toLowerCase()
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar tzf'
    if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz') || lower.endsWith('.tbz2')) return 'tar tjf'
    if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) return 'tar tJf'
    if (lower.endsWith('.tar.zst')) return 'tar --zstd -tf'
    if (lower.endsWith('.tar')) return 'tar tf'
    if (lower.endsWith('.zip')) return 'unzip -l'
    if (lower.endsWith('.7z')) return '7z l'
    if (lower.endsWith('.rar')) return 'unrar l'
    if (lower.endsWith('.gz') || lower.endsWith('.bz2') || lower.endsWith('.xz') || lower.endsWith('.zst')) return 'tar tf'
    return null
  }

  const enterArchive = useCallback(async (file: FileItem, pane: 'left' | 'right') => {
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    const archivePath = state.currentPath + '/' + file.name
    const cmd = getArchiveListCommand(file.name)
    if (!cmd) {
      showToast('不支持的压缩格式', 'error')
      return
    }
    setArchiveLoading(true)
    setArchiveBrowse({ pane, serverId, archivePath, archiveName: file.name, entries: [], dirPath: state.currentPath })
    try {
      const output = await execCommand(serverId, `${cmd} ${JSON.stringify(archivePath)} 2>/dev/null || echo ""`)
      const lines = output.split('\n').filter(l => l.trim())
      setArchiveBrowse(prev => prev ? { ...prev, entries: lines } : null)
    } catch (e: any) {
      showToast(`读取压缩包失败: ${e.message || e}`, 'error')
      setArchiveBrowse(null)
    }
    setArchiveLoading(false)
  }, [execCommand, showToast, getPaneInfo])

  const _handleRowPointerDown = useCallback((file: FileItem, pane: 'left' | 'right', e: React.PointerEvent) => {
    suppressRowClick.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
    longPressTimer.current = window.setTimeout(() => {
      suppressRowClick.current = true
      setLongPressTarget({ file, pane })
    }, 300)
  }, [])

  const _handleRowPointerMove = useCallback((_e: React.PointerEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const _handleRowPointerUp = useCallback((file: FileItem, pane: 'left' | 'right', _e: React.PointerEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (suppressRowClick.current) return
    if (selectedPane && selectedNames.length > 0) {
      const currentPaneServerId = pane === 'left' ? activeTab : rightServerId
      if (selectedPane === pane && selectedServerId === currentPaneServerId) {
        toggleFileSelection(file.name)
      }
      return
    }
    handleFileClick(file, pane)
  }, [selectedPane, selectedNames, selectedServerId, activeTab, rightServerId])

  const handleFileClick = useCallback((file: FileItem, pane: 'left' | 'right') => {
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    if (file.type === 'directory') {
      navigateTo(state.currentPath === '/' ? '/' + file.name : state.currentPath + '/' + file.name, pane)
    } else if (isImageFile(file.name)) {
      openImageViewer(file, pane)
    } else if (isArchiveFile(file.name)) {
      enterArchive(file, pane)
    } else if (isTextEditableFile(file.name)) {
      openEditor(file, pane)
    }
  }, [navigateTo, openImageViewer, enterArchive, openEditor, getPaneInfo])

  const downloadFromPane = useCallback((file: FileItem, pane: 'left' | 'right') => {
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    const serverName = servers.find(s => s.id === serverId)?.name || serverId
    transferManager.addDownload(serverId, serverName, state.currentPath + '/' + file.name, file.name)
    showToast(`已添加下载任务: ${file.name}`, 'info')
  }, [servers, showToast, getPaneInfo])

  function handleUploadClick(pane: 'left' | 'right') {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files
      if (!files?.length) return
      const { serverId, state } = getPaneInfo(pane)
      if (!serverId) return
      const serverName = servers.find(s => s.id === serverId)?.name || serverId
      const total = files.length
      const setter = pane === 'left' ? setUploadStatus : setRightUploadStatus
      setter({ success: 0, total, error: '' })
      for (let i = 0; i < files.length; i++) {
        try {
          const f = files[i]
          const reader = new FileReader()
          const content = await new Promise<string>((resolve) => {
            reader.onload = () => resolve((reader.result as string).split(',')[1])
            reader.readAsDataURL(f)
          })
          const destPath = state.currentPath === '/' ? '/' + f.name : state.currentPath + '/' + f.name
          await execCommand(serverId, `echo ${JSON.stringify(content)} | base64 -d > ${JSON.stringify(destPath)}`)
          setter(prev => prev ? { ...prev, success: (prev.success || 0) + 1 } : null)
        } catch (err: any) {
          setter(prev => prev ? { ...prev, error: err.message || '上传失败' } : null)
        }
      }
      if (total > 0) {
        setTimeout(() => {
          loadFiles(serverId, state.currentPath, pane === 'left' ? setTabState : setRightState)
          setter(null)
        }, 1000)
      }
    }
    input.click()
  }

  function handleLongPress(file: FileItem, pane: 'left' | 'right') {
    setLongPressTarget({ file, pane })
  }

  function handlePermissionsSave() {
    if (!permissionsDialog) return
    const { serverId, state } = getPaneInfo(permissionsDialog.pane)
    if (!serverId) return
    const numeric = Number(permCheck.R[0]) * 4 + Number(permCheck.W[0]) * 2 + Number(permCheck.X[0]) +
      Number(permCheck.R[1]) * 4 + Number(permCheck.W[1]) * 2 + Number(permCheck.X[1]) +
      Number(permCheck.R[2]) * 4 + Number(permCheck.W[2]) * 2 + Number(permCheck.X[2])
    const path = state.currentPath === '/' ? '/' + permissionsDialog.file.name : state.currentPath + '/' + permissionsDialog.file.name
    execCommand(serverId, `chmod ${numeric} ${JSON.stringify(path)}`).then(() => {
      loadFiles(serverId, state.currentPath, permissionsDialog.pane === 'left' ? setTabState : setRightState)
      showToast('权限已更新', 'info')
    }).catch(() => showToast('权限更新失败', 'error'))
    setPermissionsDialog(null)
  }

  async function handleCompress() {
    if (!compressTargetRef.current) return
    const { file, pane } = compressTargetRef.current
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    const targetPath = state.currentPath === '/' ? '/' + file.name : state.currentPath + '/' + file.name
    const outName = file.name + '.' + compressFormat.replace('.', '_')
    const outPath = state.currentPath === '/' ? '/' + outName : state.currentPath + '/' + outName
    try {
      setProgressDialog({ title: '压缩中...', message: file.name })
      const cmd = compressFormat === 'zip' ? `cd ${state.currentPath} && zip -${compressLevel === 'store' ? '0' : compressLevel === 'fast' ? '1' : compressLevel === 'max' ? '9' : '5'}${compressPassword ? ' -P ' + compressPassword : ''} -r ${outName} ${file.name}` :
        compressFormat === 'tar.gz' ? `cd ${state.currentPath} && tar -czf ${outName} ${file.name}` :
        `cd ${state.currentPath} && tar -cjf ${outName} ${file.name}`
      await execCommand(serverId, cmd)
      showToast('压缩完成: ' + outName, 'info')
    } catch { showToast('压缩失败', 'error') }
    setProgressDialog(null)
    loadFiles(serverId, state.currentPath, pane === 'left' ? setTabState : setRightState)
  }

  async function handleExtract() {
    if (!compressTargetRef.current) return
    const { file, pane } = compressTargetRef.current
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    const targetPath = state.currentPath === '/' ? '/' + file.name : state.currentPath + '/' + file.name
    const destDir = extractPath || state.currentPath
    try {
      setProgressDialog({ title: '解压中...', message: file.name })
      const ext = file.name.toLowerCase()
      let cmd: string
      if (ext.endsWith('.zip')) cmd = `unzip -o ${targetPath} -d ${destDir}`
      else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) cmd = `tar -xzf ${targetPath} -C ${destDir}`
      else if (ext.endsWith('.tar.bz2')) cmd = `tar -xjf ${targetPath} -C ${destDir}`
      else cmd = `tar -xf ${targetPath} -C ${destDir}`
      await execCommand(serverId, cmd)
      showToast('解压完成', 'info')
    } catch { showToast('解压失败', 'error') }
    setProgressDialog(null)
    loadFiles(serverId, state.currentPath, pane === 'left' ? setTabState : setRightState)
  }

  async function handleDownloadFile() {
    if (!imageViewer) return
    transferManager.addDownload(imageViewer.serverId, servers.find(s => s.id === imageViewer.serverId)?.name || imageViewer.serverId, imageViewer.path, imageViewer.file.name)
    showToast('已添加下载任务: ' + imageViewer.file.name, 'info')
  }

  async function handleGlobalSearch() {
    if (!activeTab || !isConnected(activeTab) || globalSearchQuery.length < 3) {
      setSearchResults([])
      return
    }
    try {
      const output = await execCommand(activeTab, `find -L ${tabState.currentPath} -maxdepth 5 -name "*${globalSearchQuery}*" 2>/dev/null | head -50`)
      const results = output.split('\n').filter(Boolean).map(line => ({ name: line.split('/').pop() || line, path: line.startsWith('/') ? line.substring(0, line.lastIndexOf('/')) : tabState.currentPath }))
      setSearchResults(results)
    } catch { setSearchResults([]) }
  }

  async function handleShareFile() {
    if (!longPressTarget) return
    const { serverId, state } = getPaneInfo(longPressTarget.pane)
    if (!serverId) return
    try {
      setProgressDialog({ title: '生成分享链接...', message: longPressTarget.file.name })
      const path = state.currentPath === '/' ? '/' + longPressTarget.file.name : state.currentPath + '/' + longPressTarget.file.name
      await execCommand(serverId, `if ! which python3; then if command -v python; then python -c 'import http.server; import socketserver; import threading; import os; PORT=8899; os.chdir("${state.currentPath}"); Handler=http.server.SimpleHTTPRequestHandler; httpd=socketserver.TCPServer(("",PORT),Handler); t=threading.Thread(target=httpd.serve_forever); t.daemon=True; t.start(); print("http://$(hostname -I | awk "{print \\$1}"):$PORT/${longPressTarget.file.name}")'; fi; else python3 -c 'import http.server; import socketserver; import threading; import os; PORT=8899; os.chdir("${state.currentPath}"); Handler=http.server.SimpleHTTPRequestHandler; httpd=socketserver.TCPServer(("",PORT),Handler); t=threading.Thread(target=httpd.serve_forever); t.daemon=True; t.start(); print("http://$(hostname -I | awk \"{print \\$1}\"):$PORT/${longPressTarget.file.name}")'; fi`)
      showToast('分享链接已生成(端口8899)', 'info')
    } catch { showToast('分享失败', 'error') }
    setProgressDialog(null)
  }

  function showPropertySheet(file: FileItem, pane: 'left' | 'right') {
    const { state } = getPaneInfo(pane)
    setPropertySheet({ file, pane, currentPath: state.currentPath })
  }

  function handleCreateNew() {
    if (!newFileName.trim()) return
    const { serverId, state } = getPaneInfo(activePane)
    if (!serverId) return
    const path = state.currentPath === '/' ? '/' + newFileName : state.currentPath + '/' + newFileName
    const cmd = newFileType === 'folder' ? `mkdir -p ${path}` : `touch ${path}`
    execCommand(serverId, cmd).then(() => {
      loadFiles(serverId, state.currentPath, activePane === 'left' ? setTabState : setRightState)
      showToast('创建成功', 'success')
    }).catch(() => showToast('创建失败', 'error'))
    setNewFileDialogOpen(false)
  }

  const _copyFile = useCallback(async (sourceFile: FileItem, sourcePane: 'left' | 'right', targetPane: 'left' | 'right') => {
    const src = getPaneInfo(sourcePane)
    const tgt = getPaneInfo(targetPane)
    if (!src.serverId || !tgt.serverId) return
    const srcPath = src.state.currentPath + '/' + sourceFile.name
    const tgtPath = tgt.state.currentPath + '/' + sourceFile.name
    try {
      await execCommand(src.serverId, `cp -r ${JSON.stringify(srcPath)} ${JSON.stringify(tgtPath)}`)
      showToast(`已复制 ${sourceFile.name}`, 'success')
      loadFiles(tgt.serverId, tgt.state.currentPath, targetPane === 'left' ? setTabState : setRightState)
    } catch (e: any) {
      showToast(`复制失败: ${e.message || e}`, 'error')
    }
    setLongPressTarget(null)
  }, [execCommand, showToast, getPaneInfo])

  const _moveFile = useCallback(async (sourceFile: FileItem, sourcePane: 'left' | 'right', targetPane: 'left' | 'right') => {
    const src = getPaneInfo(sourcePane)
    const tgt = getPaneInfo(targetPane)
    if (!src.serverId || !tgt.serverId) return
    const srcPath = src.state.currentPath + '/' + sourceFile.name
    const tgtPath = tgt.state.currentPath + '/' + sourceFile.name
    try {
      await execCommand(src.serverId, `mv ${JSON.stringify(srcPath)} ${JSON.stringify(tgtPath)}`)
      showToast(`已移动 ${sourceFile.name}`, 'success')
      loadFiles(src.serverId, src.state.currentPath, sourcePane === 'left' ? setTabState : setRightState)
      if (src.serverId !== tgt.serverId) {
        loadFiles(tgt.serverId, tgt.state.currentPath, targetPane === 'left' ? setTabState : setRightState)
      }
    } catch (e: any) {
      showToast(`移动失败: ${e.message || e}`, 'error')
    }
    setLongPressTarget(null)
  }, [execCommand, showToast, getPaneInfo])

  const _doExtract = useCallback(async () => {
    if (!extractDialog) return
    const { file, serverId, dirPath } = extractDialog
    setExtractRunning(true)
    let destDir: string
    if (extractUseOtherPane) {
      const other = extractDialog.pane === 'left' ? getPaneInfo('right') : getPaneInfo('left')
      destDir = other.serverId ? other.state.currentPath : dirPath
    } else if (extractMode === 'folder' && extractTarget.trim()) {
      destDir = extractTarget.trim()
    } else {
      destDir = dirPath
    }
    setProgressDialog({ title: '解压中', message: `正在解压 ${file.name} 到 ${destDir}...` })
    try {
      const archivePath = dirPath + '/' + file.name
      let cmd = ''
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.zip') || lower.endsWith('.7z') || lower.endsWith('.rar')) {
        if (lower.endsWith('.zip')) cmd = `unzip -o ${JSON.stringify(archivePath)} -d ${JSON.stringify(destDir)}`
        else if (lower.endsWith('.7z')) cmd = `7z x ${JSON.stringify(archivePath)} -o${JSON.stringify(destDir)} -y`
        else cmd = `unrar x ${JSON.stringify(archivePath)} ${JSON.stringify(destDir + '/')}`
      } else {
        let tarFlag = 'zxf'
        if (lower.endsWith('.bz2') || lower.endsWith('.tbz') || lower.endsWith('.tbz2') || lower.endsWith('.tar.bz2')) tarFlag = 'jxf'
        else if (lower.endsWith('.xz') || lower.endsWith('.txz') || lower.endsWith('.tar.xz')) tarFlag = 'Jxf'
        else if (lower.endsWith('.zst') || lower.endsWith('.tar.zst')) tarFlag = '--zstd -xf'
        cmd = `mkdir -p ${JSON.stringify(destDir)} && tar ${tarFlag} ${JSON.stringify(archivePath)} -C ${JSON.stringify(destDir)}`
      }
      await execCommand(serverId, cmd)
      showToast(`已解压到 ${destDir}`, 'success')
      loadFiles(serverId, extractDialog.pane === 'left' ? tabState.currentPath : rightState.currentPath, extractDialog.pane === 'left' ? setTabState : setRightState)
    } catch (e: any) {
      showToast(`解压失败: ${e.message || e}`, 'error')
    }
    setExtractRunning(false)
    setExtractDialog(null)
    setProgressDialog(null)
  }, [extractDialog, extractMode, extractTarget, extractUseOtherPane, execCommand, showToast, tabState, rightState])

  const _doCompress = useCallback(async () => {
    if (!compressDialog) return
    const { file, serverId, dirPath } = compressDialog
    setCompressRunning(true)
    const baseName = compressName || file.name
    let archiveName = ''
    if (compressFormat === 'zip') archiveName = baseName + '.zip'
    else if (compressFormat === 'tar.gz') archiveName = baseName + '.tar.gz'
    else archiveName = baseName + '.tar.bz2'
    const passArg = compressPassword ? `-P ${JSON.stringify(compressPassword)}` : ''
    setProgressDialog({ title: '压缩中', message: `正在压缩 ${file.name}...` })
    try {
      let cmd = ''
      if (compressFormat === 'zip') {
        let levelFlag = ''
        if (compressLevel === 'store') levelFlag = '-0'
        else if (compressLevel === 'fast') levelFlag = '-1'
        else if (compressLevel === 'max') levelFlag = '-9'
        cmd = `cd ${JSON.stringify(dirPath)} && zip -r ${levelFlag} ${passArg} ${JSON.stringify(archiveName)} ${JSON.stringify(file.name)}`
      } else if (compressFormat === 'tar.gz') {
        let gzipLevel = ''
        if (compressLevel === 'fast') gzipLevel = '-1'
        else if (compressLevel === 'max') gzipLevel = '-9'
        cmd = `cd ${JSON.stringify(dirPath)} && tar -czf ${JSON.stringify(archiveName)} ${gzipLevel ? `--use-compress-program='gzip ${gzipLevel}'` : ''} ${JSON.stringify(file.name)}`
      } else {
        cmd = `cd ${JSON.stringify(dirPath)} && tar -cjf ${JSON.stringify(archiveName)} ${JSON.stringify(file.name)}`
      }
      await execCommand(serverId, cmd)
      showToast(`已压缩为 ${archiveName}`, 'success')
      loadFiles(serverId, dirPath, compressDialog.pane === 'left' ? setTabState : setRightState)
    } catch (e: any) {
      showToast(`压缩失败: ${e.message || e}`, 'error')
    }
    setCompressRunning(false)
    setCompressDialog(null)
    setProgressDialog(null)
  }, [compressDialog, compressName, compressFormat, compressLevel, compressPassword, execCommand, showToast])

  function getSortConfig(): { sortKey: string; ascending: boolean } {
    return { sortKey: 'name', ascending: true }
  }

  function sortFiles(files: FileItem[]): FileItem[] {
    const config = getSortConfig()
    const sorted = [...files].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      const va = a[config.sortKey as keyof FileItem]
      const vb = b[config.sortKey as keyof FileItem]
      if (typeof va === 'string' && typeof vb === 'string') {
        return config.ascending ? va.localeCompare(vb) : vb.localeCompare(va)
      }
      if (typeof va === 'number' && typeof vb === 'number') {
        return config.ascending ? va - vb : vb - va
      }
      return 0
    })
    return sorted
  }

  const toggleFileSelection = useCallback((name: string) => {
    setSelectedNames(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])
  }, [])

  const _showProperties = useCallback(async (file: FileItem, pane: 'left' | 'right') => {
    const { serverId } = getPaneInfo(pane)
    if (!serverId) return
    setPropsDialog({ file, pane, statOutput: '', loading: true })
    try {
      const output = await execCommand(serverId, `stat ${JSON.stringify((getPaneInfo(pane).state.currentPath + '/' + file.name))} 2>/dev/null || echo "stat: command not found"`)
      setPropsDialog({ file, pane, statOutput: output, loading: false })
    } catch (e: any) {
      setPropsDialog({ file, pane, statOutput: `Error: ${e.message || e}`, loading: false })
    }
    setLongPressTarget(null)
  }, [execCommand, getPaneInfo])

  const _savePermissions = useCallback(async () => {
    if (!permsDialog) return
    const { file, pane } = permsDialog
    const { serverId } = getPaneInfo(pane)
    if (!serverId) return
    setPermsSaving(true)
    const octal = permsToOctal(permsEdit)
    try {
      const path = getPaneInfo(pane).state.currentPath + '/' + file.name
      await execCommand(serverId, `chmod ${octal} ${JSON.stringify(path)}`)
      showToast('权限已更新', 'success')
      setPermsDialog(null)
      loadFiles(serverId, getPaneInfo(pane).state.currentPath, pane === 'left' ? setTabState : setRightState)
    } catch (e: any) {
      showToast(`权限更新失败: ${e.message || e}`, 'error')
    }
    setPermsSaving(false)
  }, [permsDialog, permsEdit, execCommand, showToast, getPaneInfo])

  const _shareFile = useCallback(async (file: FileItem, _pane: 'left' | 'right') => {
    try {
      setShareLoading(true)
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: file.name, text: `文件: ${file.name}`, url: location.href })
      } else {
        await navigator.clipboard.writeText(file.name)
        showToast('文件名已复制到剪贴板', 'info')
      }
    } catch {
      // user cancelled
    }
    setShareLoading(false)
    setLongPressTarget(null)
  }, [showToast])

  const _addBookmark = useCallback((_file: FileItem, _pane: 'left' | 'right') => {
    showToast('书签功能不可用', 'info')
    setLongPressTarget(null)
  }, [showToast])

  const _confirmBookmarkName = useCallback(() => {
    setBookmarkName('')
    setLongPressTarget(null)
  }, [])

  const _openCompressDialog = useCallback((file: FileItem, pane: 'left' | 'right') => {
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    setCompressDialog({ file, pane, serverId, dirPath: state.currentPath })
    setCompressName(file.name)
    setLongPressTarget(null)
  }, [getPaneInfo])

  const _openExtractDialog = useCallback((file: FileItem, pane: 'left' | 'right') => {
    const { serverId, state } = getPaneInfo(pane)
    if (!serverId) return
    setExtractDialog({ file, pane, serverId, dirPath: state.currentPath })
    setLongPressTarget(null)
  }, [getPaneInfo])

  const syncActivePathToOtherPane = useCallback(() => {
    if (!rightServerId) return
    navigateTo(tabState.currentPath, 'right' as 'left' | 'right')
  }, [rightServerId, tabState.currentPath, activeTab, showHidden, execCommand])


  const fmtTime = (ts: number) => {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear().toString().slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const leftFiles = sortFiles(tabState.files)
  const rightFiles = sortFiles(rightState.files)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white text-[#1f2632]">
      <header className="flex h-[76px] shrink-0 items-center gap-3 bg-[#e9eef6] px-5">
        <button
          type="button"
          aria-label="打开服务器列表"
          onClick={() => { setServerSearch(''); setServerDrawerOpen(true) }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#2b3442] active:bg-[#dce3ef]"
        >
          <Menu size={27} strokeWidth={2.2} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[23px] font-bold tracking-normal text-[#1f2632]">
          {activeServer?.name || '请连接服务器'}
        </h1>
        <button
          type="button"
          aria-label="打开文件工具菜单"
          onClick={() => setToolsOpen(value => !value)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#2b3442] active:bg-[#dce3ef]"
        >
          <MoreVertical size={25} strokeWidth={2.2} />
        </button>
      </header>

      <main className="flex min-h-0 flex-1 bg-white">
        <section
          onClick={() => setActivePane('left')}
          className={`relative flex min-w-0 flex-1 flex-col ${activePane === 'left' ? '' : 'bg-[#fcfcfd]'}`}
        >
          <div className="flex h-[68px] shrink-0 items-center gap-2 px-3">
            <button onClick={() => { setNewFileType('file'); setNewFileName(''); setNewFileDialogOpen(true) }} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#eef0f5] bg-[#f7f6fb] text-[#bfc6d8] shadow-sm"><FileText size={19} strokeWidth={1.7} /></button>
            <button onClick={() => { setNewFileType('folder'); setNewFileName(''); setNewFileDialogOpen(true) }} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#edf1f3] bg-[#f4fbfd] text-[#a6dce8] shadow-sm"><FolderPlus size={19} strokeWidth={1.7} /></button>
            <button onClick={() => handleUploadClick('left')} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#edf1f7] bg-[#f5f9ff] text-[#9ab8f3] shadow-sm"><Upload size={19} strokeWidth={1.7} /></button>
            <button onClick={() => setShowQuickActions(true)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#f0eef8] bg-[#f8f5ff] text-[#c7b6f4] shadow-sm"><FolderArchive size={19} strokeWidth={1.7} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3 pt-1">
            {archiveBrowse?.pane === 'left' ? (
              archiveLoading ? (
                <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
              ) : (
                <div>
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-xs text-blue-600 font-medium">{archiveBrowse.archiveName}</span>
                    <button onClick={() => setArchiveBrowse(null)} className="p-0.5"><X size={14} className="text-gray-400" /></button>
                  </div>
                  {sortFiles((archiveBrowse.entries || []).map(e => ({
                    name: e, type: (e.endsWith('/') ? 'directory' : 'file') as FileItem['type'],
                    size: 0, modified: 0, permissions: '', owner: '', group: ''
                  }))).map(file => (
                    <div key={file.name} className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl active:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        if (file.type === 'directory') {
                          const np = (archiveBrowse.dirPath || '') + file.name.replace(/\/$/, '')
                          setArchiveBrowse(prev => prev ? { ...prev, archiveLoading: true } : null)
                          execCommand(archiveBrowse!.serverId, `tar tzf ${archiveBrowse!.archivePath} | grep "^${np}" | sed "s|^${np}/||" | sort -u || true`)
                            .then(o => setArchiveBrowse(prev => prev ? { ...prev, dirPath: np + '/', entries: o.split('\n').filter(Boolean).map((e: string) => e ? e + '/' : '') } : null))
                            .finally(() => setArchiveBrowse(prev => prev ? { ...prev, archiveLoading: false } : null))
                        }
                      }}>
                      <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 shadow-sm">
                        <Folder size={16} className="text-blue-400" />
                      </div>
                      <span className="text-sm text-gray-700 truncate flex-1">{file.name.replace(/\/$/, '')}</span>
                    </div>
                  ))}
                </div>
              )
            ) : tabState.loading ? (
              <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
            ) : leftFiles.length === 0 ? (
              <div className="flex h-[28%] min-h-[130px] items-center justify-center">
                <p className="text-[20px] font-medium text-[#8e97a8]">目录为空</p>
              </div>
            ) : (
              leftFiles.map(file => (
                <div key={file.name}
                  className={`flex items-center gap-2.5 px-2 py-2.5 rounded-xl cursor-pointer ${selectedNames.includes(file.name) ? 'bg-blue-50' : 'active:bg-gray-50'}`}
                  onClick={() => handleFileClick(file, 'left')}
                  onContextMenu={e => { e.preventDefault(); handleLongPress(file, 'left') }}
                  onTouchStart={() => { longPressTimerRef.current = window.setTimeout(() => handleLongPress(file, 'left'), 300) }}
                  onTouchEnd={() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null } }}
                  onTouchMove={() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null } }}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${selectedNames.includes(file.name) ? 'bg-blue-100' : 'bg-gray-100'}`}>
                    <FileIcon file={file} size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">{file.name}</p>
                    <p className="text-[10px] text-gray-400">{file.size}{file.modified ? ' · ' + fmtTime(file.modified) : ''}</p>
                  </div>
                  {selectedNames.includes(file.name) && <Check size={14} className="text-blue-500 shrink-0" />}
                </div>
              ))
            )}
          </div>
        </section>

        <div className="w-px shrink-0 bg-[#d7dce4] shadow-[0_0_8px_rgba(54,66,85,0.10)]" />

        <section
          onClick={() => setActivePane('right')}
          className={`relative flex min-w-0 flex-1 flex-col ${activePane === 'right' ? '' : 'bg-[#fcfcfd]'}`}
        >
          <div className="flex h-[68px] shrink-0 items-center gap-2 px-3">
            <button onClick={() => { setNewFileType('file'); setNewFileName(''); setNewFileDialogOpen(true) }} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#eef0f5] bg-[#f7f6fb] text-[#bfc6d8] shadow-sm"><FileText size={19} strokeWidth={1.7} /></button>
            <button onClick={() => { setNewFileType('folder'); setNewFileName(''); setNewFileDialogOpen(true) }} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#edf1f3] bg-[#f4fbfd] text-[#a6dce8] shadow-sm"><FolderPlus size={19} strokeWidth={1.7} /></button>
            <button onClick={() => handleUploadClick('right')} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#edf1f7] bg-[#f5f9ff] text-[#9ab8f3] shadow-sm"><Upload size={19} strokeWidth={1.7} /></button>
            <button onClick={() => { setActivePane('right'); setServerSearch(''); setServerDrawerOpen(true) }} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#f0eef8] bg-[#f8f5ff] text-[#c7b6f4] shadow-sm"><FolderArchive size={19} strokeWidth={1.7} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3 pt-1">
            {!rightServerId ? (
              <div className="flex h-[28%] min-h-[130px] items-center justify-center">
                <p className="text-[20px] font-medium text-[#8e97a8]">目录为空</p>
              </div>
            ) : archiveBrowse?.pane === 'right' ? (
              archiveLoading ? (
                <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
              ) : (
                <div>
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-xs text-blue-600 font-medium">{archiveBrowse.archiveName}</span>
                    <button onClick={() => setArchiveBrowse(null)} className="p-0.5"><X size={14} className="text-gray-400" /></button>
                  </div>
                  {sortFiles((archiveBrowse.entries || []).map(e => ({
                    name: e, type: (e.endsWith('/') ? 'directory' : 'file') as FileItem['type'],
                    size: 0, modified: 0, permissions: '', owner: '', group: ''
                  }))).map(file => (
                    <div key={file.name} className="flex items-center gap-2.5 px-2 py-2.5 rounded-xl active:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        if (file.type === 'directory') {
                          const np = (archiveBrowse.dirPath || '') + file.name.replace(/\/$/, '')
                          setArchiveBrowse(prev => prev ? { ...prev, archiveLoading: true } : null)
                          execCommand(archiveBrowse!.serverId, `tar tzf ${archiveBrowse!.archivePath} | grep "^${np}" | sed "s|^${np}/||" | sort -u || true`)
                            .then(o => setArchiveBrowse(prev => prev ? { ...prev, dirPath: np + '/', entries: o.split('\n').filter(Boolean).map((e: string) => e ? e + '/' : '') } : null))
                            .finally(() => setArchiveBrowse(prev => prev ? { ...prev, archiveLoading: false } : null))
                        }
                      }}>
                      <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 shadow-sm">
                        <Folder size={16} className="text-blue-400" />
                      </div>
                      <span className="text-sm text-gray-700 truncate flex-1">{file.name.replace(/\/$/, '')}</span>
                    </div>
                  ))}
                </div>
              )
            ) : rightState.loading ? (
              <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
            ) : rightFiles.length === 0 ? (
              <div className="flex h-[28%] min-h-[130px] items-center justify-center">
                <p className="text-[20px] font-medium text-[#8e97a8]">目录为空</p>
              </div>
            ) : (
              rightFiles.map(file => (
                <div key={file.name}
                  className={`flex items-center gap-2.5 px-2 py-2.5 rounded-xl cursor-pointer ${selectedNames.includes(file.name) ? 'bg-blue-50' : 'active:bg-gray-50'}`}
                  onClick={() => handleFileClick(file, 'right')}
                  onContextMenu={e => { e.preventDefault(); handleLongPress(file, 'right') }}
                  onTouchStart={() => { longPressTimerRef.current = window.setTimeout(() => handleLongPress(file, 'right'), 300) }}
                  onTouchEnd={() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null } }}
                  onTouchMove={() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null } }}>
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${selectedNames.includes(file.name) ? 'bg-blue-100' : 'bg-gray-100'}`}>
                    <FileIcon file={file} size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">{file.name}</p>
                    <p className="text-[10px] text-gray-400">{file.size}{file.modified ? ' · ' + fmtTime(file.modified) : ''}</p>
                  </div>
                  {selectedNames.includes(file.name) && <Check size={14} className="text-blue-500 shrink-0" />}
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <footer className="flex h-[96px] shrink-0 items-center justify-between border-t border-[#e6e9f0] bg-white px-8">
        <button onClick={() => navigateBack(activePane)}
          disabled={(activePane === 'left' ? backStack : rightBackStack).length === 0}
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[#d3d7e1] active:bg-[#f3f5f8] disabled:opacity-70">
          <ArrowLeft size={26} strokeWidth={2} />
        </button>
        <button onClick={() => navigateForward(activePane)}
          disabled={!(forwardHistory[activePane]?.length > 0)}
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[#d3d7e1] active:bg-[#f3f5f8] disabled:opacity-70">
          <ArrowRight size={26} strokeWidth={2} />
        </button>
        <button onClick={() => { setNewFileDialogOpen(true); setNewFileName(''); setNewFileType('file') }}
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[#68738a] active:bg-[#f3f5f8]">
          <Plus size={31} strokeWidth={2} />
        </button>
        <button onClick={() => { if (activeTab) { loadFiles(activeTab, tabState.currentPath, setTabState); if (rightServerId) loadFiles(rightServerId, rightState.currentPath, setRightState) } }}
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[#8c96a8] active:bg-[#f3f5f8]">
          <RefreshCw size={24} strokeWidth={1.9} />
        </button>
        <button onClick={() => navigateToParent(activePane)}
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[#8c96a8] active:bg-[#f3f5f8]">
          <ArrowUp size={26} strokeWidth={2} />
        </button>
      </footer>

      {/* ==================== 弹窗 ==================== */}

      {/* 服务器选择 */}
      {serverDrawerOpen && (
        <div className="fixed inset-0 z-[2000]">
          <div className="absolute inset-0 bg-[#1f2632]/25" onClick={() => setServerDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[84vw] max-w-[360px] flex-col bg-white shadow-2xl animate-slide-right">
            <div className="flex h-[76px] shrink-0 items-center gap-2 bg-[#e9eef6] px-4">
              <button aria-label="关闭服务器抽屉" onClick={() => setServerDrawerOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl text-[#2b3442] active:bg-[#dce3ef]"><ChevronLeft size={26} /></button>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-[#1f2632]">选择服务器</h2>
                <p className="text-xs text-[#748096]">{activePane === 'left' ? '左侧文件面板' : '右侧文件面板'}</p>
              </div>
            </div>
            <div className="shrink-0 px-4 py-4">
              <label className="flex h-11 items-center gap-2 rounded-xl bg-[#f4f6fa] px-3 text-[#7d8798]">
                <Search size={18} />
                <input value={serverSearch} onChange={event => setServerSearch(event.target.value)} placeholder="搜索服务器" autoFocus className="min-w-0 flex-1 bg-transparent text-sm text-[#1f2632] outline-none placeholder:text-[#9ca5b5]" />
                {serverSearch && <button aria-label="清除搜索" onClick={() => setServerSearch('')}><X size={16} /></button>}
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              {drawerServers.map(server => {
                const selected = activePane === 'left' ? server.id === activeTab : server.id === rightServerId
                const online = isConnected(server.id)
                return (
                  <button
                    key={server.id}
                    onClick={async () => {
                      if (!online) {
                        const result = await connectServer(server.id)
                        if (!result.success) {
                          showToast(result.error || '连接服务器失败', 'error')
                          return
                        }
                      }
                      if (activePane === 'left') setActiveTab(server.id)
                      else setRightServerId(server.id)
                      setServerDrawerOpen(false)
                    }}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-[#edf0ff] ${selected ? 'bg-[#eef0ff]' : 'hover:bg-[#f6f7fa]'}`}
                  >
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${selected ? 'bg-[#dfe3ff] text-[#6670f5]' : 'bg-[#f1f3f7] text-[#8792a5]'}`}><Server size={19} strokeWidth={1.8} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[#273142]">{server.name}</span><span className="block truncate text-xs text-[#8993a4]">{server.host}</span></span>
                    <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-[#59c08b]' : 'bg-[#c7cdd7]'}`} />
                  </button>
                )
              })}
              {drawerServers.length === 0 && <p className="px-3 py-10 text-center text-sm text-[#8e97a8]">未找到匹配的服务器</p>}
            </div>
          </aside>
        </div>
      )}

      {/* 工具菜单 */}
      {toolsOpen && (
        <div className="fixed inset-0 z-[2000]">
          <div className="absolute inset-0" onClick={() => setToolsOpen(false)} />
          <div className="absolute right-4 top-[68px] w-52 rounded-2xl border border-[#e8ebf1] bg-white p-2 shadow-xl">
            <div className="space-y-0.5">
              {[{ icon: ArrowUp, label: '返回上级目录', action: () => { navigateToParent(activePane); setToolsOpen(false) } },
                { icon: MoveRight, label: '跳转路径', action: () => { setJumpOpen(true); setToolsOpen(false) } },
                { icon: Search, label: '全局搜索', action: () => { setSearchDialogOpen(true); setToolsOpen(false) } },
                { icon: Bookmark, label: '快速操作', action: () => { setShowQuickActions(true); setToolsOpen(false) } }].map(({ icon: Icon, label, action }) => (
                <button key={label} onClick={action} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 text-left">
                  <Icon size={16} className="text-gray-400" /><span className="text-sm text-gray-700">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 长按菜单 */}
      {longPressTarget && (
        <div className="fixed inset-0 z-[2000]">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setLongPressTarget(null); setSelectedNames([]) }} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl animate-slide-up">
            <div className="sticky top-0 bg-white pt-3 pb-2 px-4 flex items-center justify-between border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800 truncate">{longPressTarget.file.name}</h3>
              <button onClick={() => { setLongPressTarget(null); setSelectedNames([]) }}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="px-4 py-2 space-y-0.5">
              {longPressTarget.file.type === 'directory' ? (
                <button onClick={() => { navigateTo(longPressTarget.file.name, longPressTarget.pane); setLongPressTarget(null) }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><Folder size={16} className="text-blue-400" /><span className="text-sm text-gray-700">打开目录</span></button>
              ) : (
                <>
                  {isImageFile(longPressTarget.file.name) && (
                    <button onClick={() => { openImageViewer(longPressTarget.file, longPressTarget.pane); setLongPressTarget(null) }}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><ImageIcon size={16} className="text-sky-400" /><span className="text-sm text-gray-700">查看图片</span></button>
                  )}
                  {isTextEditableFile(longPressTarget.file.name) && (
                    <button onClick={() => { openEditor(longPressTarget.file, longPressTarget.pane); setLongPressTarget(null) }}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><FileEdit size={16} className="text-emerald-400" /><span className="text-sm text-gray-700">编辑文件</span></button>
                  )}
                  {isArchiveFile(longPressTarget.file.name) && (
                    <button onClick={() => { enterArchive(longPressTarget.file, longPressTarget.pane); setLongPressTarget(null) }}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><Archive size={16} className="text-amber-400" /><span className="text-sm text-gray-700">浏览压缩包</span></button>
                  )}
                </>
              )}
              <button onClick={() => { downloadFromPane(longPressTarget.file, longPressTarget.pane); setLongPressTarget(null) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><Download size={16} className="text-gray-400" /><span className="text-sm text-gray-700">下载</span></button>
              <button onClick={() => { setShowDeleteConfirm({ ...longPressTarget }); setLongPressTarget(null) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50"><Trash2 size={16} className="text-red-400" /><span className="text-sm text-red-500">删除</span></button>
              <button onClick={() => { setRenameTarget({ ...longPressTarget }); setNewFileName(longPressTarget.file.name); setLongPressTarget(null) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><PenLine size={16} className="text-gray-400" /><span className="text-sm text-gray-700">重命名</span></button>
              <button onClick={() => { showPropertySheet(longPressTarget.file, longPressTarget.pane); setLongPressTarget(null) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><FileText size={16} className="text-gray-400" /><span className="text-sm text-gray-700">属性</span></button>
              <button onClick={() => { compressTargetRef.current = longPressTarget; setCompressOpen(true); setLongPressTarget(null) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><FolderArchive size={16} className="text-gray-400" /><span className="text-sm text-gray-700">压缩</span></button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in shadow-xl">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">确认删除</h3>
            <p className="text-xs text-gray-500 mb-4">确定要删除「{showDeleteConfirm.file.name}」吗？此操作不可撤销。</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-600">取消</button>
              <button onClick={() => { handleDeleteFile(showDeleteConfirm.file, showDeleteConfirm.pane); setShowDeleteConfirm(null) }}
                className="flex-1 py-2.5 rounded-xl bg-red-50 text-sm text-red-500">删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名 */}
      {renameTarget && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setRenameTarget(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in shadow-xl">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">重命名</h3>
            <input value={newFileName} onChange={e => setNewFileName(e.target.value)} autoFocus
              className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-800 border border-gray-200 focus:border-blue-300 outline-none mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setRenameTarget(null)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-600">取消</button>
              <button onClick={() => { handleRename(); setRenameTarget(null) }}
                disabled={!newFileName.trim()} className="flex-1 py-2.5 rounded-xl bg-blue-50 text-sm text-blue-600 disabled:opacity-50">确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 新建 */}
      {newFileDialogOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setNewFileDialogOpen(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in shadow-xl">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">新建</h3>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setNewFileType('file')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium ${newFileType === 'file' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>文件</button>
              <button onClick={() => setNewFileType('folder')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium ${newFileType === 'folder' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>文件夹</button>
            </div>
            <input value={newFileName} onChange={e => setNewFileName(e.target.value)} autoFocus
              placeholder={newFileType === 'file' ? '输入文件名...' : '输入文件夹名...'}
              className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-800 border border-gray-200 focus:border-blue-300 outline-none mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setNewFileDialogOpen(false)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-600">取消</button>
              <button onClick={handleCreateNew} disabled={!newFileName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-blue-50 text-sm text-blue-600 disabled:opacity-50">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 权限 */}
      {permissionsDialog && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPermissionsDialog(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in shadow-xl">
            <h3 className="text-sm font-semibold text-gray-800 mb-1">权限设置</h3>
            <p className="text-xs text-gray-400 mb-3">{permissionsDialog.file.name}</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {(['R', 'W', 'X'] as const).map(key => (
                <div key={key} className="flex flex-col items-center">
                  <span className="text-[10px] text-gray-400 mb-1">{key === 'R' ? '读' : key === 'W' ? '写' : '执行'}</span>
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <label key={i} className="cursor-pointer">
                        <input type="checkbox" checked={permCheck[key][i]}
                          onChange={e => setPermCheck({ ...permCheck, [key]: { ...permCheck[key], [i]: e.target.checked } })} className="sr-only" />
                        <span className={`block w-6 h-6 rounded-lg text-[10px] flex items-center justify-center font-medium ${permCheck[key][i] ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                          {['U', 'G', 'O'][i]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPermissionsDialog(null)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-600">取消</button>
              <button onClick={handlePermissionsSave} className="flex-1 py-2.5 rounded-xl bg-blue-50 text-sm text-blue-600">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 压缩 */}
      {compressOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setCompressOpen(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in shadow-xl">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">压缩</h3>
            <div className="mb-2">
              <label className="text-[10px] text-gray-400 block mb-1">格式</label>
              <select value={compressFormat} onChange={e => setCompressFormat(e.target.value as any)}
                className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700 border border-gray-200 outline-none">
                <option value="zip">ZIP</option><option value="tar.gz">TAR.GZ</option><option value="tar.bz2">TAR.BZ2</option>
              </select>
            </div>
            <div className="mb-2">
              <label className="text-[10px] text-gray-400 block mb-1">级别</label>
              <select value={compressLevel} onChange={e => setCompressLevel(e.target.value as any)}
                className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700 border border-gray-200 outline-none">
                <option value="store">Store</option><option value="fast">Fast</option><option value="normal">Normal</option><option value="max">Max</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="text-[10px] text-gray-400 block mb-1">密码 (可选)</label>
              <div className="relative">
                <input value={compressPassword} onChange={e => setCompressPassword(e.target.value)}
                  placeholder="留空不加密" type={compressShowPass ? 'text' : 'password'}
                  className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-800 border border-gray-200 focus:border-blue-300 outline-none pr-10" />
                <button onClick={() => setCompressShowPass(!compressShowPass)} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <Eye size={14} className="text-gray-400" /></button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCompressOpen(false)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-600">取消</button>
              <button onClick={() => { handleCompress(); setCompressOpen(false) }} className="flex-1 py-2.5 rounded-xl bg-blue-50 text-sm text-blue-600">开始压缩</button>
            </div>
          </div>
        </div>
      )}

      {/* 解压 */}
      {extractOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setExtractOpen(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in shadow-xl">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">解压</h3>
            <input value={extractPath} onChange={e => setExtractPath(e.target.value)} placeholder="目标路径"
              className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-800 border border-gray-200 focus:border-blue-300 outline-none mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setExtractOpen(false)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-600">取消</button>
              <button onClick={() => { handleExtract(); setExtractOpen(false) }} className="flex-1 py-2.5 rounded-xl bg-blue-50 text-sm text-blue-600">开始解压</button>
            </div>
          </div>
        </div>
      )}

      {/* 图片查看器 */}
      {imageViewer && (
        <div className="fixed inset-0 z-[2000] bg-black/95 flex flex-col">
          <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => setScale(Math.max(0.5, scale - 0.25))} className="p-2 rounded-lg bg-white/10 text-white"><Minus size={16} /></button>
              <span className="text-white text-xs w-12 text-center">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(Math.min(5, scale + 0.25))} className="p-2 rounded-lg bg-white/10 text-white"><Plus size={16} /></button>
              <button onClick={() => setScale(1)} className="p-2 rounded-lg bg-white/10 text-white"><Maximize size={16} /></button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleDownloadFile} className="p-2 rounded-lg bg-white/10 text-white"><Download size={18} /></button>
              <button onClick={() => { setImageViewer(null); setScale(1) }} className="p-2 rounded-lg bg-white/10 text-white"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden"
            onWheel={e => { e.preventDefault(); setScale(prev => Math.min(5, Math.max(0.5, prev + (e.deltaY > 0 ? -0.1 : 0.1)))) }}
            onTouchStart={e => { if (e.touches.length === 2) touchScaleRef.current = { dist: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), scale } }}
            onTouchMove={e => { if (e.touches.length === 2 && touchScaleRef.current) setScale(Math.min(5, Math.max(0.5, touchScaleRef.current.scale * Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / touchScaleRef.current.dist))) }}>
            {imageLoading && <Loader2 size={32} className="animate-spin text-white absolute" />}
            {imageData && <img src={imageData} alt={imageViewer.file.name} className="max-w-full max-h-full object-contain transition-transform duration-150"
              style={{ transform: `scale(${scale})` }} draggable={false}
              onError={() => { setImageLoading(false); setImageViewer(null); showToast('图片加载失败', 'error') }}
              onLoad={() => setImageLoading(false)} />}
          </div>
        </div>
      )}

      {/* 文本编辑器 */}
      {editingFile && (
        <div className="fixed inset-0 z-[2000] bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <button onClick={() => setEditingFile(null)} className="p-2 rounded-lg hover:bg-gray-100"><ChevronLeft size={20} className="text-gray-600" /></button>
            <span className="text-sm font-medium text-gray-800 truncate mx-2">{editingFile.file.name}</span>
            <button onClick={saveEditorFile} className="p-2 rounded-lg bg-blue-50 text-blue-600"><Save size={18} /></button>
          </div>
          <textarea value={editingFile.content}
            onChange={e => setEditingFile((prev: typeof editingFile) => prev ? { ...prev, content: e.target.value } : null)}
            className="flex-1 w-full bg-gray-50 px-4 py-3 text-sm text-gray-800 font-mono resize-none outline-none" spellCheck={false} />
          <div className="px-4 py-2 text-[10px] text-gray-400 text-right border-t border-gray-100">
            {editingFile.content.split('\n').length} 行 | {(new Blob([editingFile.content]).size / 1024).toFixed(1)} KB
          </div>
        </div>
      )}

      {/* 属性 */}
      {propertySheet && (
        <div className="fixed inset-0 z-[2000]">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPropertySheet(null)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl animate-slide-up">
            <div className="sticky top-0 bg-white pt-3 pb-2 px-4 flex items-center justify-between border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">文件属性</h3>
              <button onClick={() => setPropertySheet(null)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="px-4 py-3 space-y-2">
              <Row label="名称" value={propertySheet.file.name} />
              <Row label="类型" value={propertySheet.file.type === 'directory' ? '目录' : propertySheet.file.name.split('.').pop()?.toUpperCase() || '文件'} />
              <Row label="大小" value={String(propertySheet.file.size)} />
              <Row label="修改时间" value={propertySheet.file.modified ? fmtTime(propertySheet.file.modified) : '-'} />
              <Row label="权限" value={propertySheet.file.permissions || '-'} mono />
              <Row label="路径" value={`${(propertySheet as any).currentPath || ''}/${propertySheet.file.name}`} mono />
            </div>
          </div>
        </div>
      )}

      {/* 分享 */}
      {shareDialogOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShareDialogOpen(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in shadow-xl">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">分享文件</h3>
            <div className="mb-4">
              <label className="text-[10px] text-gray-400 block mb-1">有效期</label>
              <select value={shareExpiryHours} onChange={e => setShareExpiryHours(Number(e.target.value))}
                className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-700 border border-gray-200 outline-none">
                <option value={1}>1 小时</option><option value={24}>24 小时</option><option value={72}>3 天</option><option value={168}>7 天</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShareDialogOpen(false)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-600">取消</button>
              <button onClick={() => { handleShareFile(); setShareDialogOpen(false) }} className="flex-1 py-2.5 rounded-xl bg-blue-50 text-sm text-blue-600">生成链接</button>
            </div>
          </div>
        </div>
      )}

      {/* 进度 */}
      {progressDialog && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in text-center shadow-xl">
            <Loader2 size={32} className="animate-spin text-blue-500 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-gray-800 mb-1">{progressDialog.title}</h3>
            <p className="text-xs text-gray-500">{progressDialog.message}</p>
          </div>
        </div>
      )}

      {/* 搜索 */}
      {searchDialogOpen && (
        <div className="fixed inset-0 z-[2000]">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSearchDialogOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl animate-slide-up" style={{ maxHeight: '60vh' }}>
            <div className="sticky top-0 bg-white pt-3 pb-2 px-4 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => setSearchDialogOpen(false)}><X size={18} className="text-gray-400" /></button>
                <h3 className="text-sm font-semibold text-gray-800">全局搜索</h3>
              </div>
              <input value={globalSearchQuery} onChange={e => { setGlobalSearchQuery(e.target.value); if (e.target.value.length > 2) handleGlobalSearch() }}
                placeholder="搜索文件名..." autoFocus
                className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-800 border border-gray-200 focus:border-blue-300 outline-none" />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '40vh' }}>
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => { navigateTo(r.path, activePane); setSearchDialogOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0"><LucideFile size={14} className="text-gray-400" /></div>
                  <div className="min-w-0"><span className="text-sm text-gray-700 block truncate">{r.name}</span><span className="text-[10px] text-gray-400">{r.path}</span></div>
                </button>
              ))}
              {searchResults.length === 0 && globalSearchQuery.length > 2 && (
                <p className="text-xs text-gray-400 text-center py-4">未找到匹配的文件</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 快速操作 */}
      {showQuickActions && (
        <div className="fixed inset-0 z-[2000]">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowQuickActions(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl animate-slide-up">
            <div className="sticky top-0 bg-white pt-3 pb-2 px-4 flex items-center justify-between border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">快速操作</h3>
              <button onClick={() => setShowQuickActions(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="px-4 py-2 space-y-0.5">
              <button onClick={() => { navigateTo('/tmp', activePane); setShowQuickActions(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><Zap size={16} className="text-amber-400" /><span className="text-sm text-gray-700">转到 /tmp</span></button>
              <button onClick={() => { navigateTo('/var/log', activePane); setShowQuickActions(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50"><Zap size={16} className="text-amber-400" /><span className="text-sm text-gray-700">转到 /var/log</span></button>
            </div>
          </div>
        </div>
      )}

      {/* 排序 */}
      {sortDialogOpen && (
        <div className="fixed inset-0 z-[2000]">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSortDialogOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl animate-slide-up">
            <div className="sticky top-0 bg-white pt-3 pb-2 px-4 flex items-center justify-between border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">排序方式</h3>
              <button onClick={() => setSortDialogOpen(false)}><X size={18} className="text-gray-400" /></button>
            </div>
            <div className="px-4 py-2 space-y-0.5">
              {(['name', 'size', 'date', 'type'] as const).map(opt => (
                <button key={opt} onClick={() => { setSortBy(opt); setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); setSortDialogOpen(false) }}
                  className={`w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-gray-50 ${sortBy === opt ? 'bg-blue-50' : ''}`}>
                  <span className="text-sm text-gray-700">{{ name: '名称', size: '大小', date: '修改时间', type: '类型' }[opt]}</span>
                  {sortBy === opt && <span className="text-xs text-blue-600">{sortOrder === 'asc' ? '升序' : '降序'}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 跳转 */}
      {jumpOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setJumpOpen(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-xs p-5 animate-scale-in shadow-xl">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">跳转到路径</h3>
            <input value={jumpPath} onChange={e => setJumpPath(e.target.value)} autoFocus placeholder="/path/to/dir"
              className="w-full bg-gray-50 rounded-xl px-3 py-2.5 text-sm text-gray-800 border border-gray-200 focus:border-blue-300 outline-none mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setJumpOpen(false)} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-600">取消</button>
              <button onClick={() => { if (jumpPath.trim()) { navigateTo(jumpPath.trim(), activePane); setJumpOpen(false) } }}
                disabled={!jumpPath.trim()} className="flex-1 py-2.5 rounded-xl bg-blue-50 text-sm text-blue-600 disabled:opacity-50">跳转</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {showToast_local && (
        <div className="fixed bottom-24 left-4 right-4 z-[2000] flex justify-center pointer-events-none">
          <div className="bg-gray-800 rounded-xl px-4 py-2 text-xs text-white shadow-lg animate-slide-up">{showToast_local}</div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs text-gray-400 w-16 shrink-0">{label}</span>
      <span className={`text-xs text-gray-700 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
