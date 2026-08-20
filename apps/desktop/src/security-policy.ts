import { pathToFileURL } from 'node:url'

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

function isTrustedFileUrl(rawUrl: URL, trustedRoot: string): boolean {
  const child = rawUrl.href
  const parent = pathToFileURL(trustedRoot).href.replace(/\/$/, '')
  return child === parent || child.startsWith(`${parent}/`)
}

export function isTrustedAppUrl(rawUrl: string, trustedFileRoots: string[] = []): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'file:') {
      return trustedFileRoots.some((root) => isTrustedFileUrl(url, root))
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
