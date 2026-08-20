/**
 * Official-channel command runner: every install / remove / update goes
 * through the dsh CLI that launched this host — `dsh plugin --profile <name>
 * <pnpm args...>` — so pnpm dependency tracking and the official bundles
 * reconcile stay the single source of truth. No manual copying, no private
 * registration.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isGithubRepo, isSafeProfileName } from './registry.ts'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

const SAFE_NPM_SPEC = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,213}$/u

/** Package specs accepted by marketplace routes and backup restore. */
export function isNpmSpec(spec: string): boolean {
  return SAFE_NPM_SPEC.test(String(spec || ''))
}

export function isGithubSpec(spec: string): boolean {
  const raw = String(spec || '')
  return raw.startsWith('github:') && isGithubRepo(raw.slice('github:'.length))
}

export function isInstallSpec(spec: string): boolean {
  return isNpmSpec(spec) || isGithubSpec(spec)
}

const MAX_COMMAND_OUTPUT = 64 * 1024
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000

/**
 * The real Node executable for spawning children. process.argv0 carries the
 * real node binary even when execPath is a wrapper (Android linker, etc.).
 */
export function nodeExecutable(
  argv0: string | undefined = process.argv0,
  execPath: string = process.execPath,
): string {
  if (argv0 !== undefined && argv0 !== '' && isAbsolute(argv0) && existsSync(argv0)) return argv0
  return execPath
}

/**
 * The dsh CLI entry that launched this host (bin.js). Re-invoking it means
 * plugin management uses exactly the official code path — including profile
 * init, pnpm forwarding and the bundles reconcile.
 */
export function dshCliEntry(argv1: string = process.argv[1]): string | null {
  if (argv1 && isAbsolute(argv1) && existsSync(argv1)) return argv1
  return null
}

/** Common pnpm bin dirs appended to PATH so the official channel works even
 * when the host was not launched from an interactive shell (P3: the dsh CLI
 * spawns `pnpm`; without it installs die with ENOENT/127). */
function pnpmBinDirs(): string[] {
  const appdata = process.env.APPDATA
  const home = process.env.HOME || process.env.USERPROFILE
  const dirs = new Set<string>()
  if (appdata) dirs.add(join(appdata, 'npm'))
  if (home) {
    dirs.add(join(home, '.local', 'share', 'pnpm'))
    dirs.add(join(home, '.config', 'pnpm'))
    dirs.add(join(home, '.yarn', 'bin'))
  }
  return [...dirs]
}

/**
 * Environment for CLI children: CI avoids TTY prompts hanging installs. When
 * `home` is given (an explicit market home config) it becomes DSH_HOME so the
 * CLI writes to the SAME home the installed-state reader checks — mirroring
 * the official home-paths precedence (configured > $DSH_HOME > ~/.dsh).
 */
export function childEnv(home?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' }
  if (home !== undefined && home.trim().length > 0) env.DSH_HOME = home
  const pnpmDirs = pnpmBinDirs()
  if (pnpmDirs.length > 0) {
    const sep = process.platform === 'win32' ? ';' : ':'
    const existing = process.env.PATH ?? ''
    env.PATH = [...pnpmDirs, existing].filter(Boolean).join(sep)
  }
  return env
}

/**
 * Run `dsh plugin --profile <profile> <args...>` and collect output.
 * @param profile - profile name to manage (e.g. "web").
 * @param args - pnpm arguments forwarded verbatim (e.g. ["add", "dshmarket"]).
 * @param opts - optional `home` to pin DSH_HOME for the child (keeps the CLI
 * on the same home the installed-state reader uses).
 */
export function runPluginCommand(
  profile: string,
  args: string[],
  opts: { home?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  if (!isSafeProfileName(profile)) {
    return Promise.resolve({ code: 400, stdout: '', stderr: 'invalid profile name' })
  }
  const entry = dshCliEntry()
  if (entry === null) {
    return Promise.resolve({
      code: 127,
      stdout: '',
      stderr: 'coeasy-dsh-market: cannot locate the dsh CLI entry that launched this host',
    })
  }
  return new Promise((resolve) => {
    const child = spawn(nodeExecutable(), [entry, 'plugin', '--profile', profile, ...args], {
      env: childEnv(opts.home),
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString()}`.slice(-MAX_COMMAND_OUTPUT)
    const finish = (result: RunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS)
    child.on('error', (error) => finish({ code: 1, stdout, stderr: `${stderr}${String(error)}` }))
    child.on('close', (code) =>
      finish({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}command timed out\n` : stderr,
      }),
    )
  })
}

/**
 * Install spec for a registry entry: npm package name when published
 * (fast tarball install, repository verified at snapshot build time), else
 * the official-friendly git spec (pnpm resolves it and the reconcile
 * registers it by its true package name).
 */
export function installSpecOf(entry: { pkg_name: string | null; full_name: string }): string {
  if (entry.pkg_name && entry.pkg_name !== '') return entry.pkg_name
  return `github:${entry.full_name}`
}
