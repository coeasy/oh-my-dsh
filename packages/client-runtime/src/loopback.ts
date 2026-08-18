/** First-period shells load only the loopback SPA. Never accept LAN / public binds. */

export function assertLoopbackUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`invalid host url: ${url}`)
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(`refusing non-http url: ${url}`)
  }
  if (parsed.hostname !== '127.0.0.1') {
    throw new Error(`refusing non-loopback URL: ${url}`)
  }
  if (!parsed.port) {
    throw new Error(`refusing url without port: ${url}`)
  }
  return url
}

export function isLoopbackHttpUrl(url: string): boolean {
  try {
    assertLoopbackUrl(url)
    return true
  } catch {
    return false
  }
}
