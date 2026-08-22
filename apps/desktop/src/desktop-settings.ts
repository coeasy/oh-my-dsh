import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Plugin-homes sync matrix (primary + mirrors). The engine runs ONE home
 * (primary); mirrors are other harness homes (official ~/.dsh, third-party
 * appdata dirs) that the marketplace keeps in sync with the primary's plugin
 * set. Persisted so the client can broadcast installs to every home and run
 * lazy repair on launch.
 */
export interface PluginHomesConfig {
  /** Absolute path of the primary harness home (default: auto resolution). */
  primary?: string
  /** Absolute mirror paths (default: every discovered home except primary). */
  mirrors?: string[]
}

/** Persisted main-window geometry (P0-2: maximize on first run + remember). */
export interface WindowBounds {
  x?: number
  y?: number
  width?: number
  height?: number
  maximized?: boolean
}

export interface DesktopSettings {
  workspace?: string
  autoUpdate?: boolean
  apiKeyPrompted?: boolean
  /** Main-window bounds/maximized state persisted across restarts. */
  windowBounds?: WindowBounds
  /** True once the bundled marketplace was ever auto-installed (first-run). */
  marketEverInstalled?: boolean
  /** True when the user intentionally removed the marketplace — never auto-reinstall. */
  marketUserRemoved?: boolean
  /**
   * Which harness home to run: 'auto' (default), 'custom', 'official', or an
   * explicit absolute path. See harness-home.ts. Persisted here so launch,
   * the marketplace and boot-fusing all follow the same home.
   */
  harnessHome?: string
  /**
   * Multi-home sync matrix: primary + mirrors the marketplace keeps in sync.
   * See harness-home.ts resolvePluginHomes.
   */
  pluginHomes?: PluginHomesConfig
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
    harnessHome?: unknown
    pluginHomes?: unknown
    windowBounds?: unknown
  }
  const settings: DesktopSettings = {}
  if (typeof record.workspace === 'string' && record.workspace.trim()) {
    settings.workspace = record.workspace.trim()
  }
  if (typeof record.autoUpdate === 'boolean') settings.autoUpdate = record.autoUpdate
  if (typeof record.apiKeyPrompted === 'boolean') settings.apiKeyPrompted = record.apiKeyPrompted
  if (
    record.windowBounds &&
    typeof record.windowBounds === 'object' &&
    !Array.isArray(record.windowBounds)
  ) {
    const raw = record.windowBounds as Record<string, unknown>
    const b: WindowBounds = {}
    if (typeof raw.x === 'number' && Number.isFinite(raw.x)) b.x = raw.x
    if (typeof raw.y === 'number' && Number.isFinite(raw.y)) b.y = raw.y
    if (typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width > 0)
      b.width = raw.width
    if (typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height > 0)
      b.height = raw.height
    if (typeof raw.maximized === 'boolean') b.maximized = raw.maximized
    if (Object.keys(b).length > 0) settings.windowBounds = b
  }
  if (typeof record.marketEverInstalled === 'boolean')
    settings.marketEverInstalled = record.marketEverInstalled
  if (typeof record.marketUserRemoved === 'boolean')
    settings.marketUserRemoved = record.marketUserRemoved
  if (typeof record.harnessHome === 'string' && record.harnessHome.trim())
    settings.harnessHome = record.harnessHome.trim()
  if (
    record.pluginHomes &&
    typeof record.pluginHomes === 'object' &&
    !Array.isArray(record.pluginHomes)
  ) {
    const raw = record.pluginHomes as { primary?: unknown; mirrors?: unknown }
    const cfg: PluginHomesConfig = {}
    if (typeof raw.primary === 'string' && raw.primary.trim()) cfg.primary = raw.primary.trim()
    if (Array.isArray(raw.mirrors)) {
      const mirrors = raw.mirrors.filter(
        (m): m is string => typeof m === 'string' && m.trim().length > 0,
      )
      if (mirrors.length > 0) cfg.mirrors = mirrors.map((m) => m.trim())
    }
    if (cfg.primary !== undefined || cfg.mirrors !== undefined) settings.pluginHomes = cfg
  }
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
