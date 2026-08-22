/**
 * Official-channel command runner: every install / remove / update goes
 * through the dsh CLI that launched this host — `dsh plugin --profile <name>
 * <pnpm args...>` — so pnpm dependency tracking and the official bundles
 * reconcile stay the single source of truth. No manual copying, no private
 * registration.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  dshHomeOf,
  isGithubRepo,
  isSafeProfileName,
  profileDirOf,
  readOfficialState,
} from './registry.ts'
import { installFileTypeAtomic } from './file-installer.ts'

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
// Heavy plugins (200+ transitive deps, slow mirrors) routinely need minutes
// to link; 120s made real installs time out mid-way. 300s keeps the official
// CLI (whose own pnpm may take a while on first resolve) inside the window.
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000
/** pnpm ≥10/11 writes `set this to true or false` when a dependency has
 * unapproved build scripts; that exact placeholder is what the official CLI
 * asks the user to edit. */
const PNPM_BUILD_GATE_PLACEHOLDER = 'set this to true or false'

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
  const localappdata = process.env.LOCALAPPDATA
  const dirs = new Set<string>()
  if (appdata) dirs.add(join(appdata, 'npm'))
  // pnpm's own Windows installer (iwr get.pnpm.io/install.ps1) puts the binary
  // in %LOCALAPPDATA%\pnpm — missing this made installs fail with ENOENT/127
  // for users who did NOT install pnpm through npm/corepack.
  if (localappdata) dirs.add(join(localappdata, 'pnpm'))
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

/**
 * Repair the profile's pnpm build gate: pnpm 10/11 writes placeholder values
 * (`set this to true or false`) into `allowBuilds` when it hits dependencies
 * with unapproved native build scripts, then exits NONZERO — AFTER already
 * writing the new dependency into package.json. Because the official CLI only
 * reconciles `dsh.profile.bundles` on exit 0, such a plugin is left installed
 * as a dependency but never registered as a layer → `dsh web` won't load it
 * after a restart.
 *
 * This only replaces the placeholder lines pnpm itself wrote (never a value
 * the user set to true/false), defaulting unapproved builds to `false`
 * (pnpm's own default is to skip them). Registration still happens through
 * the official CLI reconcile on the retry — no manual manifest edits here.
 * @returns the workspace.yaml path and whether any placeholder was replaced.
 */
export function healPnpmBuildGate(profileDir: string): { changed: boolean; path: string } {
  const path = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(path)) return { changed: false, path }
  const raw = readFileSync(path, 'utf8')
  // Only the exact placeholder pnpm emits; user-edited true/false stays put.
  const placeholder = new RegExp(
    `(:\\s*)${PNPM_BUILD_GATE_PLACEHOLDER.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`,
    'g',
  )
  if (!placeholder.test(raw)) return { changed: false, path }
  writeFileSync(path, raw.replace(placeholder, '$1false'))
  return { changed: true, path }
}

/**
 * One self-healing official install: run `dsh plugin add`, and when pnpm
 * reported a failure AFTER the dependency landed (the unapproved-builds case),
 * heal the build gate and retry exactly once. The retry lets the official
 * reconcile register the bundle, so the plugin actually loads after restart.
 * @returns the effective result, whether the dependency is now registered as
 * a profile layer (`dsh.profile.bundles`), and whether the gate was healed.
 */
export async function runOfficialAdd(
  profile: string,
  spec: string,
  opts: { home?: string; deps?: string[] } = {},
): Promise<{ result: RunResult; registered: boolean; healed: boolean }> {
  const first = await runPluginCommand(profile, ['add', spec], {
    home: opts.home,
    timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
  })
  let result = first
  let healed = false
  if (result.code !== 0) {
    // Dependency present despite the nonzero exit → partial install. The most
    // common cause is ERR_PNPM_IGNORED_BUILDS; heal and let the official CLI
    // finish + reconcile.
    const landed = (opts.deps ?? readOfficialState(profile, opts.home).dependencies).includes(spec)
    if (landed) {
      const healedInfo = healPnpmBuildGate(profileDirOf(profile, opts.home))
      healed = healedInfo.changed
      if (healed) {
        const retry = await runPluginCommand(profile, ['add', spec], {
          home: opts.home,
          timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
        })
        result = {
          code: retry.code,
          stdout: `${first.stdout}\n[allowBuilds gate healed → retry]\n${retry.stdout}`,
          stderr: `${first.stderr}\n${retry.stderr}`,
        }
      }
    }
  }
  const registered = readOfficialState(profile, opts.home).bundles.includes(spec)
  return { result, registered, healed }
}

/* ---------- Multi-home sync (primary + mirrors) ----------
 * The engine runs ONE home; the desktop client injects the rest of the
 * plugin-homes matrix via DSH_MARKET_MIRRORS (a JSON array of absolute home
 * paths, primary excluded) at engine launch. Every mutating marketplace
 * action is REPLAYED against each mirror through the same official CLI (with
 * `home` → DSH_HOME), so a plugin installed from the market lands in every
 * harness home the user cares about. All replays are idempotent: add/update
 * converge to the primary's spec, remove tolerates a mirror that never had
 * the package, toggle is a manifest write. */

/** Canonical lowercase key for a path, for dedup across separators. */
function homeKey(path: string): string {
  return resolve(path)
    .toLowerCase()
    .replace(/[\\/]+$/u, '')
}

/**
 * Parse DSH_MARKET_MIRRORS (a JSON array of absolute home paths injected by
 * the desktop client at engine launch) into mirror home paths. The primary
 * home (engine's own) is never a mirror — dropped defensively even if the
 * client failed to exclude it.
 */
export function mirrorHomes(primary?: string): string[] {
  const raw = process.env.DSH_MARKET_MIRRORS
  if (raw === undefined || raw.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const primaryKey = primary ? homeKey(primary) : ''
  const seen = new Set<string>()
  const mirrors: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'string' || item.trim() === '') continue
    let path: string
    try {
      path = resolve(item.trim())
    } catch {
      continue
    }
    const key = homeKey(path)
    if (key === primaryKey || seen.has(key)) continue
    seen.add(key)
    mirrors.push(path)
  }
  return mirrors
}

/**
 * Write a `disabled` toggle for one bundle id into a home's cordis.patch.yml.
 * Refuses to touch a patch that contains any user-edited (non-empty,
 * non-comment) content other than our own toggle lines — protecting manual
 * edits (plan §4.4 read-only guard). Same semantics as the primary-home
 * toggle in index.ts, generalized to any home for mirror replay.
 */
export function writePatchToggle(
  profile: string,
  home: string | undefined,
  bundleId: string,
  disabled: boolean,
): { ok: boolean; error?: string } {
  const path = join(profileDirOf(profile, home), 'cordis.patch.yml')
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const headerLines: string[] = []
  let body = ''
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      headerLines.push(line)
      continue
    }
    body += `${line}\n`
  }
  // `[ \t]*` (not `\s*`) after the id so the optional `disabled:` line below
  // is NOT eaten by a newline-swallowing match — otherwise a second toggle of
  // the same bundle leaves `disabled:` residual and gets refused.
  const own = new RegExp(
    `-\\s*id:\\s*${bundleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \t]*(?:\\r?\\n[ \t]*disabled:[ \t]*\\w+)?`,
    'g',
  )
  const residual = body.replace(own, '').trim()
  if (residual !== '' && residual !== '[]') {
    return { ok: false, error: 'patch 文件包含手工条目，镜像同步已跳过（只读保护）' }
  }
  const header = headerLines.join('\n') + (headerLines.length ? '\n' : '')
  try {
    writeFileSync(path, `${header}- id: ${bundleId}\n  disabled: ${disabled}\n`)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `写入失败: ${String(error)}` }
  }
}

export interface MirrorAction {
  path: string
  ok: boolean
  action: 'add' | 'remove' | 'toggle' | 'skill' | 'preset'
  registered?: boolean
  healed?: boolean
  error?: string
}

export interface SyncToMirrorsOptions {
  action: 'add' | 'remove' | 'toggle' | 'skill' | 'preset'
  profile: string
  /** npm/github spec — add/remove. */
  spec?: string
  /** repository full name — skill/preset. */
  fullName?: string
  /** bundle id — toggle. */
  bundleId?: string
  disabled?: boolean
  /** The primary home (engine's own); skipped defensively as a mirror. */
  primary?: string
}

/**
 * Replay one mutating marketplace action against every mirror home, using the
 * official CLI (idempotent). Returns per-mirror outcomes; a mirror failure
 * never fails the primary install (the caller surfaces it in the response).
 */
export async function syncToMirrors(
  opts: SyncToMirrorsOptions,
): Promise<{ mirrors: MirrorAction[] }> {
  const mirrors = mirrorHomes(opts.primary)
  const results: MirrorAction[] = []
  for (const path of mirrors) {
    let outcome: MirrorAction
    if (opts.action === 'toggle') {
      const toggle = writePatchToggle(
        opts.profile,
        path,
        opts.bundleId ?? '',
        opts.disabled === true,
      )
      outcome = {
        path,
        ok: toggle.ok,
        action: 'toggle',
        error: toggle.ok ? undefined : toggle.error,
      }
    } else if (opts.action === 'skill' || opts.action === 'preset') {
      const result = await installFileTypeAtomic(opts.action, opts.fullName ?? '', path)
      outcome = {
        path,
        ok: result.code === 0,
        action: opts.action,
        error: result.code === 0 ? undefined : `${result.stdout}${result.stderr}`.slice(-400),
      }
    } else if (opts.action === 'remove') {
      const result = await runPluginCommand(opts.profile, ['remove', opts.spec ?? ''], {
        home: path,
      })
      // pnpm remove on a package the mirror never had is a benign no-op; treat
      // the mirror as converged when the package is gone from its manifest.
      const state = readOfficialState(opts.profile, path)
      const gone = !state.dependencies.includes(opts.spec ?? '')
      outcome = {
        path,
        ok: result.code === 0 || gone,
        action: 'remove',
        error:
          result.code === 0 || gone ? undefined : `${result.stdout}${result.stderr}`.slice(-400),
      }
    } else {
      // A mirror directory may not exist yet (official home, fresh machine) —
      // ensure the profile dir so the official CLI can create the manifest.
      try {
        mkdirSync(profileDirOf(opts.profile, path), { recursive: true })
      } catch {
        /* best-effort; the CLI reports a real failure below */
      }
      const { result, registered, healed } = await runOfficialAdd(opts.profile, opts.spec ?? '', {
        home: path,
      })
      outcome = {
        path,
        ok: result.code === 0 && registered,
        action: 'add',
        registered,
        healed,
        error: result.code === 0 ? undefined : `${result.stdout}${result.stderr}`.slice(-400),
      }
    }
    results.push(outcome)
  }
  return { mirrors: results }
}

/**
 * Read the primary's FULL dependency map (name → spec, e.g. `name:
 * "^0.2.0"` or `"file:D:/..."`) so lazy repair can re-add each package with
 * its ORIGINAL spec — a bare `pnpm add name` would go to the npm registry and
 * fail for file:/github:/link: dependencies.
 */
function readOfficialDependencySpecs(profile: string, home?: string): Record<string, string> {
  const manifest = join(profileDirOf(profile, home), 'package.json')
  if (!existsSync(manifest)) return {}
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    return { ...(pkg.dependencies ?? {}) }
  } catch {
    return {}
  }
}

/** Build a pnpm-addable install spec from a dependency name + declared spec. */
export function dependencyInstallSpec(name: string, spec: string): string {
  const trimmed = String(spec ?? '').trim()
  if (trimmed.startsWith('file:') || trimmed.startsWith('github:') || trimmed.startsWith('link:')) {
    return trimmed
  }
  if (trimmed === '' || trimmed === 'latest' || trimmed === '*') return name
  return `${name}@${trimmed}`
}

/**
 * Serialize the lazy-repair entry so a launch-time sync and a manual UI sync
 * never hammer the same mirror with concurrent `pnpm add` (pnpm lockfile
 * contention). Only one syncAllMirrors runs at a time; a second caller gets
 * `skipped: true` instead of racing.
 */
let syncInFlight = false
export function isSyncInFlight(): boolean {
  return syncInFlight
}
export function withSyncGate<T>(
  fn: () => Promise<T>,
): Promise<{ skipped: true } | { skipped: false; value: T }> {
  if (syncInFlight) return Promise.resolve({ skipped: true })
  syncInFlight = true
  return fn()
    .then((value) => ({ skipped: false, value }))
    .finally(() => {
      syncInFlight = false
    })
}

export interface MirrorSyncSummary {
  path: string
  ok: boolean
  missing: string[]
  added: string[]
  /** Packages that existed but drifted to the primary's spec (version align). */
  updated: string[]
  error?: string
}

/**
 * Lazy repair: bring every mirror up to the primary's dependency set. Only
 * ADDS what the primary has and a mirror lacks — never removes anything a
 * mirror holds on its own (a mirror may be a richer legacy home). Idempotent:
 * already-present packages are no-ops. Used at launch and by the UI sync
 * button. Each package is re-added with its ORIGINAL spec (npm range,
 * file:/github:/link:) through the official CLI.
 */
/**
 * Deterministic re-add order: primary dependency order, so re-adds are stable
 * across runs (pnpm resolves in manifest order and the bundle order mirrors it).
 */
function orderedDeps(deps: Record<string, string>): string[] {
  return Object.keys(deps)
}

export async function syncAllMirrors(
  profile: string,
  opts: { primary?: string } = {},
): Promise<{ results: MirrorSyncSummary[]; skipped?: boolean }> {
  const primary = opts.primary ?? dshHomeOf()
  const primaryDeps = readOfficialDependencySpecs(profile, primary)
  const primaryState = readOfficialState(profile, primary)
  const results: MirrorSyncSummary[] = []
  for (const mirror of mirrorHomes(primary)) {
    const mirrorDeps = readOfficialDependencySpecs(profile, mirror)
    const mirrorState = readOfficialState(profile, mirror)
    const needs = orderedDeps(primaryDeps).filter((dep) => {
      if (!mirrorState.dependencies.includes(dep)) return true // missing → add
      // Real drift: mirror has the package but its resolved version does NOT
      // satisfy the primary's declared range. Re-add the primary's spec so
      // ranges/file:/github: converge (a fixed version inside the range is
      // already aligned and skipped — no pointless re-adds).
      const pspec = (primaryDeps[dep] ?? '').trim()
      const mspec = (mirrorDeps[dep] ?? '').trim()
      return pspec !== '' && mspec !== '' && !specsEquivalent(mspec, pspec)
    })
    const added: string[] = []
    const updated: string[] = []
    let error: string | undefined
    // Ensure the mirror's profile dir exists (official home on a fresh machine)
    // so the official CLI can create its manifest instead of failing.
    if (needs.length > 0) {
      try {
        mkdirSync(profileDirOf(profile, mirror), { recursive: true })
      } catch {
        /* best-effort; the CLI reports a real failure below */
      }
    }
    for (const dep of needs) {
      const installSpec = dependencyInstallSpec(dep, primaryDeps[dep] ?? '')
      const { result } = await runOfficialAdd(profile, installSpec, { home: mirror })
      // Convergence is judged by package NAME in the mirror manifest (the
      // official CLI may register the bundle under its real package name even
      // when the spec was a range / file: / github: alias).
      const after = readOfficialState(profile, mirror)
      if (result.code === 0 && after.dependencies.includes(dep)) {
        if (mirrorState.dependencies.includes(dep)) updated.push(dep)
        else added.push(dep)
      } else {
        error = `add ${installSpec} failed: ${`${result.stdout}${result.stderr}`.slice(-300)}`
        break
      }
    }
    results.push({
      path: mirror,
      ok: error === undefined,
      missing: primaryState.dependencies.filter((dep) => !mirrorState.dependencies.includes(dep)),
      added,
      updated,
      error,
    })
  }
  return { results }
}

/* ---------- spec equivalence (semver-lite) ----------
 * pnpm writes a RESOLVED fixed version into a mirror's manifest (e.g. `0.2.0`)
 * while the primary keeps the declared range (`^0.2.0`). Drift detection must
 * therefore compare SEMANTICS, not strings: a fixed version that satisfies the
 * primary's range is aligned; a fixed version outside the range is drifted.
 */

type Version = [number, number, number]

function parseVersion(s: string): Version | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(s.trim())
  if (!m) return null
  return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

function versionCmp(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

/** Minimal semver satisfies for ranges: exact, =, ^, ~, > < >= <=, `*`, `x`. */
export function semverSatisfies(version: string, range: string): boolean {
  const v = parseVersion(version)
  if (!v) return false
  const r = range.trim()
  if (r === '' || r === '*' || r === 'x') return true
  // AND-combination separated by spaces (e.g. `>=1.0.0 <2.0.0`).
  const parts = r.split(/\s+/).filter(Boolean)
  if (parts.length > 1) return parts.every((p) => semverSatisfies(version, p))
  if (r.startsWith('=')) {
    const exact = parseVersion(r.slice(1))
    return exact ? versionCmp(v, exact) === 0 : false
  }
  if (r.startsWith('^')) {
    const base = parseVersion(r.slice(1))
    if (!base) return false
    let upper: Version
    if (base[0] > 0) upper = [base[0] + 1, 0, 0]
    else if (base[1] > 0) upper = [0, base[1] + 1, 0]
    else upper = [0, 0, base[2] + 1]
    return versionCmp(v, base) >= 0 && versionCmp(v, upper) < 0
  }
  if (r.startsWith('~')) {
    const base = parseVersion(r.slice(1))
    if (!base) return false
    // ~1.5.0 → >=1.5.0 <1.6.0 (patch bumps to next minor); ~1.5 → <2.0.0.
    const hasPatch = /\d+\.\d+\.\d+/.test(r.slice(1).trim())
    const upper: Version = hasPatch ? [base[0], base[1] + 1, 0] : [base[0] + 1, 0, 0]
    return versionCmp(v, base) >= 0 && versionCmp(v, upper) < 0
  }
  const cmp = /^(>=|<=|>|<)\s*(\S+)$/.exec(r)
  if (cmp) {
    const base = parseVersion(cmp[2])
    if (!base) return false
    const c = versionCmp(v, base)
    if (cmp[1] === '>=') return c >= 0
    if (cmp[1] === '<=') return c <= 0
    if (cmp[1] === '>') return c > 0
    return c < 0
  }
  const wildcard = /^(\d+)(?:\.(\d+))?\.x$/.exec(r)
  if (wildcard) {
    const base: Version = [Number(wildcard[1]), Number(wildcard[2] ?? 0), 0]
    const upper: Version = [base[0] + 1, 0, 0]
    return versionCmp(v, base) >= 0 && versionCmp(v, upper) < 0
  }
  const exact = parseVersion(r)
  return exact ? versionCmp(v, exact) === 0 : false
}

/**
 * Whether two declared specs are semantically equivalent for sync purposes.
 * Non-semver specs (file:/github:/link:/workspace:) must match exactly; a
 * fixed version satisfying the other's range counts as equivalent (pnpm
 * normalizes ranges to resolved versions on mirror installs).
 */
export function specsEquivalent(a: string, b: string): boolean {
  const pa = String(a ?? '').trim()
  const pb = String(b ?? '').trim()
  if (pa === pb) return true
  if (
    /^(file:|github:|link:|workspace:)/u.test(pa) ||
    /^(file:|github:|link:|workspace:)/u.test(pb)
  ) {
    return false
  }
  const av = parseVersion(pa)
  const bv = parseVersion(pb)
  // Both fixed versions → only equal strings match (handled above), else false.
  if (av && !bv) return semverSatisfies(pa, pb)
  if (bv && !av) return semverSatisfies(pb, pa)
  return false
}

export interface HomeMatrixEntry {
  path: string
  role: 'primary' | 'mirror'
  dependencies: string[]
  bundles: string[]
  /**
   * in-sync: same set + same specs; missing: lacks primary deps (repairable);
   * drifted: has the dep but under a DIFFERENT spec than primary (alignable);
   * extra: has deps primary lacks (kept, never removed).
   */
  status: 'in-sync' | 'missing' | 'drifted' | 'extra'
  missing: string[]
  extra: string[]
  /** Packages present but with a spec different from the primary's. */
  drifted: string[]
}

/**
 * Compare every mirror against the primary's installed dependency set for the
 * diagnose / homes APIs. Read-only, no side effects. `missing` wins over
 * `drifted` (a truly absent package outranks a version mismatch), and both
 * outrank `extra` (which is intentional and never removed).
 */
export function homeMatrix(
  profile: string,
  opts: { primary?: string } = {},
): { primary: string; homes: HomeMatrixEntry[] } {
  const primary = opts.primary ?? dshHomeOf()
  const primaryDeps = readOfficialDependencySpecs(profile, primary)
  const primaryState = readOfficialState(profile, primary)
  const homes: HomeMatrixEntry[] = [
    {
      path: primary,
      role: 'primary',
      dependencies: primaryState.dependencies,
      bundles: primaryState.bundles,
      status: 'in-sync',
      missing: [],
      extra: [],
      drifted: [],
    },
  ]
  for (const mirror of mirrorHomes(primary)) {
    const state = readOfficialState(profile, mirror)
    const mirrorDeps = readOfficialDependencySpecs(profile, mirror)
    const missing = primaryState.dependencies.filter((dep) => !state.dependencies.includes(dep))
    const extra = state.dependencies.filter((dep) => !primaryState.dependencies.includes(dep))
    const drifted = state.dependencies.filter((dep) => {
      if (missing.includes(dep)) return false
      const pspec = (primaryDeps[dep] ?? '').trim()
      const mspec = (mirrorDeps[dep] ?? '').trim()
      // Semantics, not strings: a fixed mirror version inside the primary's
      // range (pnpm normalizes ranges on mirror installs) is ALIGNED.
      return pspec !== '' && mspec !== '' && !specsEquivalent(mspec, pspec)
    })
    const status =
      missing.length > 0
        ? 'missing'
        : drifted.length > 0
          ? 'drifted'
          : extra.length > 0
            ? 'extra'
            : 'in-sync'
    homes.push({
      path: mirror,
      role: 'mirror',
      dependencies: state.dependencies,
      bundles: state.bundles,
      status,
      missing,
      extra,
      drifted,
    })
  }
  return { primary, homes }
}
