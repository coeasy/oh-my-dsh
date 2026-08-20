import { pathToFileURL } from 'node:url'

function isTrustedOrigin(rawUrl: string, trustedOrigins: string[]): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' && trustedOrigins.includes(url.origin)
  } catch {
    return false
  }
}

function isTrustedFileUrl(rawUrl: URL, trustedRoot: string): boolean {
  const child = rawUrl.href
  const parent = pathToFileURL(trustedRoot).href.replace(/\/$/, '')
  return child === parent || child.startsWith(`${parent}/`)
}

export function isTrustedAppUrl(
  rawUrl: string,
  trustedFileRoots: string[] = [],
  trustedOrigins: string[] = [],
): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'file:') {
      return trustedFileRoots.some((root) => isTrustedFileUrl(url, root))
    }
  } catch {
    return false
  }
  return isTrustedOrigin(rawUrl, trustedOrigins)
}

export function canGrantWindowPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
  trustedOrigins: string[] = [],
): boolean {
  return (
    permission === 'clipboard-sanitized-write' &&
    isMainFrame &&
    requestingUrl !== undefined &&
    isTrustedOrigin(requestingUrl, trustedOrigins)
  )
}
