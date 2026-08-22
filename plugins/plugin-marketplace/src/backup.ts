/**
 * Backup / restore of the installed plugin set (P-C).
 *
 * The backup is a faithful, official-only view: it reads the SAME profile
 * manifest the dsh CLI reconciles (`<profile>/package.json` →
 * `dependencies` + `dsh.profile.bundles`), so exporting needs no private
 * state. Restoring re-invokes the official `dsh plugin add` per package,
 * keeping pnpm dependency tracking and the bundles reconcile authoritative.
 *
 * Exporting never touches the CLI; importing is idempotent (pnpm add on an
 * already-installed package is a no-op update) and reports per-package
 * success/failure.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { profileDirOf } from './registry.ts'
import { isNpmSpec, runOfficialAdd } from './install.ts'

export const BACKUP_FORMAT = 'coeasy-market-backup'
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  profile: string
  /** Top-level plugin dependencies (installed package names). */
  dependencies: string[]
  /** Profile bundle-layer entries (what the CLI reconciled). */
  bundles: string[]
  /** Human-facing summary. */
  summary: string
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: unknown } }
}

function readManifest(profile: string, home?: string): ProfileManifest {
  const p = join(profileDirOf(profile, home), 'package.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as ProfileManifest
  } catch {
    return {}
  }
}

/** Snapshot the currently-installed official state into a portable backup. */
export function buildBackup(profile: string, home?: string): BackupFile {
  const manifest = readManifest(profile, home)
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
    ? (manifest.dsh?.profile?.bundles as unknown[]).filter(
        (n): n is string => typeof n === 'string',
      )
    : []
  const profileDir = profileDirOf(profile, home)
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    dependencies,
    bundles,
    summary: `profile ${profile} · ${dependencies.length} 依赖 / deps · ${bundles.length} bundles · ${profileDir}`,
  }
}

export interface RestoreResult {
  ok: boolean
  restored: string[]
  failed: Array<{ pkg: string; error: string }>
  skipped: string[]
}

/**
 * Restore a backup by re-running the official `dsh plugin add` for each
 * dependency. Bundles are re-derived by the CLI reconcile automatically, so
 * only the dependency list needs re-adding.
 * @param restorePlugins - only restore packages that look like plugins
 * (bundles or non-core deps); pass [] to restore every dependency.
 */
export async function restoreBackup(
  profile: string,
  backup: Pick<BackupFile, 'dependencies' | 'bundles'>,
  home?: string,
): Promise<RestoreResult> {
  const result: RestoreResult = { ok: true, restored: [], failed: [], skipped: [] }
  const rawDependencies = Array.isArray(backup.dependencies)
    ? (backup.dependencies as unknown[])
    : []
  const rawBundles = Array.isArray(backup.bundles) ? (backup.bundles as unknown[]) : []
  const dependencies = rawDependencies.filter(
    (pkg): pkg is string => typeof pkg === 'string' && isNpmSpec(pkg),
  )
  const bundles = rawBundles.filter(
    (pkg): pkg is string => typeof pkg === 'string' && isNpmSpec(pkg),
  )
  if (
    dependencies.length !== rawDependencies.length ||
    bundles.length !== rawBundles.length ||
    dependencies.length > 200 ||
    bundles.length > 200
  ) {
    result.ok = false
    result.failed.push({ pkg: '<backup>', error: 'invalid or oversized package list' })
    return result
  }
  // Restore in bundle-first order so reconcile sees bundle members before
  // their deps; deps already in bundles are skipped (already coming back).
  const bundleSet = new Set(bundles)
  const toRestore = [...bundles, ...dependencies]
  const seen = new Set<string>()
  for (const pkg of toRestore) {
    if (pkg === '' || seen.has(pkg)) continue
    seen.add(pkg)
    if (bundleSet.has(pkg) && !dependencies.includes(pkg)) {
      result.skipped.push(pkg)
      continue
    }
    try {
      // Self-healing official add: if pnpm left the dependency installed but
      // exited nonzero on unapproved build scripts, heal the build gate and
      // retry so the official reconcile registers the bundle.
      const { result: r, registered } = await runOfficialAdd(profile, pkg, { home })
      if (r.code === 0 && (registered || !isNpmSpec(pkg))) result.restored.push(pkg)
      else {
        result.failed.push({ pkg, error: `${r.stderr || r.stdout}`.slice(0, 400) })
        result.ok = false
      }
    } catch (e) {
      result.failed.push({ pkg, error: String(e).slice(0, 400) })
      result.ok = false
    }
  }
  return result
}
