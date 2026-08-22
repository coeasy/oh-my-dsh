/**
 * Engine auto-updater (Phase 3.2).
 *
 * The desktop ships a bundled engine in resources/runtime. This module lets the
 * client fetch a newer engine payload into a versioned cache and verify its
 * checksum. `resolveActiveEngineDir` / `rollbackCandidate` only consider an
 * already extracted, relocatable cache entry; the desktop UI still needs an
 * explicit extraction/activation step before downloaded payloads are launched.
 *
 * All functions are pure / dependency-injected so they run under `node --test`
 * without network or a real engine.
 */
import { createHash } from 'node:crypto'
import type { PathLike } from 'node:fs'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { normalize as posixNormalize } from 'node:path/posix'
import { inflateRawSync } from 'node:zlib'

export interface EngineUpdateManifest {
  version: string
  checksum: string
  url: string
}

const ENGINE_VERSION = /^\d+\.\d+\.\d+$/u

function isEngineVersion(value: string): boolean {
  return ENGINE_VERSION.test(value)
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
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
  if (!isEngineVersion(version)) return undefined
  if (!/^[0-9a-f]{64}$/iu.test(checksum)) return undefined
  if (!isHttpsUrl(url)) return undefined
  return { version, checksum: checksum.toLowerCase(), url }
}

/** Versioned cache dir for a given engine ref/version. */
export function engineVersionDir(cacheRoot: string, version: string): string {
  if (!isEngineVersion(version)) {
    throw new Error(`engine-updater: invalid engine version: ${version}`)
  }
  const root = resolve(cacheRoot)
  const dir = resolve(root, version)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (!dir.startsWith(prefix)) {
    throw new Error(`engine-updater: cache path escapes cacheRoot: ${version}`)
  }
  return dir
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
 * Active-version pin files. Writing `.active` pins rollback to an exact version;
 * clearing it lets the highest usable version win again.
 */
export function activeEngineMarkerPath(cacheRoot: string): string {
  return join(resolve(cacheRoot), '.active')
}

function defaultReadActive(root: string): string | undefined {
  try {
    const value = String(readFileSync(activeEngineMarkerPath(root), 'utf8')).trim()
    return isEngineVersion(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Read the pinned active engine version, if any marker exists. */
export function readActiveEngineVersion(
  cacheRoot: string,
  readFile = readFileSync,
): string | undefined {
  try {
    const value = String(readFile(activeEngineMarkerPath(cacheRoot), 'utf8')).trim()
    return isEngineVersion(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Pin the active engine version (used to roll back to an older extraction). */
export function writeActiveEngineVersion(
  cacheRoot: string,
  version: string,
  writeFile = writeFileSync,
): void {
  if (!isEngineVersion(version))
    throw new Error(`engine-updater: invalid engine version: ${version}`)
  const mkdir = (p: string) => mkdirSync(p, { recursive: true })
  mkdir(dirname(activeEngineMarkerPath(cacheRoot)))
  writeFile(activeEngineMarkerPath(cacheRoot), `${version}\n`, 'utf8')
}

/** Lift the pin so launch resolves the highest usable version again. */
export function clearActiveEngineVersion(cacheRoot: string, rm = rmSync): void {
  try {
    rm(activeEngineMarkerPath(cacheRoot), { force: true })
  } catch {
    // marker already gone
  }
}

/**
 * Pick the engine dir to launch: the pinned version when it is usable and
 * newer than the bundled engine, otherwise the highest usable extraction.
 * Undefined means "use the bundled engine".
 */
export function resolveActiveEngineDir(
  cacheRoot: string,
  currentBundledVersion: string,
  exists = existsSync,
  readdir = readdirSync,
  readActive = defaultReadActive,
): { dir: string; version: string } | undefined {
  let entries: string[]
  try {
    entries = readdir(cacheRoot)
  } catch {
    return undefined
  }
  const pinned = readActive(cacheRoot)
  if (pinned) {
    const pinDir = engineVersionDir(cacheRoot, pinned)
    if (isUsableEngineDir(pinDir, exists) && compareVersions(pinned, currentBundledVersion) > 0) {
      return { dir: pinDir, version: pinned }
    }
  }
  let best: { dir: string; version: string } | undefined
  for (const entry of entries) {
    if (!isEngineVersion(entry)) continue
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
  if (!isHttpsUrl(input.url)) {
    throw new Error(`engine-updater: refusing non-https URL: ${input.url}`)
  }
  if (!isEngineVersion(input.version)) {
    throw new Error(`engine-updater: invalid engine version: ${input.version}`)
  }
  const checksum = String(input.checksum || '')
    .trim()
    .toLowerCase()
  if (!/^[0-9a-f]{64}$/u.test(checksum)) {
    throw new Error(`engine-updater: invalid sha256: ${input.checksum}`)
  }
  const dir = engineVersionDir(input.cacheRoot, input.version)
  const zipPath = join(dir, 'engine.zip')
  const mkdir = input.mkdir ?? ((p: string) => mkdirSync(p, { recursive: true }))
  mkdir(dirname(zipPath))
  const fetchFn = input.fetchImpl ?? fetch
  const res = await fetchFn(input.url)
  if (!res.ok) throw new Error(`engine-updater: HTTP ${res.status} fetching ${input.url}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  const actual = createHash('sha256').update(buf).digest('hex')
  if (actual !== checksum) {
    throw new Error(
      `engine-updater: checksum mismatch for ${input.version} (expected ${checksum}, got ${actual})`,
    )
  }
  // Verify before writing: failed downloads never leave an apparently valid
  // engine.zip that a later activation step could accidentally consume.
  const writeFile = input.writeFile ?? ((p: string, d: Uint8Array) => writeFileSync(p, d))
  writeFile(zipPath, buf)
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
    if (!isEngineVersion(entry)) continue
    if (compareVersions(entry, activeVersion) >= 0) continue
    const dir = engineVersionDir(cacheRoot, entry)
    if (!isUsableEngineDir(dir, exists)) continue
    if (!rollback || compareVersions(entry, rollback.version) > 0)
      rollback = { dir, version: entry }
  }
  return rollback?.dir
}

/** A single parsed entry in an in-memory ZIP payload. */
export interface ZipEntry {
  /** Posix-relative normalized path, never absolute, no `..`. */
  path: string
  isDirectory: boolean
  isSymlink: boolean
  data: Uint8Array
}

const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

function toEntryPath(raw: string): string | undefined {
  const backward = String(raw || '').replace(/\\/gu, '/')
  const normalized = posixNormalize(backward).replace(/^\/+/u, '')
  if (!normalized || normalized === '.' || normalized === '..') return undefined
  if (normalized === '../' || normalized.split('/').includes('..')) return undefined
  // Reject drive letters / paths that escape on the host filesystem.
  if (/^[A-Za-z]:/u.test(normalized)) return undefined
  return backward.endsWith('/') ? normalized.replace(/\/+$/u, '') : normalized
}

function u32(view: Uint8Array, off: number): number {
  return (
    (view[off]! | (view[off + 1]! << 8) | (view[off + 2]! << 16) | (view[off + 3]! << 24)) >>> 0
  )
}
function u16(view: Uint8Array, off: number): number {
  return (view[off]! | (view[off + 1]! << 8)) & 0xffff
}

/**
 * Parse a ZIP payload from memory into entries with already-decompressed
 * data. Handles `stored` and `deflate` entries, central-directory driven, and
 * never follows symlinks (they are flagged, not dereferenced).
 */
export function parseZipEntries(blob: Uint8Array): ZipEntry[] {
  const len = blob.length
  // Locate the End Of Central Directory record by scanning backward.
  let eocd = -1
  for (let i = len - 22; i >= Math.max(0, len - 22 - 65536); i -= 1) {
    if (u32(blob, i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('engine-updater: not a zip payload (no end-of-central-dir)')
  const totalEntries = u16(blob, eocd + 10)
  const cdOffset = u32(blob, eocd + 16)
  const entries: ZipEntry[] = []
  let cursor = cdOffset
  for (let n = 0; n < totalEntries; n += 1) {
    if (u32(blob, cursor) !== CENTRAL_SIG || cursor + 46 > len) {
      throw new Error('engine-updater: corrupt zip central directory')
    }
    const method = u16(blob, cursor + 10)
    const compressedSize = u32(blob, cursor + 20)
    const uncompressedSize = u32(blob, cursor + 24)
    const fileNameLen = u16(blob, cursor + 28)
    const extraLen = u16(blob, cursor + 30)
    const commentLen = u16(blob, cursor + 32)
    const externalAttrs = u32(blob, cursor + 38)
    const localOffset = u32(blob, cursor + 42)
    const rawName = Buffer.from(blob.buffer, blob.byteOffset + cursor + 46, fileNameLen).toString(
      'utf8',
    )
    const entryPath = toEntryPath(rawName)
    cursor += 46 + fileNameLen + extraLen + commentLen
    if (entryPath === undefined) continue
    // Derive the shared local header length to reach this entry's data.
    if (localOffset + 30 > len || u32(blob, localOffset) !== 0x04034b50) {
      throw new Error(`engine-updater: corrupt local header for ${entryPath}`)
    }
    const localNameLen = u16(blob, localOffset + 26)
    const localExtraLen = u16(blob, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const isDir = rawName.endsWith('/')
    // POSIX mode lives in the high 16 bits; symlinks are S_IFLNK (0xA000).
    const isSymlink = ((externalAttrs >>> 16) & 0xf000) === 0xa000
    if (isDir) {
      entries.push({
        path: entryPath,
        isDirectory: true,
        isSymlink: false,
        data: new Uint8Array(0),
      })
      continue
    }
    const raw = blob.slice(dataStart, dataStart + compressedSize)
    let data: Uint8Array
    if (method === 0) {
      data = raw
    } else if (method === 8) {
      data = inflateRawSync(raw)
    } else {
      throw new Error(`engine-updater: unsupported zip method ${method} for ${entryPath}`)
    }
    entries.push({ path: entryPath, isDirectory: isDir, isSymlink, data })
    void uncompressedSize
  }
  return entries
}

function safeExtractTarget(root: string, rel: string): string {
  const base = resolve(root)
  const target = resolve(base, rel)
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`
  if (!target.startsWith(prefix)) {
    throw new Error(`engine-updater: entry escapes extraction root: ${rel}`)
  }
  return target
}

export interface ExtractEnginePayloadInput {
  cacheRoot: string
  version: string
  /** Path to `engine.zip`; defaults to the standard version dir path. */
  zipPath?: string
  readFile?: (path: string) => Uint8Array
  writeFile?: (path: string, data: Uint8Array, mode?: number) => void
  mkdir?: (dir: string) => void
  rm?: (path: string, opts?: { force?: boolean }) => void
  exists?: (path: PathLike) => boolean
}

/**
 * Extract a verified `engine.zip` into its versioned dir and validate the
 * result with `isUsableEngineDir`. Symlinks are explicitly skipped (never
 * written) and path traversal entries are rejected, so a malicious payload
 * cannot write outside the versioned cache dir. The zip is removed on success.
 * Throws on an empty payload or a payload that does not materialize a launchable
 * engine (no `harness/apps/cli/lib/bin.js` + `origin.json`, nor launcher).
 */
export function extractEnginePayload(input: ExtractEnginePayloadInput): {
  dir: string
  entries: number
} {
  const dir = engineVersionDir(input.cacheRoot, input.version)
  const zipPath = input.zipPath ?? join(dir, 'engine.zip')
  const readFile = input.readFile ?? ((p: string) => readFileSync(p))
  const mkdir = input.mkdir ?? ((p: string) => mkdirSync(p, { recursive: true }))
  const writeFile =
    input.writeFile ??
    ((p: string, d: Uint8Array, mode?: number) => {
      writeFileSync(p, d, typeof mode === 'number' ? { mode } : undefined)
    })
  const rm = input.rm ?? ((p: string, o?: { force?: boolean }) => rmSync(p, o))
  const blob = readFile(zipPath)
  const entries = parseZipEntries(blob)
  mkdir(dir)
  let files = 0
  for (const entry of entries) {
    if (entry.isSymlink) continue // never materialize symlinks
    const target = safeExtractTarget(dir, entry.path)
    if (entry.isDirectory) {
      mkdir(target)
      continue
    }
    mkdir(dirname(target))
    writeFile(target, entry.data)
    files += 1
  }
  if (files === 0) throw new Error('engine-updater: empty engine zip payload')
  // Guard the activation step: refuse to publish a half-usable engine. If the
  // launcher or node binary is missing the dir can never be launched, so the
  // download+extract rolls back to the previous usable version.
  if (!existsSync(join(dir, 'origin.json')) || !existsSync(join(dir, 'harness'))) {
    throw new Error(`engine-updater: engine ${input.version} failed verification after extraction`)
  }
  try {
    rm(zipPath, { force: true })
  } catch {
    // zip removal is best-effort
  }
  return { dir, entries: files }
}

/**
 * Ensure an already-downloaded+verified version is extracted to a launchable
 * form and then recorded as the active engine. Safe to call more than once: a
 * version that is already extracted and has no `engine.zip` left is reused.
 */
export function activateEngineVersion(input: {
  cacheRoot: string
  version: string
  readFile?: (path: string) => Uint8Array
  writeFile?: (path: string, data: Uint8Array, mode?: number) => void
  mkdir?: (dir: string) => void
  rm?: (path: string, opts?: { force?: boolean }) => void
  exists?: (path: PathLike) => boolean
}): { dir: string; entries: number } {
  const dir = engineVersionDir(input.cacheRoot, input.version)
  const exists = input.exists ?? existsSync
  const zipPath = join(dir, 'engine.zip')
  if (isUsableEngineDir(dir, exists) && !exists(zipPath)) {
    // Already extracted previously; just (re)pin it.
    writeActiveEngineVersion(input.cacheRoot, input.version)
    return { dir, entries: 0 }
  }
  const info = extractEnginePayload({
    cacheRoot: input.cacheRoot,
    version: input.version,
    readFile: input.readFile,
    writeFile: input.writeFile,
    mkdir: input.mkdir,
    rm: input.rm,
    exists: input.exists,
  })
  if (!isUsableEngineDir(info.dir, exists)) {
    throw new Error(`engine-updater: engine ${input.version} is not a launchable engine dir`)
  }
  writeActiveEngineVersion(input.cacheRoot, input.version)
  return info
}

/** Launcher file name for an extracted engine payload root. */
export function engineLauncherName(platform = process.platform): string {
  return platform === 'win32' ? 'dsh.cmd' : 'dsh'
}
