import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface SshPlugin {
  connect(options: {
    id: string
    host: string
    port: number
    username: string
    password?: string
    keyData?: string
    keyPassphrase?: string
    jumpHost?: string
    jumpPort?: number
    jumpUsername?: string
    jumpPassword?: string
  }): Promise<{ success: boolean; connectionId: string; error?: string }>

  disconnect(options: { connectionId: string }): Promise<{ success: boolean }>

  execCommand(options: {
    connectionId: string
    command: string
  }): Promise<{ output: string }>

  startShell(options: { connectionId: string }): Promise<{ success: boolean }>

  writeToShell(options: { connectionId: string; data: string }): Promise<void>

  resizePty(options: { connectionId: string; cols: number; rows: number }): Promise<void>

  stopShell(options: { connectionId: string }): Promise<void>

  listFiles(options: {
    connectionId: string
    path: string
  }): Promise<{ files: Array<{ name: string; type: string; size: number; permissions: string; modified: string }>; path: string }>

  deleteFile(options: { connectionId: string; path: string }): Promise<{ success: boolean }>

  createDirectory(options: { connectionId: string; path: string }): Promise<{ success: boolean }>

  readFile(options: { connectionId: string; path: string }): Promise<{ content: string }>
  readFileChunk(options: { connectionId: string; path: string; offset: number; maxBytes: number }): Promise<{ content: string; size: number; bytes: number; firstLine: number; error: boolean }>

  isConnected(options: { connectionId: string }): Promise<{ connected: boolean }>

  uploadFile(options: {
    connectionId: string
    remotePath: string
    data: string
  }): Promise<{ success: boolean }>

  uploadDirectory(options: {
    connectionId: string
    remotePath: string
  }): Promise<{ success: boolean; files: number }>

  saveConfigBackup(options: {
    fileName: string
    data: string
  }): Promise<{ success: boolean; cancelled?: boolean }>

  saveDownloadedFile(options: {
    fileName: string
    data: string
  }): Promise<{ success: boolean; cancelled?: boolean }>

  uploadWebDavBackup(options: {
    url: string
    username: string
    password: string
    path: string
    fileName: string
    data: string
  }): Promise<{ success: boolean; fileName: string; error?: string }>

  testWebDavConnection(options: {
    url: string
    username: string
    password: string
    path: string
  }): Promise<{ success: boolean }>

  listWebDavBackups(options: {
    url: string
    username: string
    password: string
    path: string
  }): Promise<{ files: string[] }>

  downloadWebDavBackup(options: {
    url: string
    username: string
    password: string
    path: string
    fileName: string
  }): Promise<{ data: string }>

  appendToFile(options: {
    connectionId: string
    remotePath: string
    data: string
  }): Promise<{ success: boolean }>

  downloadFile(options: {
    connectionId: string
    remotePath: string
  }): Promise<{ success: boolean; data?: string; error?: string }>

  copyRemoteFile(options: {
    sourceConnectionId: string
    sourcePath: string
    destinationConnectionId: string
    destinationPath: string
  }): Promise<{ success: boolean; error?: string }>

  addListener(eventName: 'shellData' | 'connectionLost' | 'shellRestarted' | 'directoryUploadProgress', callback: (data: { connectionId: string; data?: string; disconnected?: boolean; restarted?: boolean; fileName?: string; uploadedFiles?: number; totalFiles?: number; progress?: number }) => void): Promise<PluginListenerHandle>
  removeAllListeners(): void
}

const Ssh = registerPlugin<SshPlugin>('SshPlugin')
export default Ssh
