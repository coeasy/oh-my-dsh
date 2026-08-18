/**
 * Engine auto-updater (Phase 3.2).
 *
 * The desktop ships a bundled engine in resources/runtime. This module lets the
 * client fetch a newer engine payload into a versioned cache, verify its
 * checksum, activate it for the next launch, and roll back to the previously
 * usable engine when an update is unusable.
 *
 * All functions are pure / dependency-injected so they run under `node --test`
 * without network or a real engine.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface EngineUpdateManifest {
  version: string
  checksum: string
  url: string
}

/** Latest-release lookup from a GitHub API response (focused, defensive). */
export function parseLatestRelease(
  raw: string | undefined,
): { ref: string; htmlUrl: string } | undefined {
  if (!raw) return undefined
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof body !== 'object' || body === null) return undefined
  const tagName = (body as { tag_name?: unknown }).tag_name
  const htmlUrl = (body as { html_url?: unknown }).html_url
  if (typeof tagName !== 'string' || !tagName) return undefined
  return { ref: tagName, htmlUrl: typeof htmlUrl === 'string' ? htmlUrl : '' }
}

/** Parse a one-line `version sha256 url` manifest line. */
export function parseEngineUpdateManifest(line: string): EngineUpdateManifest | undefined {
  const parts = String(line || '')
    .trim()
    .split(/\s+/u)
  if (parts.length < 3) return undefined
  const [version, checksum, url] = parts
  if (!/^[0-9a-f]{64}$/u.test(checksum)) return undefined
  if (!/^https:/u.test(url)) return undefined
  return { version, checksum, url }
}

/** Versioned cache dir for a given engine ref/version. */
export function engineVersionDir(cacheRoot: string, version: string): string {
  return resolve(join(cacheRoot, version))
}

/** True when a cached engine dir has the expected relocatable entry point. */
export function isUsableEngineDir(dir: string, exists = existsSync): boolean {
  return (
    exists(join(dir, 'harness', 'apps', 'cli', 'lib', 'bin.js')) && exists(join(dir, 'origin.json'))
  )
}

/** Compare two refs (v-prefixed dotted versions). Higher wins. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '')
    .replace(/^v/u, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b || '')
    .replace(/^v/u, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/**
 * Pick the highest usable versioned engine dir in the cache, or undefined.
 * This is the activation candidate: launchHost prefers it over the bundled engine.
 */
export function resolveActiveEngineDir(
  cacheRoot: string,
  currentBundledVersion: string,
  exists = existsSync,
  readdir = readdirSync,
): { dir: string; version: string } | undefined {
  let entries: string[]
  try {
    entries = readdir(cacheRoot)
  } catch {
    return undefined
  }
  let best: { dir: string; version: string } | undefined
  for (const entry of entries) {
    if (!/^\d+(?:\.\d+)*$/u.test(entry)) continue
    const dir = engineVersionDir(cacheRoot, entry)
    if (!isUsableEngineDir(dir, exists)) continue
    if (compareVersions(entry, currentBundledVersion) <= 0) continue
    if (!best || compareVersions(entry, best.version) > 0) best = { dir, version: entry }
  }
  return best
}

/** sha256 hex of a file. */
export function sha256Hex(filePath: string, readFile = readFileSync): string {
  const data = readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Download the engine payload zip into a versioned dir and verify its checksum.
 * Returns the target dir. Throws on checksum mismatch or non-2xx.
 */
export async function downloadEnginePayload(input: {
  cacheRoot: string
  version: string
  url: string
  checksum: string
  fetchImpl?: typeof fetch
  mkdir?: (dir: string) => void
  writeFile?: (path: string, data: Uint8Array) => void
}): Promise<string> {
  const dir = engineVersionDir(input.cacheRoot, input.version)
  const zipPath = join(dir, 'engine.zip')
  const mkdir = input.mkdir ?? ((p: string) => mkdirSync(p, { recursive: true }))
  mkdir(dirname(zipPath))
  const fetchFn = input.fetchImpl ?? fetch
  const res = await fetchFn(input.url)
  if (!res.ok) throw new Error(`engine-updater: HTTP ${res.status} fetching ${input.url}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  const writeFile = input.writeFile ?? ((p: string, d: Uint8Array) => writeFileSync(p, d))
  writeFile(zipPath, buf)
  const actual = sha256Hex(zipPath)
  if (actual !== input.checksum) {
    throw new Error(
      `engine-updater: checksum mismatch for ${input.version} (expected ${input.checksum}, got ${actual})`,
    )
  }
  return dir
}

/**
 * Find the highest usable engine strictly below `activeVersion` for rollback.
 * Returns its dir, or undefined when there is no older usable engine.
 */
export function rollbackCandidate(
  cacheRoot: string,
  activeVersion: string,
  exists = existsSync,
  readdir = readdirSync,
): string | undefined {
  let entries: string[]
  try {
    entries = readdir(cacheRoot)
  } catch {
    return undefined
  }
  let rollback: { dir: string; version: string } | undefined
  for (const entry of entries) {
    if (!/^\d+(?:\.\d+)*$/u.test(entry)) continue
    if (compareVersions(entry, activeVersion) >= 0) continue
    const dir = engineVersionDir(cacheRoot, entry)
    if (!isUsableEngineDir(dir, exists)) continue
    if (!rollback || compareVersions(entry, rollback.version) > 0)
      rollback = { dir, version: entry }
  }
  return rollback?.dir
}
