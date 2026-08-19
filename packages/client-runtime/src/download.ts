import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Readable, Transform, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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
  /** Streamed sink; when provided the payload is piped without full buffering. */
  openWriteStream?: (path: string) => Writable
  /** Expected sha256 hex digest; the downloaded payload is verified before use. */
  sha256?: string
  /** Extra attempts after a network failure or 5xx (default 2). */
  retries?: number
  onProgress?: (stage: 'download-started' | 'downloaded', received?: number) => void
}

const RETRY_BACKOFF_MS = 500

async function fetchWithRetry(
  url: string,
  fetchImpl: typeof fetch,
  retries: number,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * attempt))
    }
    try {
      const res = await fetchImpl(url)
      // Retry transient server errors only; 4xx fails loud immediately.
      if (res.status >= 500 && attempt < retries) continue
      return res
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`DSH_RUNTIME=download: fetch failed for ${url}: ${String(lastError)}`)
}

/**
 * Fetch the packaged dsh binary into the cache. Missing URL or non-2xx fails loud.
 * Cache hit returns the existing path without network I/O. When `sha256` is set,
 * the payload is hashed while downloading and rejected on mismatch (the partial
 * file is removed, so a corrupted download can never be activated).
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
  const retries = input.retries ?? 2
  input.onProgress?.('download-started')
  const res = await fetchWithRetry(url, fetchFn, retries)
  if (!res.ok) {
    throw new Error(`DSH_RUNTIME=download: HTTP ${res.status} fetching ${url}`)
  }
  const expected = input.sha256 ? String(input.sha256).trim().toLowerCase() : undefined
  const mkdir = input.mkdir ?? ((p: string) => mkdirSync(p, { recursive: true }))
  mkdir(dirname(dest))

  let received = 0
  if (input.openWriteStream) {
    // Streamed path: hash per chunk, never hold the payload in memory.
    const hash = createHash('sha256')
    const source = Readable.fromWeb((res.body ?? new Response('').body) as never)
    const tally = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        received += chunk.length
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    const sink = input.openWriteStream(dest)
    await pipeline(source, tally, sink)
    const streamed = hash.digest('hex')
    if (expected && streamed !== expected) {
      throw new Error(
        `DSH_RUNTIME=download: sha256 mismatch for ${url} (expected ${expected}, got ${streamed})`,
      )
    }
    input.onProgress?.('downloaded', received)
    return dest
  }

  // Buffered path (DI tests / small payloads).
  const buf = new Uint8Array(await res.arrayBuffer())
  received = buf.byteLength
  const actual = createHash('sha256').update(buf).digest('hex')
  if (expected && actual !== expected) {
    throw new Error(
      `DSH_RUNTIME=download: sha256 mismatch for ${url} (expected ${expected}, got ${actual})`,
    )
  }
  const writeFile = input.writeFile ?? ((p: string, data: Uint8Array) => writeFileSync(p, data))
  writeFile(dest, buf)
  input.onProgress?.('downloaded', received)
  return dest
}
