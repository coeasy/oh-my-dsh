import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { RuntimeMode } from './types.ts'

const MODES = new Set<RuntimeMode>(['local', 'download', 'bundled'])

export function resolveRuntimeMode(
  explicit?: RuntimeMode,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeMode {
  if (explicit) return explicit
  const raw = (env.DSH_RUNTIME || 'local').trim().toLowerCase()
  if (MODES.has(raw as RuntimeMode)) return raw as RuntimeMode
  throw new Error(`DSH_RUNTIME must be local|download|bundled, got ${raw}`)
}

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_RUNTIME_CACHE || join(homedir(), '.dsh-client', 'runtime')
}

export function cachedBinaryPath(cacheDir: string, platform = process.platform): string {
  return join(cacheDir, platform === 'win32' ? 'dsh.cmd' : 'dsh')
}

export interface ResolveRuntimeInput {
  mode?: RuntimeMode
  dshCommand?: string
  cacheDir?: string
  downloadUrl?: string
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}

export interface ResolvedRuntime {
  mode: RuntimeMode
  command: string
}

/**
 * local: PATH / DSH_BIN.
 * bundled: absolute launcher inside the installer; missing file fails loud (no PATH fallback).
 * download: cached binary only — missing cache or missing DSH_RUNTIME_URL fails loud (no PATH fallback).
 */
export function resolveRuntime(input: ResolveRuntimeInput = {}): ResolvedRuntime {
  const env = input.env ?? process.env
  const mode = resolveRuntimeMode(input.mode, env)
  if (mode === 'local') {
    const command = input.dshCommand || env.DSH_BIN || 'dsh'
    return { mode, command }
  }
  if (mode === 'bundled') {
    const command = input.dshCommand || env.DSH_BIN || ''
    if (!command) {
      throw new Error('DSH_RUNTIME=bundled requires dshCommand or DSH_BIN (absolute launcher path)')
    }
    if (!isAbsolute(command)) {
      throw new Error(`bundled dsh must be an absolute path, got ${command}`)
    }
    const exists = input.exists ?? existsSync
    if (!exists(command)) {
      throw new Error(`DSH_RUNTIME=bundled: launcher missing at ${command}`)
    }
    return { mode, command }
  }
  const url = input.downloadUrl || env.DSH_RUNTIME_URL
  const cacheDir = input.cacheDir || defaultCacheDir(env)
  const command = cachedBinaryPath(cacheDir)
  const exists = input.exists ?? existsSync
  if (!exists(command)) {
    if (!url) {
      throw new Error(
        `DSH_RUNTIME=download but runtime is not cached at ${command} and DSH_RUNTIME_URL is unset`,
      )
    }
    throw new Error(
      `DSH_RUNTIME=download: runtime missing at ${command}; download from ${url} is not installed yet`,
    )
  }
  return { mode, command }
}
