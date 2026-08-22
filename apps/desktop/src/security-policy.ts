import { pathToFileURL } from 'node:url'

function fileUrlForRoot(root: string): string {
  // A leading slash is a POSIX root even when this code runs on Windows.
  // Only drive-letter and UNC roots should use Windows URL rules.
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/u.test(root)) {
    return pathToFileURL(root, { windows: true }).href.replace(/\/$/, '')
  }
  return `file://${encodeURI(root.replaceAll('\\', '/'))}`.replace(/\/$/, '')
}

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
  const parent = fileUrlForRoot(trustedRoot)
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
