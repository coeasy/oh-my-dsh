import { pathToFileURL } from 'node:url'

function fileUrlForRoot(root: string): string {
  // A leading slash is a POSIX root even when this code is running on
  // Windows. Only drive-letter and UNC roots should use Windows URL rules.
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/u.test(root)) {
    return pathToFileURL(root, { windows: true }).href.replace(/\/$/, '')
  }
  return `file://${encodeURI(root.replaceAll('\\', '/'))}`.replace(/\/$/, '')
}

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
  const parent = fileUrlForRoot(trustedRoot)
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
