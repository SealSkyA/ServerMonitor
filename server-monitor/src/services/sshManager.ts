import Ssh from '../plugins/ssh'
import type { Server } from '../types/server'
import type { PluginListenerHandle } from '@capacitor/core'

interface ConnectionState {
  serverId: string
  connected: boolean
  shellActive: boolean
}

type ConnectionLostCallback = (serverId: string) => void
type DirectoryUploadProgressCallback = (event: { serverId: string; fileName: string; uploadedFiles: number; totalFiles: number; progress: number }) => void

class SshManager {
  private connections: Map<string, ConnectionState> = new Map()
  private lostCallbacks = new Set<ConnectionLostCallback>()
  private shellRestartCallbacks = new Set<ConnectionLostCallback>()
  private directoryUploadProgressCallbacks = new Set<DirectoryUploadProgressCallback>()
  private listenerHandles: PluginListenerHandle[] = []
  private initPromise: Promise<void> | null = null

  getConnectionId(serverId: string): string {
    return `ssh_${serverId}`
  }

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = Promise.all([
      Ssh.addListener('connectionLost', (event) => {
      const serverId = event.connectionId.replace('ssh_', '')
      console.log(`[ssh] connectionLost: ${serverId}`)
      this.connections.delete(serverId)
      for (const cb of this.lostCallbacks) cb(serverId)
      }),
      Ssh.addListener('shellRestarted', (event) => {
      const serverId = event.connectionId.replace('ssh_', '')
      console.log(`[ssh] shellRestarted: ${serverId}`)
      const conn = this.connections.get(serverId)
      if (conn) {
        conn.connected = true
        conn.shellActive = true
      }
      for (const cb of this.shellRestartCallbacks) cb(serverId)
      }),
      Ssh.addListener('directoryUploadProgress', (event) => {
        const serverId = event.connectionId.replace('ssh_', '')
        for (const cb of this.directoryUploadProgressCallbacks) cb({
          serverId,
          fileName: event.fileName || '',
          uploadedFiles: event.uploadedFiles || 0,
          totalFiles: event.totalFiles || 0,
          progress: event.progress || 0,
        })
      }),
    ]).then(handles => { this.listenerHandles = handles })
    return this.initPromise
  }

  onConnectionLost(cb: ConnectionLostCallback): () => void {
    this.lostCallbacks.add(cb)
    return () => this.lostCallbacks.delete(cb)
  }

  onShellRestarted(cb: ConnectionLostCallback): () => void {
    this.shellRestartCallbacks.add(cb)
    return () => this.shellRestartCallbacks.delete(cb)
  }

  onDirectoryUploadProgress(cb: DirectoryUploadProgressCallback): () => void {
    this.directoryUploadProgressCallbacks.add(cb)
    return () => this.directoryUploadProgressCallbacks.delete(cb)
  }

  async connect(server: Server, password: string, jumpServer?: Server): Promise<{ success: boolean; error?: string }> {
    const id = this.getConnectionId(server.id)
    try {
      const result = await Ssh.connect({
        id,
        host: server.host,
        port: server.port,
        username: server.username,
        password,
        jumpHost: jumpServer?.host,
        jumpPort: jumpServer?.port || 22,
        jumpUsername: jumpServer?.username || 'root',
        jumpPassword: jumpServer?.password,
      })
      if (result.success) {
        this.connections.set(server.id, { serverId: server.id, connected: true, shellActive: false })
        return { success: true }
      }
      return { success: false, error: result.error || 'Unknown connection error' }
    } catch (e) {
      console.error('SSH connect error:', e)
      return { success: false, error: String(e) }
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const id = this.getConnectionId(serverId)
    const conn = this.connections.get(serverId)
    if (conn?.shellActive) {
      try { await Ssh.stopShell({ connectionId: id }) } catch {}
    }
    try { await Ssh.disconnect({ connectionId: id }) } catch {}
    this.connections.delete(serverId)
  }

  async execCommand(serverId: string, command: string): Promise<string> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.execCommand({ connectionId: id, command })
      if (result.output?.startsWith('ERROR:DISCONNECTED:')) {
        console.log(`[ssh] execCommand detected disconnect on ${serverId}`)
        this.connections.delete(serverId)
        for (const cb of this.lostCallbacks) cb(serverId)
        return `ERROR: Connection lost`
      }
      return result.output
    } catch (e: any) {
      console.log(`[ssh] execCommand error on ${serverId}:`, e)
      const msg = String(e?.message || e || '')
      const isRealDisconnect = /session|socket|disconnect|timeout|broken pipe/i.test(msg)
      if (isRealDisconnect) {
        console.log(`[ssh] execCommand: genuine disconnect detected`)
        this.connections.delete(serverId)
        for (const cb of this.lostCallbacks) cb(serverId)
        return `ERROR: Connection lost`
      }
      return `ERROR: ${msg || 'Unknown error'}`
    }
  }

  async startShell(serverId: string): Promise<boolean> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.startShell({ connectionId: id })
      if (result.success) {
        const conn = this.connections.get(serverId)
        if (conn) conn.shellActive = true
        return true
      }
      return false
    } catch {
      return false
    }
  }

  writeToShell(serverId: string, data: string): void {
    const id = this.getConnectionId(serverId)
    Ssh.writeToShell({ connectionId: id, data })
  }

  resizePty(serverId: string, cols: number, rows: number): void {
    const id = this.getConnectionId(serverId)
    Ssh.resizePty({ connectionId: id, cols, rows })
  }

  async stopShell(serverId: string): Promise<void> {
    const id = this.getConnectionId(serverId)
    try { await Ssh.stopShell({ connectionId: id }) } catch {}
    const conn = this.connections.get(serverId)
    if (conn) conn.shellActive = false
  }

  async listFiles(serverId: string, path: string) {
    const id = this.getConnectionId(serverId)
    return Ssh.listFiles({ connectionId: id, path })
  }

  async deleteFile(serverId: string, path: string): Promise<boolean> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.deleteFile({ connectionId: id, path })
      return result.success
    } catch {
      return false
    }
  }

  async createDirectory(serverId: string, path: string): Promise<boolean> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.createDirectory({ connectionId: id, path })
      return result.success
    } catch {
      return false
    }
  }

  async readFile(serverId: string, path: string): Promise<string> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.readFile({ connectionId: id, path })
      return result.content
    } catch {
      return 'ERROR: Failed to read file'
    }
  }

  async readFileChunk(serverId: string, path: string, offset: number, maxBytes = 5 * 1024 * 1024): Promise<{ content: string; size: number; bytes: number; firstLine: number; error: boolean }> {
    const id = this.getConnectionId(serverId)
    try {
      return await Ssh.readFileChunk({ connectionId: id, path, offset, maxBytes })
    } catch {
      return { content: 'Failed to read file chunk', size: -1, bytes: 0, firstLine: 1, error: true }
    }
  }

  async uploadFile(serverId: string, remotePath: string, data: string): Promise<boolean> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.uploadFile({ connectionId: id, remotePath, data })
      return result.success
    } catch {
      return false
    }
  }

  async uploadDirectory(serverId: string, remotePath: string): Promise<boolean> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.uploadDirectory({ connectionId: id, remotePath })
      return result.success
    } catch {
      return false
    }
  }

  async appendToFile(serverId: string, remotePath: string, data: string): Promise<boolean> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.appendToFile({ connectionId: id, remotePath, data })
      return result.success
    } catch {
      return false
    }
  }

  async downloadFile(serverId: string, remotePath: string): Promise<ArrayBuffer | null> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.downloadFile({ connectionId: id, remotePath })
      if (result.success && result.data) {
        const binaryStr = atob(result.data)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }
        return bytes.buffer
      }
      return null
    } catch {
      return null
    }
  }

  async copyRemoteFile(sourceServerId: string, sourcePath: string, destinationServerId: string, destinationPath: string): Promise<boolean> {
    try {
      const result = await Ssh.copyRemoteFile({
        sourceConnectionId: this.getConnectionId(sourceServerId),
        sourcePath,
        destinationConnectionId: this.getConnectionId(destinationServerId),
        destinationPath,
      })
      return result.success
    } catch {
      return false
    }
  }

  async isConnected(serverId: string): Promise<boolean> {
    const id = this.getConnectionId(serverId)
    try {
      const result = await Ssh.isConnected({ connectionId: id })
      return result.connected
    } catch {
      return false
    }
  }

  async healthCheck(): Promise<string[]> {
    const dead: string[] = []
    const conns = [...this.connections.entries()]
    for (const [serverId, state] of conns) {
      if (!state.connected) continue
      const alive = await this.isConnected(serverId)
      if (!alive) {
        dead.push(serverId)
        this.connections.delete(serverId)
      }
    }
    return dead
  }

  onShellData(callback: (serverId: string, data: string) => void): () => void {
    let removed = false
    let handle: PluginListenerHandle | undefined
    Ssh.addListener('shellData', (event) => {
      const serverId = event.connectionId.replace('ssh_', '')
      if (!removed && event.data) callback(serverId, event.data)
    }).then(listener => {
      if (removed) listener.remove()
      else handle = listener
    })
    return () => {
      removed = true
      handle?.remove()
    }
  }

  removeAllListeners(): void {
    Ssh.removeAllListeners()
    this.listenerHandles = []
    this.initPromise = null
  }

  isConnectedLocally(serverId: string): boolean {
    return this.connections.get(serverId)?.connected ?? false
  }

  async disconnectAll(): Promise<void> {
    for (const [serverId] of this.connections) {
      await this.disconnect(serverId)
    }
    this.connections.clear()
    await Promise.all(this.listenerHandles.map(handle => handle.remove()))
    this.listenerHandles = []
    this.initPromise = null
  }
}

export const sshManager = new SshManager()
