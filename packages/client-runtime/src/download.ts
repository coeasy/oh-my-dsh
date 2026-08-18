import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cachedBinaryPath } from './resolve-runtime.ts'
import { isPathInside } from './paths.ts'

export function assertHttpsDownloadUrl(url: string): string {
  const raw = String(url || '').trim()
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`DSH_RUNTIME=download: invalid DSH_RUNTIME_URL: ${raw}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`DSH_RUNTIME=download: refusing non-https URL: ${raw}`)
  }
  return raw
}

export interface DownloadRuntimeInput {
  url: string
  cacheDir: string
  fetchImpl?: typeof fetch
  exists?: (path: string) => boolean
  writeFile?: (path: string, data: Uint8Array) => void
  mkdir?: (path: string) => void
}

/**
 * Fetch the packaged dsh binary into the cache. Missing URL or non-2xx fails loud.
 * Cache hit returns the existing path without network I/O.
 */
export async function ensureDownloadedRuntime(input: DownloadRuntimeInput): Promise<string> {
  const cacheRoot = resolve(input.cacheDir)
  const dest = cachedBinaryPath(cacheRoot)
  if (!isPathInside(dest, cacheRoot)) {
    throw new Error(`DSH_RUNTIME=download: cache dest escapes cacheDir: ${dest}`)
  }
  const exists = input.exists ?? existsSync
  if (exists(dest)) return dest
  const url = String(input.url || '').trim()
  if (!url) {
    throw new Error(`DSH_RUNTIME=download: cache miss at ${dest} and DSH_RUNTIME_URL is unset`)
  }
  assertHttpsDownloadUrl(url)
  const fetchFn = input.fetchImpl ?? fetch
  const res = await fetchFn(url)
  if (!res.ok) {
    throw new Error(`DSH_RUNTIME=download: HTTP ${res.status} fetching ${url}`)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  const mkdir = input.mkdir ?? ((p: string) => mkdirSync(p, { recursive: true }))
  mkdir(dirname(dest))
  const writeFile = input.writeFile ?? ((p: string, data: Uint8Array) => writeFileSync(p, data))
  writeFile(dest, buf)
  return dest
}
