import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

/** True if `child` is `parent` or a file/dir under it after normalize. */
export function isPathInside(child: string, parent: string): boolean {
  const c = normalize(resolve(child))
  const p = normalize(resolve(parent))
  const ci = process.platform === 'win32' ? c.toLowerCase() : c
  const pi = process.platform === 'win32' ? p.toLowerCase() : p
  if (ci === pi) return true
  const prefix = pi.endsWith(sep) ? pi : pi + sep
  return ci.startsWith(prefix)
}

export function assertAbsolutePluginPath(pluginAbsPath: string): string {
  const raw = String(pluginAbsPath || '').trim()
  if (!raw) throw new Error('embedded-client patch: plugin path is empty')
  if (raw.startsWith('@') || /^(?:[a-z0-9][a-z0-9._-]*)\/[a-z0-9._-]+$/i.test(raw)) {
    throw new Error(`embedded-client patch: refusing npm package name ${raw}`)
  }
  if (!isAbsolute(raw)) {
    throw new Error(`embedded-client patch: plugin path must be absolute, got ${raw}`)
  }
  return raw
}

/**
 * Ready files are IPC between the Cordis plugin and the outer runtime.
 * Only absolute paths under os.tmpdir() (or explicit allow roots) are accepted.
 */
export function assertSafeReadyPath(readyPath: string, allowRoots: string[] = [tmpdir()]): string {
  const raw = String(readyPath || '').trim()
  if (!raw) throw new Error('ready path is empty')
  if (raw.includes('\0') || /[\r\n]/.test(raw)) {
    throw new Error('ready path contains illegal characters')
  }
  if (!isAbsolute(raw)) {
    throw new Error(`ready path must be absolute: ${raw}`)
  }
  const resolved = resolve(raw)
  const ok = allowRoots.some((root) => isPathInside(resolved, root))
  if (!ok) {
    throw new Error(`ready path escapes allowed roots: ${resolved}`)
  }
  return resolved
}
