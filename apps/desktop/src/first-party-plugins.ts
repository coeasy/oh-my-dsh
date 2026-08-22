/**
 * Desktop first-run bootstrap for the FIRST-PARTY built-in plugins
 * (model-config / degeneration-guard / usage-analytics). Mirror of the
 * marketplace bootstrap (market-bootstrap.ts): the client bundles each plugin
 * and silently ensures it is installed into the web profile via the official
 * CLI (`dsh plugin --profile web add file:<bundled-path>`).
 *
 * Portability: plugin bundles live under resources/bundled-plugins when
 * packaged (shipped by electron-builder extraResources) and under
 * plugins/<pkg> in a dev checkout. Both are resolved here from a repo root /
 * resources root — no machine-specific path is ever baked in, so a third
 * machine can build and run the client as-is.
 *
 * Unlike the marketplace, built-ins have no "user removed" opt-out: they back
 * the desktop UI surfaces (config windows, usage analytics), so the client
 * re-installs a built-in that a manual `dsh plugin ... remove` removed. This
 * is a silent, best-effort step per home — never fatal.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  installPlugin,
  isPluginInstalled,
  pluginNeedsRefresh,
  refreshPlugin,
} from './market-bootstrap.ts'

/** Minimal logger hook so this module stays testable without Electron. */
export type BootstrapLogger = (level: 'info' | 'warn', message: string) => void

function defaultLogger(level: 'info' | 'warn', message: string): void {
  if (level === 'warn') console.warn(message)
  else console.info(message)
}

/** A first-party built-in plugin shipped with the client. */
export interface FirstPartySpec {
  /** npm package name installed into the web profile. */
  name: string
  /** Absolute path to the bundled plugin directory (package.json inside). */
  path: string
}

interface FirstPartyDef {
  name: string
  /** Directory under <repo>/plugins in a dev checkout. */
  devDir: string
  /** Directory under resources/bundled-plugins when packaged. */
  prodDir: string
}

/** The built-in first-party plugins the client ships and ensures. */
export const FIRST_PARTY_PLUGINS: readonly FirstPartyDef[] = [
  {
    name: '@dsh/plugin-model-config',
    devDir: 'plugins/model-config',
    prodDir: 'bundled-plugins/plugin-model-config',
  },
  {
    name: '@dsh/plugin-degeneration-guard',
    devDir: 'plugins/degeneration-guard',
    prodDir: 'bundled-plugins/plugin-degeneration-guard',
  },
  {
    name: '@dsh/plugin-usage-analytics',
    devDir: 'plugins/usage-analytics',
    prodDir: 'bundled-plugins/plugin-usage-analytics',
  },
]

/** Resolve the first-party plugins from the packaged resources root. */
export function firstPartyPluginsFromResources(resourcesRoot: string): FirstPartySpec[] {
  return FIRST_PARTY_PLUGINS.map(({ name, prodDir }) => ({
    name,
    path: join(resourcesRoot, prodDir),
  }))
}

/** Resolve the first-party plugins from a dev checkout repo root. */
export function firstPartyPluginsFromRepo(repoRoot: string): FirstPartySpec[] {
  return FIRST_PARTY_PLUGINS.map(({ name, devDir }) => ({
    name,
    path: join(repoRoot, devDir),
  }))
}

/** The bundled (checkout) version fingerprint of a first-party plugin dir. */
function bundledPluginVersion(pluginPath: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(pluginPath, 'package.json'), 'utf8')) as {
      version?: string
    }
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null
  } catch {
    return null
  }
}

/**
 * Ensure every first-party plugin is installed AND matches this client build
 * in EVERY plugin home (primary + mirrors): a stale build is refreshed via
 * official CLI remove+add (the build fingerprint version changed → pnpm
 * re-snapshots the file: dep), a missing one is first-run installed.
 * Best-effort per home — a failure is logged, never fatal.
 */
export async function ensureFirstPartyPlugins(
  dshCommand: string,
  plugins: readonly FirstPartySpec[],
  homes: string[],
  log: BootstrapLogger = defaultLogger,
): Promise<void> {
  for (const home of homes) {
    for (const { name, path } of plugins) {
      const bundledVersion = bundledPluginVersion(path)
      try {
        if (pluginNeedsRefresh(home, name, bundledVersion)) {
          const boot = await refreshPlugin(dshCommand, path, name, home)
          if (boot.ok) {
            log('info', `built-in ${name} refreshed → build ${bundledVersion} @ ${home}`)
          } else {
            log('warn', `built-in ${name} refresh failed @ ${home}: ${boot.output}`)
          }
        } else if (!isPluginInstalled(home, name)) {
          const boot = await installPlugin(dshCommand, path, home)
          if (boot.ok) {
            log('info', `built-in ${name} installed @ ${home}`)
          } else {
            log('warn', `built-in ${name} bootstrap failed @ ${home}: ${boot.output}`)
          }
        }
      } catch (error) {
        log('warn', `built-in ${name} bootstrap error @ ${home}: ${String(error)}`)
      }
    }
  }
}
