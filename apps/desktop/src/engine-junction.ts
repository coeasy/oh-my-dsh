import { lstatSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export interface JunctionResult {
  ok: boolean
  action: 'missing' | 'kept' | 'repaired' | 'skipped'
}

/**
 * Windows junction equality: readlinkSync returns the string the junction was
 * created with; the engine generates its targets with `path.join` (backslashes)
 * while our runtime paths may use either separator. Comparing a normalized form
 * avoids a false mismatch that would otherwise make the engine unlink+rebuild
 * the junction on every launch (and race other instances into EPERM).
 */
function normalizeWindowsPath(path: string): string {
  return String(path).replace(/\//g, '\\').replace(/\\+$/u, '').toLowerCase()
}

/**
 * Make sure the engine's own module junction (`@deepseek-ai/dsh` under the
 * profile's flat `node_modules`) points at the current runtime's CLI. A stale
 * or form-mismatched junction makes the engine's `ensureSymlink` rebuild it on
 * every boot — rebuilding the same junction from two instances is what throws
 * `EPERM: symlink` and kills the launch. We rebuild it once, synchronously,
 * before the engine spawns, so the engine short-circuits on first check.
 *
 * Best-effort and never fatal: any failure is logged and boot continues.
 */
export function normalizeEngineJunction(input: {
  dshHome: string
  runtimeDir: string
  log?: (message: string) => void
}): JunctionResult {
  const link = join(input.dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh')
  const target = join(input.runtimeDir, 'harness', 'apps', 'cli')
  const log = input.log ?? (() => {})
  try {
    let stat
    try {
      stat = lstatSync(link)
    } catch {
      stat = undefined
    }
    if (stat === undefined) {
      // First boot: the engine creates it. Nothing to do.
      return { ok: true, action: 'missing' }
    }
    if (!stat.isSymbolicLink()) {
      log(
        `engine-junction: ${link} exists but is not a junction; leaving it for the engine to handle`,
      )
      return { ok: true, action: 'skipped' }
    }
    const current = readlinkSync(link)
    if (normalizeWindowsPath(current) === normalizeWindowsPath(target)) {
      return { ok: true, action: 'kept' }
    }
    unlinkSync(link)
    symlinkSync(target, link, 'junction')
    log(`engine-junction: repaired ${link} → ${target}`)
    return { ok: true, action: 'repaired' }
  } catch (error) {
    log(`engine-junction: failed to normalize ${link}: ${String(error)}`)
    return { ok: false, action: 'skipped' }
  }
}
