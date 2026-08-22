/**
 * Multi-home support: resolve which DeepSeek Harness home the client uses,
 * discover existing homes (official ~/.dsh, the client's custom userData
 * harness, and third-party harness dirs under %APPDATA%), and migrate between
 * them.
 *
 * Feasibility note: a single engine process runs against ONE home (official
 * precedence: configured path > $DSH_HOME > ~/.dsh). True simultaneous
 * multi-home loading is not possible without engine changes, so this module
 * provides DISCOVERY + SELECTION + MIGRATION — the client picks one home via
 * the `harnessHome` setting, and every component (launch, marketplace,
 * boot-fusing) follows that same resolved path.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { harnessHomePath } from './launch-root.ts'

/** Setting values: 'auto' (default), 'custom', 'official', or an explicit path. */
export type HarnessHomeMode = 'auto' | 'custom' | 'official' | (string & Record<never, never>)

export interface HarnessHomeInfo {
  /** Stable id for the settings UI: 'custom' | 'official' | absolute path. */
  id: string
  path: string
  exists: boolean
  /** Installed profile dependencies / bundles (read from profiles/web/package.json). */
  dependencyCount: number
  bundleCount: number
  /** True when the web profile has any non-core bundle (a "used" home). */
  hasPlugins: boolean
}

/** The official dsh home following the engine's own precedence (no config). */
export function officialHarnessHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return resolve(fromEnv.trim())
  return join(homedir(), '.dsh')
}

function profileStats(home: string): { dependencyCount: number; bundleCount: number } {
  const manifest = join(home, 'profiles', 'web', 'package.json')
  if (!existsSync(manifest)) return { dependencyCount: 0, bundleCount: 0 }
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    return {
      dependencyCount: Object.keys(pkg.dependencies ?? {}).length,
      bundleCount: (pkg.dsh?.profile?.bundles ?? []).length,
    }
  } catch {
    return { dependencyCount: 0, bundleCount: 0 }
  }
}

function toInfo(id: string, path: string): HarnessHomeInfo {
  const stats = profileStats(path)
  return {
    id,
    path,
    exists: existsSync(path),
    ...stats,
    hasPlugins: stats.bundleCount > 0 || stats.dependencyCount > 0,
  }
}

/**
 * Discover candidate harness homes:
 *  - custom:  <userData>/harness (this client's default)
 *  - official: ~/.dsh (or $DSH_HOME)
 *  - third-party: any <roaming>/<name>/harness under %APPDATA% that has a web
 *    profile manifest (e.g. dsh-client-desktop, DSH Desktop, @dsh/desktop) —
 *    bounded to one directory level, no recursion.
 */
export function discoverHarnessHomes(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env,
): HarnessHomeInfo[] {
  const results: HarnessHomeInfo[] = []
  const seen = new Set<string>()
  const add = (info: HarnessHomeInfo): void => {
    const key = info.path.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    results.push(info)
  }
  add(toInfo('custom', harnessHomePath(userDataPath)))
  const official = officialHarnessHome(env)
  add(toInfo('official', official))
  // Third-party scan under %APPDATA% (Windows) / ~/.config (POSIX).
  const base =
    process.platform === 'win32'
      ? env.APPDATA || join(homedir(), 'AppData', 'Roaming')
      : env.XDG_CONFIG_HOME || join(homedir(), '.config')
  if (base) {
    try {
      for (const name of readdirSync(base)) {
        if (name.startsWith('.')) continue
        const candidate = join(base, name, 'harness')
        if (!existsSync(join(candidate, 'profiles', 'web', 'package.json'))) continue
        let isDir = false
        try {
          isDir = statSync(candidate).isDirectory()
        } catch {
          /* skip */
        }
        if (isDir) add(toInfo(join(base, name), candidate))
      }
    } catch {
      /* unreadable appdata — discovery is best-effort */
    }
  }
  return results
}

/**
 * Resolve the effective harness home for the given mode:
 *  - explicit absolute path → that path
 *  - 'custom' → <userData>/harness
 *  - 'official' → official home
 *  - 'auto' → prefer the RICHER existing home among custom/official (more
 *    plugins), so a user who previously used ~/.dsh (official) keeps it by
 *    default; ties and missing homes fall back to custom.
 */
export function resolveHarnessHome(
  mode: HarnessHomeMode,
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof mode === 'string' && /^[A-Za-z]:[\\/]|[\\/]/u.test(mode)) {
    return resolve(mode)
  }
  if (mode === 'official') return officialHarnessHome(env)
  if (mode === 'auto') {
    const custom = toInfo('custom', harnessHomePath(userDataPath))
    const official = toInfo('official', officialHarnessHome(env))
    const weight = (info: HarnessHomeInfo): number =>
      info.bundleCount * 1000 + info.dependencyCount * 10 + (info.exists ? 1 : 0)
    return weight(official) > weight(custom) ? official.path : custom.path
  }
  return harnessHomePath(userDataPath)
}

/** Canonical lowercase key for a path, for dedup across drives/separators. */
function pathKey(path: string): string {
  return resolve(path)
    .toLowerCase()
    .replace(/[\\/]+$/u, '')
}

/**
 * Resolve the plugin-homes sync matrix the marketplace keeps in sync across:
 *  - `primary`: the harness home the engine actually runs. MUST match
 *    effectiveHarnessHome (main.ts) so the marketplace's own home and the
 *    client's idea of `primary` never diverge — hence it resolves from the
 *    SAME `harnessHome` setting (auto/custom/official/path). Explicit
 *    `pluginHomes.primary` only overrides when the setting is absent; callers
 *    setting it should keep `harnessHome` consistent (home:set-homes does).
 *  - `mirrors`: other harness homes installs are broadcast to. Explicit
 *    `pluginHomes.mirrors` wins, else every discovered home except primary
 *    (official ~/.dsh, third-party appdata dirs). Primary is never a mirror.
 * Dedups by canonical path, keeps only absolute paths.
 */
export function resolvePluginHomes(
  userDataPath: string,
  settings: { harnessHome?: string; pluginHomes?: { primary?: string; mirrors?: string[] } },
  env: NodeJS.ProcessEnv = process.env,
): { primary: string; mirrors: string[] } {
  const primary = resolve(
    settings.pluginHomes?.primary?.trim() ||
      resolveHarnessHome(
        (settings.harnessHome as HarnessHomeMode | undefined) ?? 'auto',
        userDataPath,
        env,
      ),
  )
  const primaryKey = pathKey(primary)
  const mirrors: string[] = []
  const seen = new Set<string>([primaryKey])
  const explicit = settings.pluginHomes?.mirrors
  const candidates =
    Array.isArray(explicit) && explicit.length > 0
      ? explicit.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      : discoverHarnessHomes(userDataPath, env).map((h) => h.path)
  for (const candidate of candidates) {
    let absolute: string
    try {
      absolute = resolve(candidate)
    } catch {
      continue
    }
    const key = pathKey(absolute)
    if (seen.has(key)) continue
    seen.add(key)
    mirrors.push(absolute)
  }
  return { primary, mirrors }
}

/** Safety guard: never migrate INTO a drive root or the user home itself. */
function isSafeTarget(target: string): boolean {
  if (target === homedir()) return false
  return !/^[A-Za-z]:[\\/]?$/u.test(target) && target !== sep
}

/**
 * Copy an existing harness home into a target home (used to adopt a
 * third-party/official dir or restore a vanished one). Never overwrites an
 * existing target; caller removes/merges explicitly when needed.
 * @returns whether a copy was performed.
 */
export function importHarnessHome(
  source: string,
  target: string,
): { ok: boolean; copied: boolean; error?: string } {
  if (!existsSync(source) || !existsSync(join(source, 'profiles'))) {
    return { ok: false, copied: false, error: `source is not a harness home: ${source}` }
  }
  if (!isSafeTarget(target)) {
    return { ok: false, copied: false, error: `unsafe migration target: ${target}` }
  }
  if (existsSync(join(target, 'profiles', 'web', 'package.json'))) {
    return { ok: false, copied: false, error: `target already has a web profile: ${target}` }
  }
  try {
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true })
    return { ok: true, copied: true }
  } catch (error) {
    return { ok: false, copied: false, error: String(error) }
  }
}
