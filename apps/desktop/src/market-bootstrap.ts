/**
 * Desktop first-run bootstrap: silently ensure the official plugin
 * marketplace is installed into the web profile via the official CLI
 * (`dsh plugin --profile web add file:<bundled-marketplace>`).
 * The marketplace is bundled with the client (not fetched from npm), so a
 * fresh user gets it with zero steps — the "auto-install + one-time notice"
 * decision. Installs still go through the official CLI, so the bundle is
 * pnpm-tracked, reconcile-registered and removable by the official CLI.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

export interface BootstrapResult {
  ok: boolean
  output: string
}

/**
 * Install the marketplace using the official dsh CLI that the client is
 * launching, from the locally bundled marketplace path. dshCommand may be a
 * .cmd/.exe launcher, so on Windows it is executed via `cmd /c`.
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
    const win = process.platform === 'win32'
    const env = { ...process.env, CI: 'true', PATH: pnpmPath(), DSH_HOME: dshHome }
    const child = win
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${dshCommand}" ${args.join(' ')}`], {
          env,
          windowsHide: true,
        })
      : spawn(dshCommand, args, { env })
    track(child)
    let out = ''
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString()
    })
    child.stderr?.on('data', (c: Buffer) => {
      out += c.toString()
    })
    child.on('error', (error) => resolve({ ok: false, output: String(error) }))
    child.on('close', (code) => resolve({ ok: code === 0, output: out.slice(-2000) }))
  })
}
