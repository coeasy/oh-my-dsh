import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DesktopSettings {
  workspace?: string
  autoUpdate?: boolean
  apiKeyPrompted?: boolean
  /** True once the bundled marketplace was ever auto-installed (first-run). */
  marketEverInstalled?: boolean
  /** True when the user intentionally removed the marketplace — never auto-reinstall. */
  marketUserRemoved?: boolean
}

export function desktopSettingsPath(userDataPath: string): string {
  return join(userDataPath, 'desktop-settings.json')
}

export function parseDesktopSettings(text: string): DesktopSettings {
  const json = JSON.parse(text) as unknown
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('desktop-settings.json must be an object')
  }
  const record = json as {
    workspace?: unknown
    autoUpdate?: unknown
    apiKeyPrompted?: unknown
    marketEverInstalled?: unknown
    marketUserRemoved?: unknown
  }
  const settings: DesktopSettings = {}
  if (typeof record.workspace === 'string' && record.workspace.trim()) {
    settings.workspace = record.workspace.trim()
  }
  if (typeof record.autoUpdate === 'boolean') settings.autoUpdate = record.autoUpdate
  if (typeof record.apiKeyPrompted === 'boolean') settings.apiKeyPrompted = record.apiKeyPrompted
  if (typeof record.marketEverInstalled === 'boolean')
    settings.marketEverInstalled = record.marketEverInstalled
  if (typeof record.marketUserRemoved === 'boolean')
    settings.marketUserRemoved = record.marketUserRemoved
  return settings
}

export function loadDesktopSettings(userDataPath: string): DesktopSettings {
  const path = desktopSettingsPath(userDataPath)
  if (!existsSync(path)) return {}
  return parseDesktopSettings(readFileSync(path, 'utf8'))
}

export function saveDesktopSettings(userDataPath: string, settings: DesktopSettings): void {
  mkdirSync(userDataPath, { recursive: true })
  writeFileSync(desktopSettingsPath(userDataPath), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
