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
 * Is a package already recorded in the OFFICIAL profile deps, under the REAL
 * DSH_HOME the client runs (userData/harness), not the global ~/.dsh.
 * The desktop client sets DSH_HOME to userData/harness for every harness
 * child; checking the wrong home here is what let the marketplace install
 * into ~/.dsh and stay missing from the running web profile.
 */
export function isPluginInstalled(dshHome: string, pkgName: string): boolean {
  const manifest = webProfileManifest(dshHome)
  if (!existsSync(manifest)) return false
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    return Object.keys(pkg.dependencies ?? {}).includes(pkgName)
  } catch {
    return false
  }
}

/** Marketplace-specific shorthand for {@link isPluginInstalled}. */
export function isMarketInstalled(dshHome: string): boolean {
  return isPluginInstalled(dshHome, MARKET_PACKAGE)
}

/** pnpm lives in user bin dirs that may not be on the spawn PATH. */
function pnpmPath(): string {
  const appdata = process.env.APPDATA
  const home = process.env.HOME || process.env.USERPROFILE
  const localappdata = process.env.LOCALAPPDATA
  const dirs: string[] = []
  if (appdata) dirs.push(join(appdata, 'npm'))
  // pnpm's own Windows installer installs to %LOCALAPPDATA%\pnpm.
  if (localappdata) dirs.push(join(localappdata, 'pnpm'))
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
 * Run one official dsh `plugin --profile web <...>` command against the given
 * DSH_HOME, resolving the (possibly .cmd) launcher safely to node + bin.js so
 * no user-controlled path is ever interpolated into a shell command. The
 * spawned CLI MUST receive the same DSH_HOME the client runs, otherwise
 * `dsh plugin --profile web add` lands in the global ~/.dsh.
 */
function runMarketCommand(
  dshCommand: string,
  args: string[],
  dshHome: string,
): Promise<BootstrapResult> {
  return new Promise((resolve) => {
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

/**
 * The version of the BUNDLED marketplace (the checkout that ships with this
 * client). Bumped per-build by scripts/bump-version.mjs so pnpm re-snapshots
 * changed code and this freshness check can detect staleness.
 */
export function marketBundledVersion(marketPath: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(marketPath, 'package.json'), 'utf8')) as {
      version?: string
    }
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null
  } catch {
    return null
  }
}

/** The version of the INSTALLED package under a real DSH_HOME, if any. */
export function installedPluginVersion(dshHome: string, pkgName: string): string | null {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(dshHome, 'profiles', 'web', 'node_modules', pkgName, 'package.json'),
        'utf8',
      ),
    ) as { version?: string }
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null
  } catch {
    return null
  }
}

/** Marketplace-specific shorthand for {@link installedPluginVersion}. */
export function installedMarketVersion(dshHome: string): string | null {
  return installedPluginVersion(dshHome, MARKET_PACKAGE)
}

/**
 * Is the installed marketplace stale relative to the bundled build? Only when
 * a version fingerprint exists AND the installed version differs — this is
 * what triggers the auto-refresh that fixes the "file: 市场快照陈旧" bug.
 */
export function pluginNeedsRefresh(
  dshHome: string,
  pkgName: string,
  bundledVersion: string | null,
): boolean {
  if (!bundledVersion) return false
  const installed = installedPluginVersion(dshHome, pkgName)
  if (installed === null) return false // not installed → install path, not refresh
  return installed !== bundledVersion
}

/** Marketplace-specific shorthand for {@link pluginNeedsRefresh}. */
export function marketNeedsRefresh(dshHome: string, bundledVersion: string | null): boolean {
  return pluginNeedsRefresh(dshHome, MARKET_PACKAGE, bundledVersion)
}

/**
 * Install the marketplace using the official dsh CLI that the client is
 * launching, from the locally bundled marketplace path.
 */
export function installPlugin(
  dshCommand: string,
  pluginPath: string,
  dshHome: string,
): Promise<BootstrapResult> {
  // Pass the bare absolute path, NOT a `file:` spec: on Windows pnpm resolves
  // `file:P:\…` / `file:///P:/…` as a RELATIVE spec and concatenates it under
  // the profile dir (`…\profiles\web\P:\…`), so plugin installs silently
  // fail with ENOENT and no plugin ever appears in the UI. A bare absolute
  // path installs as a link dependency on every platform.
  return runMarketCommand(dshCommand, ['plugin', '--profile', 'web', 'add', pluginPath], dshHome)
}

/** Marketplace-specific shorthand for {@link installPlugin}. */
export function installMarket(
  dshCommand: string,
  marketPath: string,
  dshHome: string,
): Promise<BootstrapResult> {
  return installPlugin(dshCommand, marketPath, dshHome)
}

/**
 * Refresh a stale bundled marketplace: remove + re-add through the official
 * CLI (idempotent). pnpm re-snapshots the file: directory because the build
 * fingerprint version changed, so the running code matches the client build.
 */
export async function refreshPlugin(
  dshCommand: string,
  pluginPath: string,
  pluginName: string,
  dshHome: string,
): Promise<BootstrapResult> {
  const removed = await runMarketCommand(
    dshCommand,
    ['plugin', '--profile', 'web', 'remove', pluginName],
    dshHome,
  )
  if (!removed.ok) return removed
  return installPlugin(dshCommand, pluginPath, dshHome)
}

/** Marketplace-specific shorthand for {@link refreshPlugin}. */
export async function refreshMarket(
  dshCommand: string,
  marketPath: string,
  dshHome: string,
): Promise<BootstrapResult> {
  return refreshPlugin(dshCommand, marketPath, MARKET_PACKAGE, dshHome)
}
