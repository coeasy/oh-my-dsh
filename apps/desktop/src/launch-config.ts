import { join as joinDefault, posix, win32 } from 'node:path'
import { existsSync } from 'node:fs'

const pathFor = (platform: NodeJS.Platform | undefined) =>
  (platform ?? process.platform) === 'win32' ? win32 : posix

export type RuntimeMode = 'local' | 'download' | 'bundled'

export interface BundledRuntimeFile {
  downloadUrl?: string
}

export interface EngineLaunch {
  mode: RuntimeMode
  dshCommand?: string
  cloneBin?: string
}

export function bundledLauncherName(platform = process.platform): string {
  return platform === 'win32' ? 'dsh.cmd' : 'dsh'
}

/**
 * Packaged Electron always uses extraResources. Unpackaged prefers
 * `runtime/stage` then the gitignored clone. `DSH_RUNTIME=local` only
 * uses PATH/`DSH_BIN` when no clone is present, or when `DSH_BIN` is set.
 */
export function resolveDesktopMode(input: {
  packaged: boolean
  env?: NodeJS.ProcessEnv
}): RuntimeMode {
  const raw = String((input.env ?? {}).DSH_RUNTIME || '')
    .trim()
    .toLowerCase()
  if (raw === 'local' || raw === 'download' || raw === 'bundled') return raw
  return input.packaged ? 'bundled' : 'local'
}

/**
 * Unpackaged shells prefer `runtime/stage` then the gitignored clone, and only
 * then PATH `dsh`. PATH often still points at an old workspace wrapper.
 */
export function resolveEngineLaunch(input: {
  packaged: boolean
  resourcesPath: string
  moduleDir: string
  repoRoot: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
}): EngineLaunch {
  const env = input.env ?? {}
  const exists = input.exists ?? existsSync
  const platform = input.platform ?? process.platform
  const name = bundledLauncherName(platform)
  const explicit = String(env.DSH_RUNTIME || '')
    .trim()
    .toLowerCase()

  if (input.packaged) {
    if (explicit === 'download') return { mode: 'download' }
    return {
      mode: 'bundled',
      dshCommand: joinDefault(input.resourcesPath, 'runtime', name),
    }
  }
  if (explicit === 'download') return { mode: 'download' }
  if (explicit === 'local' && env.DSH_BIN) {
    return { mode: 'local', dshCommand: env.DSH_BIN }
  }

  const staged = joinDefault(input.repoRoot, 'runtime', 'stage', name)
  if (explicit === 'bundled') {
    return { mode: 'bundled', dshCommand: staged }
  }
  if (exists(staged)) return { mode: 'bundled', dshCommand: staged }

  const cloneBin = joinDefault(input.repoRoot, 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
  if (exists(cloneBin)) {
    return {
      mode: 'bundled',
      dshCommand: joinDefault(input.repoRoot, 'runtime', 'dev', name),
      cloneBin,
    }
  }
  return { mode: 'local' }
}

export function parseRuntimeFile(text: string): BundledRuntimeFile {
  const json = JSON.parse(text) as unknown
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('runtime.json must be an object')
  }
  const downloadUrl =
    typeof (json as { downloadUrl?: unknown }).downloadUrl === 'string'
      ? (json as { downloadUrl: string }).downloadUrl.trim()
      : ''
  return downloadUrl ? { downloadUrl } : {}
}

/** DSH_RUNTIME_URL overrides the bundled runtime.json. */
export function resolveDesktopDownloadUrl(input: {
  env?: NodeJS.ProcessEnv
  bundled?: BundledRuntimeFile
}): string | undefined {
  const fromEnv = String((input.env ?? {}).DSH_RUNTIME_URL || '').trim()
  if (fromEnv) return fromEnv
  const fromFile = input.bundled?.downloadUrl?.trim()
  return fromFile || undefined
}

/**
 * dsh --patch loads the plugin from a real filesystem path.
 * Packaged builds copy embedded-client.js to extraResources (outside asar).
 */
export function resolvePluginPath(input: {
  packaged: boolean
  resourcesPath: string
  moduleDir: string
}): string {
  if (input.packaged) return joinDefault(input.resourcesPath, 'embedded-client.js')
  return joinDefault(input.moduleDir, 'embedded-client.js')
}

/**
 * Packaged: `resources/runtime/dsh.cmd`.
 * Unpackaged bundled smoke: repo `runtime/stage/dsh.cmd` (created by stage-runtime).
 */
export function resolveBundledDshCommand(input: {
  packaged: boolean
  resourcesPath: string
  moduleDir: string
  platform?: NodeJS.Platform
}): string {
  const join = pathFor(input.platform)
  const name = bundledLauncherName(input.platform)
  if (input.packaged) return join.join(input.resourcesPath, 'runtime', name)
  return join.join(input.moduleDir, '..', '..', '..', 'runtime', 'stage', name)
}
