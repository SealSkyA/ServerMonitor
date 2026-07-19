import { Preferences } from '@capacitor/preferences'

async function isNative(): Promise<boolean> {
  try {
    await Preferences.get({ key: '__ping' })
    return true
  } catch {
    return false
  }
}

async function getKey(serverId: string): Promise<string[]> {
  const key = `servermonitor_cmdhist_${serverId}`
  try {
    if (await isNative()) {
      const { value } = await Preferences.get({ key })
      return value ? JSON.parse(value) : []
    }
  } catch {}
  const saved = localStorage.getItem(key)
  return saved ? JSON.parse(saved) : []
}

async function setKey(serverId: string, cmds: string[]): Promise<void> {
  const key = `servermonitor_cmdhist_${serverId}`
  const json = JSON.stringify(cmds)
  try {
    if (await isNative()) {
      await Preferences.set({ key, value: json })
      return
    }
  } catch {}
  localStorage.setItem(key, json)
}

export async function addCommand(serverId: string, cmd: string): Promise<string[]> {
  const cmds = await getKey(serverId)
  if (cmds.includes(cmd)) {
    const idx = cmds.indexOf(cmd)
    cmds.splice(idx, 1)
  }
  cmds.unshift(cmd)
  if (cmds.length > 99) cmds.pop()
  await setKey(serverId, cmds)
  return cmds
}

export async function getHistory(serverId: string): Promise<string[]> {
  return getKey(serverId)
}

export async function deleteHistory(serverId: string): Promise<void> {
  const key = `servermonitor_cmdhist_${serverId}`
  try {
    if (await isNative()) {
      await Preferences.remove({ key })
      return
    }
  } catch {}
  localStorage.removeItem(key)
}
