import { normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

function isHarnessUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

function isPathInside(child: string, parent: string): boolean {
  const c = normalize(resolve(child))
  const p = normalize(resolve(parent))
  return c === p || c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`)
}

export function isTrustedAppUrl(rawUrl: string, trustedFileRoots: string[] = []): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'file:') {
      const filePath = fileURLToPath(url)
      return trustedFileRoots.some((root) => isPathInside(filePath, root))
    }
  } catch {
    return false
  }
  return isHarnessUrl(rawUrl)
}

export function canGrantWindowPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
): boolean {
  return (
    permission === 'clipboard-sanitized-write' &&
    isMainFrame &&
    requestingUrl !== undefined &&
    isHarnessUrl(requestingUrl)
  )
}
