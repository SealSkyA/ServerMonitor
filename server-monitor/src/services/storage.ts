import { Preferences } from '@capacitor/preferences'

const KEY = 'servermonitor_servers'

async function isNative(): Promise<boolean> {
  try {
    await Preferences.get({ key: '__ping' })
    return true
  } catch {
    return false
  }
}

export async function loadServers<T>(): Promise<T[]> {
  try {
    if (await isNative()) {
      const { value } = await Preferences.get({ key: KEY })
      return value ? JSON.parse(value) : []
    }
  } catch {}
  const saved = localStorage.getItem(KEY)
  return saved ? JSON.parse(saved) : []
}

export async function saveServers<T>(data: T[]): Promise<void> {
  const json = JSON.stringify(data)
  try {
    if (await isNative()) {
      await Preferences.set({ key: KEY, value: json })
      return
    }
  } catch {}
  localStorage.setItem(KEY, json)
}

export async function loadValue<T>(key: string, fallback: T): Promise<T> {
  try {
    if (await isNative()) {
      const { value } = await Preferences.get({ key })
      return value ? JSON.parse(value) : fallback
    }
  } catch {}
  const saved = localStorage.getItem(key)
  return saved ? JSON.parse(saved) : fallback
}

export async function saveValue<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value)
  try {
    if (await isNative()) {
      await Preferences.set({ key, value: json })
      return
    }
  } catch {}
  localStorage.setItem(key, json)
}
