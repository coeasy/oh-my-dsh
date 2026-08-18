import type { SpawnOptionsWithoutStdio } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Environment for the Harness child. Matches my-dsh: persist DSH_HOME
 * under Electron userData, strip ELECTRON_RUN_AS_NODE, keep the platform PATH.
 * Optional `.env` files fill blank keys only; the process environment wins.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

export function loadDotEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  return parseDotEnv(readFileSync(path, 'utf8'))
}

/**
 * Sidecar `.env` next to the file the user launched. Portable SFX extracts the
 * real exe to a temp dir, so `PORTABLE_EXECUTABLE_DIR` wins over `dirname(exe)`.
 */
export function resolveSidecarDotEnvPath(
  exeDirectory: string,
  portableExecutableDir: string | undefined = undefined,
): string {
  const dir =
    portableExecutableDir && portableExecutableDir.length > 0 ? portableExecutableDir : exeDirectory
  return join(dir, '.env')
}

function fillBlankKeys(target: NodeJS.ProcessEnv, extra: Record<string, string>): void {
  for (const [key, value] of Object.entries(extra)) {
    const current = target[key]
    if (current === undefined || current === '') target[key] = value
  }
}

export function buildHarnessSpawnOptions(
  launchDirectory: string,
  dshHome: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  sidecarEnv: Record<string, string> = {},
): SpawnOptionsWithoutStdio {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnvironment } = environment
  const pathKey = platform === 'win32' ? 'Path' : 'PATH'
  const env: NodeJS.ProcessEnv = {
    ...parentEnvironment,
    DSH_HOME: dshHome,
    NO_COLOR: '1',
    [pathKey]: environment[pathKey] ?? environment.PATH ?? '',
  }
  fillBlankKeys(env, sidecarEnv)
  fillBlankKeys(env, loadDotEnvFile(join(dshHome, '.env')))
  return {
    cwd: launchDirectory,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }
}

/**
 * Packaged / clone-backed launches must not inherit a developer PATH `dsh`
 * from `DSH_RUNTIME=local` or a stale `DSH_BIN`.
 */
export function sanitizeBundledSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env }
  delete next.DSH_RUNTIME
  delete next.DSH_BIN
  return next
}

export function formatExitCode(code: number): string {
  const unsigned = code >>> 0
  const hexadecimal = `0x${unsigned.toString(16).padStart(8, '0').toUpperCase()}`
  if (unsigned === 0xffff7003) {
    return `exit code ${unsigned} (${hexadecimal}, Crashpad handler unavailable)`
  }
  return `exit code ${code} (${hexadecimal})`
}
