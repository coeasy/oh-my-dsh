/**
 * Boot-safe plugin recovery: when a freshly installed plugin is broken (bad
 * JS, missing dependency, incompatible API), the engine fails to boot the
 * WHOLE profile tree — the desktop gets stuck in the launch-failure dialog.
 * This removes every non-core bundle from `dsh.profile.bundles` so the engine
 * boots on the base layers alone. Dependencies stay untouched: re-adding the
 * plugin through the marketplace (official CLI) re-registers its bundle.
 *
 * This is the one place the client edits the official profile manifest, and
 * only in response to an explicit user recovery action — never during normal
 * install flow (which stays fully official-CLI-owned).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Harness-shipped bundles that are never disabled by boot recovery. */
export const CORE_BUNDLES: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
])

export interface RecoveryResult {
  ok: boolean
  disabled: string[]
  error?: string
}

/**
 * Remove non-core bundles from a profile's `dsh.profile.bundles`, writing a
 * `.recovery.bak` copy of the previous manifest so the change is reversible.
 * @param dshHome - the harness home the desktop runs (userData/harness).
 * @param profile - profile name (default "web").
 * @returns the disabled bundle list (empty when nothing to disable).
 */
export function disableCommunityBundles(dshHome: string, profile = 'web'): RecoveryResult {
  return disableBundles(dshHome, profile, { all: true })
}

/**
 * Disable the NEWEST community bundle(s) only — the most likely culprit after
 * a fresh install. `count` defaults to 1. Used by automatic boot fusing so a
 * good plugin is never removed all at once: disable one, retry, disable the
 * next, … up to the caller's bound.
 */
export function disableNewestCommunityBundles(
  dshHome: string,
  profile = 'web',
  count = 1,
): RecoveryResult {
  return disableBundles(dshHome, profile, { count })
}

/**
 * Apply the newest-bundle fuse to MULTIPLE homes (primary + mirrors) so a
 * broken bundle can't take down another engine's home either. Each home
 * disables its OWN newest community bundle(s) — idempotent and safe when a
 * mirror never had the culprit (it simply has nothing to disable).
 */
export function disableNewestCommunityBundlesMany(
  homes: string[],
  profile = 'web',
  count = 1,
): { results: Array<RecoveryResult & { dshHome: string }> } {
  const results: Array<RecoveryResult & { dshHome: string }> = []
  const seen = new Set<string>()
  for (const dshHome of homes) {
    if (!dshHome || seen.has(dshHome.toLowerCase())) continue
    seen.add(dshHome.toLowerCase())
    results.push({ dshHome, ...disableNewestCommunityBundles(dshHome, profile, count) })
  }
  return { results }
}

function disableBundles(
  dshHome: string,
  profile: string,
  opts: { all?: boolean; count?: number },
): RecoveryResult {
  const dir = join(dshHome, 'profiles', profile)
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) {
    return { ok: false, disabled: [], error: `no profile manifest at ${manifestPath}` }
  }
  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    return { ok: false, disabled: [], error: `cannot read manifest: ${String(error)}` }
  }
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    return { ok: false, disabled: [], error: `manifest is not valid JSON: ${String(error)}` }
  }
  const dsh = (pkg.dsh ?? {}) as Record<string, unknown>
  const profileCfg = (dsh.profile ?? {}) as Record<string, unknown>
  const bundles = Array.isArray(profileCfg.bundles) ? (profileCfg.bundles as string[]) : []
  const community = bundles.filter((bundle) => !CORE_BUNDLES.has(bundle))
  if (community.length === 0) {
    return { ok: false, disabled: [], error: 'no community bundles to disable' }
  }
  // bundles array is appended in dependency order, so the LAST entries are the
  // newest installs — disable from the end.
  const toDisable = opts.all
    ? community
    : community.slice(Math.max(0, community.length - (opts.count ?? 1)))
  const disableSet = new Set(toDisable)
  const remaining = bundles.filter((bundle) => !disableSet.has(bundle))
  const next = {
    ...pkg,
    dsh: { ...dsh, profile: { ...profileCfg, bundles: remaining } },
  }
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${manifestPath}.recovery.bak`, raw)
    writeFileSync(manifestPath, `${JSON.stringify(next, undefined, 2)}\n`)
  } catch (error) {
    return { ok: false, disabled: [], error: `cannot write manifest: ${String(error)}` }
  }
  return { ok: true, disabled: toDisable }
}
