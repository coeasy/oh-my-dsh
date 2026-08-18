import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

function isPathInside(child: string, parent: string): boolean {
  const c = normalize(resolve(child))
  const p = normalize(resolve(parent))
  const ci = process.platform === 'win32' ? c.toLowerCase() : c
  const pi = process.platform === 'win32' ? p.toLowerCase() : p
  if (ci === pi) return true
  const prefix = pi.endsWith(sep) ? pi : pi + sep
  return ci.startsWith(prefix)
}

/** Plugin-side copy — this bundle must not import @dsh/client-runtime. */
export function assertSafeReadyPath(readyPath: string, allowRoots: string[] = [tmpdir()]): string {
  const raw = String(readyPath || '').trim()
  if (!raw) throw new Error('embedded-client: ready path is empty')
  if (raw.includes('\0') || /[\r\n]/.test(raw)) {
    throw new Error('embedded-client: ready path contains illegal characters')
  }
  if (!isAbsolute(raw)) {
    throw new Error(`embedded-client: ready path must be absolute: ${raw}`)
  }
  const resolved = resolve(raw)
  const ok = allowRoots.some((root) => isPathInside(resolved, root))
  if (!ok) {
    throw new Error(`embedded-client: ready path escapes tmpdir: ${resolved}`)
  }
  return resolved
}
