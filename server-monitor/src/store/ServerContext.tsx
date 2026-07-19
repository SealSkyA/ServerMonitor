import { createContext, useContext, useState, useCallback, useRef, type ReactNode, useEffect } from 'react'
import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { sshManager } from '../services/sshManager'
import { loadServers, saveServers } from '../services/storage'
import { deleteHistory } from '../services/commandHistory'
import type { Server } from '../types/server'

interface ServerContextType {
  servers: Server[]
  addServer: (server: Server) => void
  deleteServer: (id: string) => void
  updateServer: (id: string, updates: Partial<Server>) => void
  replaceServers: (servers: Server[]) => Promise<void>
  connectServer: (id: string, password?: string) => Promise<{ success: boolean; error?: string }>
  disconnectServer: (id: string) => Promise<void>
  isConnected: (id: string) => boolean
  execCommand: (id: string, cmd: string) => Promise<string>
}

const ServerContext = createContext<ServerContextType | null>(null)

export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<Server[]>([])
  const serversRef = useRef<Server[]>([])
  const reconnecting = useRef<Set<string>>(new Set())
  const lastRetryAttempt = useRef<Record<string, number>>({})

  useEffect(() => {
    loadServers<Server>().then(async data => {
      const existing = serversRef.current
      serversRef.current = [...existing, ...data.filter(server => !existing.some(current => current.id === server.id))]
      setServers([...serversRef.current])
      await sshManager.init()

      const serversWithPassword = data.filter(s => s.password)
      const results = await Promise.allSettled(serversWithPassword.map(async s => {
        const jump = s.jumpServerId
          ? data.find(js => js.id === s.jumpServerId && js.password)
          : undefined
        const result = await sshManager.connect(s, s.password!, jump)
        return { id: s.id, name: s.name, success: result.success, error: result.error }
      }))

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.success) {
          console.log(`[app] ${r.value.name} auto-connected`)
          serversRef.current = serversRef.current.map(p =>
            p.id === r.value.id ? { ...p, status: 'online' as const } : p)
        } else if (r.status === 'fulfilled') {
          console.log(`[app] ${r.value.name} connect failed: ${r.value.error}`)
        }
      }
      setServers([...serversRef.current])
      persist()
    })
  }, [])

  useEffect(() => {
    return () => { sshManager.disconnectAll() }
  }, [])

  useEffect(() => {
    let removed = false
    let listener: PluginListenerHandle | undefined
    App.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive || removed) return
      console.log('[app] Resumed, checking connections...')
      const current = [...serversRef.current]
      let changed = false

      for (const s of current) {
        if (s.status !== 'online' || !s.password) continue
        if (reconnecting.current.has(s.id)) continue

        const alive = await sshManager.isConnected(s.id)
        if (alive) continue

        // Connection dead — clean up old state then reconnect
        console.log(`[app] ${s.name} disconnected, cleaning up and reconnecting...`)
        try { await sshManager.disconnect(s.id) } catch {}
        reconnecting.current.add(s.id)

        serversRef.current = serversRef.current.map(p =>
          p.id === s.id ? { ...p, status: 'offline' as const } : p)
        changed = true

        await new Promise(r => setTimeout(r, 1000))

        const jump = s.jumpServerId
          ? current.find(js => js.id === s.jumpServerId && js.password)
          : undefined
        const result = await sshManager.connect(s, s.password, jump)
        if (result.success) {
          console.log(`[app] ${s.name} reconnected OK`)
          serversRef.current = serversRef.current.map(p =>
            p.id === s.id ? { ...p, status: 'online' as const } : p)
          changed = true
        } else {
          console.log(`[app] ${s.name} reconnect failed: ${result.error}`)
        }

        setTimeout(() => reconnecting.current.delete(s.id), 30000)
      }

      if (changed) {
        setServers([...serversRef.current])
        persist()
      }
    }).then(handle => {
      if (removed) handle.remove()
      else listener = handle
    })

    return () => {
      removed = true
      listener?.remove()
    }
  }, [])

  // Auto-reconnect on connection lost
  useEffect(() => {
    return sshManager.onConnectionLost(async (serverId) => {
      if (reconnecting.current.has(serverId)) {
        console.log(`[app] Already reconnecting ${serverId}, skipping`)
        return
      }
      reconnecting.current.add(serverId)
      console.log(`[app] Connection lost: ${serverId}, attempting reconnect...`)
      const s = serversRef.current.find(p => p.id === serverId)
      if (!s || !s.password) { reconnecting.current.delete(serverId); return }

      serversRef.current = serversRef.current.map(p =>
        p.id === serverId ? { ...p, status: 'offline' as const } : p)
      setServers([...serversRef.current])
      persist()

      await new Promise(r => setTimeout(r, 3000))

      // Clean up stale connection before reconnecting
      try { await sshManager.disconnect(serverId) } catch {}

      const jump = s.jumpServerId
        ? serversRef.current.find(js => js.id === s.jumpServerId && js.password)
        : undefined
      const result = await sshManager.connect(s, s.password, jump)
      if (result.success) {
        console.log(`[app] ${s.name} auto-reconnected`)
        serversRef.current = serversRef.current.map(p =>
          p.id === serverId ? { ...p, status: 'online' as const } : p)
        setServers([...serversRef.current])
        persist()
      } else {
        console.log(`[app] ${s.name} auto-reconnect failed`)
      }
      setTimeout(() => reconnecting.current.delete(serverId), 30000)
    })
  }, [])

  // Periodic health check + offline server retry every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const now = Date.now()
      const current = [...serversRef.current]
      let changed = false

      // 1. Health check: reconnect dead connections
      const dead = await sshManager.healthCheck()
      if (dead.length > 0) {
        console.log(`[app] Health check found ${dead.length} dead connections`)
        for (const serverId of dead) {
          if (reconnecting.current.has(serverId)) continue
          const s = current.find(p => p.id === serverId)
          if (!s || !s.password) continue

          serversRef.current = serversRef.current.map(p =>
            p.id === serverId ? { ...p, status: 'offline' as const } : p)
          changed = true

          try { await sshManager.disconnect(serverId) } catch {}
          const jump = s.jumpServerId
            ? current.find(js => js.id === s.jumpServerId && js.password)
            : undefined
          const result = await sshManager.connect(s, s.password, jump)
          if (result.success) {
            console.log(`[app] ${s.name} health-reconnected`)
            serversRef.current = serversRef.current.map(p =>
              p.id === serverId ? { ...p, status: 'online' as const } : p)
            changed = true
          }
        }
      }

      // 2. Retry offline servers AND sync stale status
      for (const s of current) {
        if (!s.password) continue
        if (reconnecting.current.has(s.id)) continue
        const connectedLocal = sshManager.isConnectedLocally(s.id)

        if (connectedLocal && s.status !== 'online') {
          // Map says connected but servRef says offline — sync
          console.log(`[app] Syncing stale status for ${s.name}: offline → online`)
          serversRef.current = serversRef.current.map(p =>
            p.id === s.id ? { ...p, status: 'online' as const } : p)
          changed = true
          continue
        }

        if (connectedLocal) continue // already connected, skip

        const last = lastRetryAttempt.current[s.id] || 0
        if (now - last < 60000) continue

        lastRetryAttempt.current[s.id] = now
        console.log(`[app] Retrying offline server: ${s.name}`)

        try { await sshManager.disconnect(s.id) } catch {}
        const jump = s.jumpServerId
          ? current.find(js => js.id === s.jumpServerId && js.password)
          : undefined
        const result = await sshManager.connect(s, s.password, jump)
        if (result.success) {
          console.log(`[app] ${s.name} connected on retry`)
          serversRef.current = serversRef.current.map(p =>
            p.id === s.id ? { ...p, status: 'online' as const } : p)
          changed = true
        }
      }

      if (changed) {
        setServers([...serversRef.current])
        persist()
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  const persist = () => {
    saveServers(serversRef.current)
  }

  const addServer = useCallback((server: Server) => {
    serversRef.current = [server, ...serversRef.current]
    setServers(serversRef.current)
    persist()
  }, [])

  const deleteServer = useCallback((id: string) => {
    sshManager.disconnect(id)
    deleteHistory(id)
    serversRef.current = serversRef.current.filter(s => s.id !== id)
    setServers(serversRef.current)
    persist()
  }, [])

  const updateServer = useCallback((id: string, updates: Partial<Server>) => {
    serversRef.current = serversRef.current.map(s => s.id === id ? { ...s, ...updates } : s)
    setServers(serversRef.current)
    persist()
  }, [])

  const replaceServers = useCallback(async (nextServers: Server[]) => {
    await sshManager.disconnectAll()
    serversRef.current = nextServers.map(server => ({ ...server, status: 'offline' as const }))
    setServers([...serversRef.current])
    persist()
  }, [])

  const connectServer = useCallback(async (id: string, password?: string) => {
    const server = serversRef.current.find(s => s.id === id)
    if (!server) return { success: false, error: 'Server not found' }
    const pwd = password || server.password || ''
    if (!pwd) return { success: false, error: 'No password provided' }

    // Clean up any stale connection before reconnecting
    try { await sshManager.disconnect(id) } catch {}

    const jump = server.jumpServerId
      ? serversRef.current.find(s => s.id === server.jumpServerId && s.password)
      : undefined
    const result = await sshManager.connect(server, pwd, jump)
    if (result.success) {
      serversRef.current = serversRef.current.map(s =>
        s.id === id ? { ...s, status: 'online' as const, password: pwd } : s)
      setServers(serversRef.current)
      persist()
    }
    return result
  }, [])

  const disconnectServer = useCallback(async (id: string) => {
    await sshManager.disconnect(id)
    serversRef.current = serversRef.current.map(s => s.id === id ? { ...s, status: 'offline' as const } : s)
    setServers(serversRef.current)
    persist()
  }, [])

  const isConnected = useCallback((id: string) => {
    return sshManager.isConnectedLocally(id)
  }, [])

  const execCommand = useCallback(async (id: string, cmd: string) => {
    return sshManager.execCommand(id, cmd)
  }, [])

  return (
    <ServerContext.Provider value={{
      servers, addServer, deleteServer, updateServer, replaceServers,
      connectServer, disconnectServer, isConnected, execCommand
    }}>
      {children}
    </ServerContext.Provider>
  )
}

export function useServers() {
  const ctx = useContext(ServerContext)
  if (!ctx) throw new Error('useServers must be used within ServerProvider')
  return ctx
}
