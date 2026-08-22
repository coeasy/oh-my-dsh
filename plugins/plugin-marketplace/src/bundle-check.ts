/**
 * Post-install bundle entry validation (anti-brick): after the official CLI
 * registers a plugin as a profile layer, we syntax-check the actual module the
 * engine will import — BEFORE the user restarts. A plugin whose entry cannot
 * even parse would otherwise fail the WHOLE engine boot (the engine is
 * fail-loud / all-or-nothing), taking every other plugin down with it.
 *
 * The check is read-only and never executes the plugin's code: it resolves the
 * package directory the same way the engine loader would, reads its manifest,
 * and runs `node --check` (parse-only) on the entry module. On failure the
 * caller rolls the install back through the official CLI.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { nodeExecutable } from './install.ts'

/** Parse-only syntax check of one module via `node --check` (never executes). */
function syntaxCheck(path: string): string | null {
  const check = spawnSync(
    nodeExecutable(),
    ['--check', path],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000, env: { ...process.env, CI: 'true' } },
  )
  if (check.status === 0) return null
  const err = check.stderr || check.stdout
  return `${err}`.slice(0, 600) || `syntax check failed for ${path}`
}

export interface BundleCheckResult {
  ok: boolean
  packageName: string
  entry: string | null
  errors: string[]
}

/**
 * Validate an installed profile bundle's loadability WITHOUT executing it.
 * @param profileDir - the profile directory (node_modules anchor).
 * @param packageName - the bundle's package name.
 * @returns ok + any errors found (missing manifest, missing dsh.bundle,
 * missing patch, unresolvable or syntactically invalid entry module).
 */
export function validateInstalledBundle(
  profileDir: string,
  packageName: string,
): BundleCheckResult {
  const errors: string[] = []
  let entry: string | null = null
  try {
    const require = createRequire(join(profileDir, 'package.json'))
    const manifestPath = require.resolve(`${packageName}/package.json`)
    const packageDir = join(manifestPath, '..')
    if (!existsSync(manifestPath)) {
      errors.push(`bundle ${packageName}: package.json not found`)
      return { ok: false, packageName, entry, errors }
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string
      main?: string
      exports?: unknown
      dsh?: { bundle?: { patch?: string } }
    }
    if (!manifest.dsh?.bundle?.patch) {
      errors.push(`bundle ${packageName}: package.json does not declare dsh.bundle.patch`)
      return { ok: false, packageName, entry, errors }
    }
    const patchPath = join(packageDir, manifest.dsh.bundle.patch)
    if (!existsSync(patchPath)) {
      errors.push(`bundle ${packageName}: declared patch ${manifest.dsh.bundle.patch} is missing`)
    }
    // Resolve the entry module exactly as the loader would (main/exports ".").
    let entryPath: string | null = null
    try {
      entryPath = require.resolve(packageName)
    } catch {
      errors.push(`bundle ${packageName}: entry module cannot be resolved`)
    }
    if (entryPath) {
      entry = entryPath
      const syntaxError = syntaxCheck(entryPath)
      if (syntaxError) errors.push(`bundle ${packageName}: ${syntaxError}`)
    }
  } catch (error) {
    errors.push(`bundle ${packageName}: ${String(error)}`)
  }
  return { ok: errors.length === 0, packageName, entry, errors }
}

/**
 * Validate a bundle by package name under a profile. Thin wrapper used by
 * callers that only have the resolved profile dir.
 */
export function validateProfileBundle(profileDir: string, packageName: string): BundleCheckResult {
  return validateInstalledBundle(profileDir, packageName)
}
