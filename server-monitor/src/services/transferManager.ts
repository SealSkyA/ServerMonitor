import { sshManager } from './sshManager'

export interface TransferTask {
  id: string
  serverId: string
  serverName: string
  fileName: string
  remotePath: string
  direction: 'upload' | 'download'
  status: 'pending' | 'transferring' | 'completed' | 'failed'
  progress: number
  totalBytes: number
  transferredBytes: number
  error?: string
  data?: ArrayBuffer
  createdAt: number
}

type Listener = () => void

const CHUNK_SIZE = 256 * 1024

class TransferManager {
  private tasks: TransferTask[] = []
  private listeners = new Set<Listener>()

  getTasks(): TransferTask[] {
    return this.tasks
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const l of this.listeners) l()
  }

  addUpload(serverId: string, serverName: string, remotePath: string, file: File): TransferTask {
    const task: TransferTask = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      serverId,
      serverName,
      fileName: file.name,
      remotePath,
      direction: 'upload',
      status: 'pending',
      progress: 0,
      totalBytes: file.size,
      transferredBytes: 0,
      createdAt: Date.now(),
    }
    this.tasks.unshift(task)
    this.notify()
    this.processTask(task, file)
    return task
  }

  addDownload(serverId: string, serverName: string, remotePath: string, fileName: string): TransferTask {
    const task: TransferTask = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      serverId,
      serverName,
      fileName,
      remotePath,
      direction: 'download',
      status: 'pending',
      progress: 0,
      totalBytes: 0,
      transferredBytes: 0,
      createdAt: Date.now(),
    }
    this.tasks.unshift(task)
    this.notify()
    this.processDownload(task)
    return task
  }

  private async processTask(task: TransferTask, file: File) {
    task.status = 'transferring'
    this.notify()

    try {
      if (task.direction === 'upload') {
        await this.uploadChunked(task, file)
      }
    } catch (e: unknown) {
      task.status = 'failed'
      task.error = e instanceof Error ? e.message : 'Transfer failed'
      this.notify()
    }
  }

  private async uploadChunked(task: TransferTask, file: File) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      const arrayBuf = await chunk.arrayBuffer()
      const bytes = new Uint8Array(arrayBuf)

      let base64 = ''
      for (let j = 0; j < bytes.length; j++) {
        base64 += String.fromCharCode(bytes[j])
      }
      base64 = btoa(base64)

      let ok: boolean
      if (i === 0) {
        ok = await sshManager.uploadFile(task.serverId, task.remotePath, base64)
      } else {
        ok = await sshManager.appendToFile(task.serverId, task.remotePath, base64)
      }

      if (!ok) throw new Error('Upload chunk failed')

      task.transferredBytes = end
      task.progress = Math.round((task.transferredBytes / task.totalBytes) * 100)
      this.notify()

      if (i < totalChunks - 1) {
        await new Promise(r => setTimeout(r, 50))
      }
    }

    task.status = 'completed'
    task.progress = 100
    this.notify()
  }

  private async processDownload(task: TransferTask) {
    task.status = 'transferring'
    this.notify()

    try {
      const data = await sshManager.downloadFile(task.serverId, task.remotePath)
      if (!data) throw new Error('Download failed')

      task.totalBytes = data.byteLength
      task.transferredBytes = data.byteLength
      task.progress = 100

      task.data = data
      task.status = 'completed'
      this.notify()
    } catch (e: unknown) {
      task.status = 'failed'
      task.error = e instanceof Error ? e.message : 'Download failed'
      this.notify()
    }
  }

  clearCompleted() {
    this.tasks = this.tasks.filter(t => t.status === 'pending' || t.status === 'transferring')
    this.notify()
  }

  removeTask(taskId: string) {
    this.tasks = this.tasks.filter(t => t.id !== taskId)
    this.notify()
  }
}

export const transferManager = new TransferManager()
