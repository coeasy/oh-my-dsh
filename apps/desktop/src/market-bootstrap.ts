/**
 * Desktop first-run bootstrap: silently ensure the official plugin
 * marketplace is installed into the web profile via the official CLI
 * (`dsh plugin --profile web add file:<bundled-marketplace>`).
 * The marketplace is bundled with the client (not fetched from npm), so a
 * fresh user gets it with zero steps — the "auto-install + one-time notice"
 * decision. Installs still go through the official CLI, so the bundle is
 * pnpm-tracked, reconcile-registered and removable by the official CLI.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDirectSpawn } from '@dsh/client-runtime'

export const MARKET_PACKAGE = '@coeasy/dsh-plugin-marketplace'

/** The web profile manifest under a given DSH_HOME. */
function webProfileManifest(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'package.json')
}

/** Children spawned by the bootstrap/install path, reaped on quit. */
const liveChildren = new Set<ChildProcess>()

function track(child: ChildProcess): void {
  liveChildren.add(child)
  child.once('exit', () => liveChildren.delete(child))
}

/** Reap any still-running bootstrap/install children (called during quit). */
export function killBootstrapProcesses(platform = process.platform): void {
  for (const child of liveChildren) {
    if (child.pid) {
      if (platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else {
        try {
          child.kill('SIGKILL')
        } catch {
          /* gone */
        }
      }
    }
  }
}

/**
 * Is the marketplace already recorded in the OFFICIAL profile deps, under the
 * REAL DSH_HOME the client runs (userData/harness), not the global ~/.dsh.
 * The desktop client sets DSH_HOME to userData/harness for every harness
 * child; checking the wrong home here is what let the marketplace install
 * into ~/.dsh and stay missing from the running web profile.
 */
export function isMarketInstalled(dshHome: string): boolean {
  const manifest = webProfileManifest(dshHome)
  if (!existsSync(manifest)) return false
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    return Object.keys(pkg.dependencies ?? {}).includes(MARKET_PACKAGE)
  } catch {
    return false
  }
}

/** pnpm lives in user bin dirs that may not be on the spawn PATH. */
function pnpmPath(): string {
  const appdata = process.env.APPDATA
  const home = process.env.HOME || process.env.USERPROFILE
  const dirs: string[] = []
  if (appdata) dirs.push(join(appdata, 'npm'))
  if (home) dirs.push(join(home, '.local', 'share', 'pnpm'), join(home, '.config', 'pnpm'))
  const sep = process.platform === 'win32' ? ';' : ':'
  return [...dirs, process.env.PATH ?? ''].filter(Boolean).join(sep)
}

/** Resolve a simple PATH command without turning user input into shell text. */
function resolveWindowsLauncher(command: string): string | undefined {
  if (process.platform !== 'win32') return command
  if (/[\\/]/u.test(command) || !/^[A-Za-z0-9._-]+$/u.test(command)) return undefined
  const where = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'where.exe')
    : 'where.exe'
  const result = spawnSync(where, [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  })
  if (result.status !== 0) return undefined
  return String(result.stdout ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^[A-Za-z]:[\\/]/u.test(line))
}

export interface BootstrapResult {
  ok: boolean
  output: string
}

/**
 * Install the marketplace using the official dsh CLI that the client is
 * launching, from the locally bundled marketplace path. dshCommand may be a
 * .cmd launcher. Absolute launchers are resolved to `node + bin.js`, so no
 * user-controlled path is ever interpolated into a shell command.
 *
 * The spawned CLI MUST receive the same DSH_HOME the client runs, otherwise
 * `dsh plugin --profile web add` lands in the global ~/.dsh and the running
 * web profile stays without a marketplace.
 */
export function installMarket(
  dshCommand: string,
  marketPath: string,
  dshHome: string,
): Promise<BootstrapResult> {
  return new Promise((resolve) => {
    const args = ['plugin', '--profile', 'web', 'add', `file:${marketPath}`]
    const env = { ...process.env, CI: 'true', PATH: pnpmPath(), DSH_HOME: dshHome }
    const resolvedCommand = resolveWindowsLauncher(dshCommand)
    const direct = resolveDirectSpawn(resolvedCommand ?? dshCommand, {
      exists: existsSync,
      read: (path) => readFileSync(path, 'utf8'),
    })
    if (process.platform === 'win32' && !direct) {
      resolve({
        ok: false,
        output: `unsafe or unresolved Windows dsh launcher: ${dshCommand}`,
      })
      return
    }
    const child = direct
      ? spawn(direct.exec, [...direct.prefixArgs, ...args], {
          env,
          windowsHide: true,
          shell: false,
        })
      : spawn(resolvedCommand ?? dshCommand, args, { env, windowsHide: true, shell: false })
    track(child)
    let out = ''
    const append = (chunk: Buffer): void => {
      out = `${out}${chunk.toString()}`.slice(-64 * 1024)
    }
    child.stdout?.on('data', (c: Buffer) => {
      append(c)
    })
    child.stderr?.on('data', (c: Buffer) => {
      append(c)
    })
    child.on('error', (error) => resolve({ ok: false, output: String(error) }))
    child.on('close', (code) => resolve({ ok: code === 0, output: out.slice(-2000) }))
  })
}
