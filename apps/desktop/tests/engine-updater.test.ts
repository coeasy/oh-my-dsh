import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseLatestRelease,
  parseEngineUpdateManifest,
  compareVersions,
  isUsableEngineDir,
  resolveActiveEngineDir,
  engineVersionDir,
  sha256Hex,
  rollbackCandidate,
  downloadEnginePayload,
  parseZipEntries,
  extractEnginePayload,
  activateEngineVersion,
  writeActiveEngineVersion,
  clearActiveEngineVersion,
  readActiveEngineVersion,
  engineLauncherName,
} from '../src/engine-updater.ts'

function makeEngineDir(root: string, version: string) {
  const dir = engineVersionDir(root, version)
  mkdirSync(join(dir, 'harness', 'apps', 'cli', 'lib'), { recursive: true })
  writeFileSync(join(dir, 'harness', 'apps', 'cli', 'lib', 'bin.js'), '// bin')
  writeFileSync(join(dir, 'origin.json'), JSON.stringify({ ref: version }))
  return dir
}

test('parseLatestRelease extracts ref and url', () => {
  const r = parseLatestRelease('{"tag_name":"v1.2.0","html_url":"https://x"}')
  assert.deepEqual(r, { ref: 'v1.2.0', htmlUrl: 'https://x' })
  assert.equal(parseLatestRelease('not json'), undefined)
  assert.equal(parseLatestRelease(undefined), undefined)
})

test('parseEngineUpdateManifest validates checksum and https url', () => {
  const line = `0.2.0 ${'A'.repeat(64)} https://dl.example/engine.zip`
  const m = parseEngineUpdateManifest(line)
  assert.equal(m?.version, '0.2.0')
  assert.equal(m?.checksum, 'a'.repeat(64))
  assert.equal(parseEngineUpdateManifest(`0.2.0 bad https://x`), undefined)
  assert.equal(parseEngineUpdateManifest(`0.2.0 ${'a'.repeat(64)} http://x`), undefined)
  assert.equal(parseEngineUpdateManifest(`../../outside ${'a'.repeat(64)} https://x`), undefined)
})

test('engineVersionDir rejects traversal and non-semver cache keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-upd-safe-'))
  assert.throws(() => engineVersionDir(root, '../../outside'), /invalid engine version/)
  assert.throws(() => engineVersionDir(root, 'latest'), /invalid engine version/)
})

test('downloadEnginePayload verifies before writing and only accepts HTTPS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-download-engine-'))
  const payload = new Uint8Array([1, 3, 3, 7])
  const checksum = createHash('sha256').update(payload).digest('hex')
  const writes: string[] = []
  const dir = await downloadEnginePayload({
    cacheRoot: root,
    version: '0.2.0',
    url: 'https://dl.example/engine.zip',
    checksum,
    mkdir: () => {},
    writeFile: (path) => writes.push(path),
    fetchImpl: async () => new Response(payload, { status: 200 }),
  })
  assert.equal(dir, engineVersionDir(root, '0.2.0'))
  assert.deepEqual(writes, [join(dir, 'engine.zip')])
  await assert.rejects(
    () =>
      downloadEnginePayload({
        cacheRoot: root,
        version: '0.2.1',
        url: 'http://dl.example/engine.zip',
        checksum,
        fetchImpl: async () => new Response(payload, { status: 200 }),
      }),
    /non-https/,
  )
})

test('compareVersions orders dotted versions', () => {
  assert.ok(compareVersions('v1.2.0', '1.1.9') > 0)
  assert.ok(compareVersions('1.1.9', 'v1.2.0') < 0)
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0)
})

test('resolveActiveEngineDir picks highest usable above bundled', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-upd-'))
  makeEngineDir(root, '0.2.0')
  makeEngineDir(root, '0.3.0')
  mkdirSync(join(root, '0.9.0')) // incomplete, not usable
  const active = resolveActiveEngineDir(root, '0.1.0')
  assert.equal(active?.version, '0.3.0')
  assert.equal(resolveActiveEngineDir(root, '0.4.0'), undefined) // nothing newer
})

test('rollbackCandidate returns older usable engine', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-roll-'))
  makeEngineDir(root, '0.2.0')
  makeEngineDir(root, '0.3.0')
  const rb = rollbackCandidate(root, '0.3.0')
  assert.ok(rb && rb.endsWith('0.2.0'))
})

test('sha256Hex computes a stable digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sha-'))
  const p = join(root, 'a.txt')
  writeFileSync(p, 'hello')
  assert.equal(sha256Hex(p), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
})

test('isUsableEngineDir requires bin.js and origin.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-use-'))
  makeEngineDir(root, '1.0.0')
  assert.equal(isUsableEngineDir(engineVersionDir(root, '1.0.0')), true)
  assert.equal(isUsableEngineDir(join(root, '1.0.0', 'harness')), false)
})

// ---- B1: extraction + activation markers ----

/**
 * Build an in-memory zip with local headers + central directory.
 * `method` 0 = stored, 8 = deflate. `symlinkAttrs` simulates a POSIX symlink.
 */
function buildZip(
  spec: Array<{
    name: string
    data?: Uint8Array
    method?: 0 | 8
    symlinkAttrs?: boolean
  }>,
): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  const offsets: number[] = []
  let cdSize = 0
  let localPos = 0
  for (const entry of spec) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const payload = entry.data ?? new Uint8Array(0)
    const compressed = entry.method === 8 ? deflateRawSync(payload) : payload
    const crc = createHash('sha1') // 32-bit-ish placeholder; our parser ignores crc
    void crc
    // Local file header
    const local = Buffer.alloc(30 + nameBuf.length + compressed.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(entry.method ?? 0, 8)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(payload.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)
    if (compressed.length) Buffer.from(compressed).copy(local, 30 + nameBuf.length)
    chunks.push(new Uint8Array(local))
    offsets.push(localPos)
    localPos += local.length
    // Central directory entry
    const isDir = entry.name.endsWith('/')
    const cent = Buffer.alloc(46 + nameBuf.length)
    cent.writeUInt32LE(0x02014b50, 0)
    const external = entry.symlinkAttrs ? 0xa1ff0000 : isDir ? 0x41ed0000 : 0x81a40000
    cent.writeUInt32LE(external >>> 0, 38)
    cent.writeUInt32LE(localPos - local.length, 42)
    cent.writeUInt16LE(entry.method ?? 0, 10)
    cent.writeUInt32LE(compressed.length, 20)
    cent.writeUInt32LE(payload.length, 24)
    cent.writeUInt16LE(nameBuf.length, 28)
    nameBuf.copy(cent, 46)
    central.push(new Uint8Array(cent))
    cdSize += cent.length
  }
  const cdStart = localPos
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 8) // disk
  eocd.writeUInt16LE(spec.length, 10)
  eocd.writeUInt16LE(spec.length, 12)
  eocd.writeUInt32LE(cdSize, 16)
  eocd.writeUInt32LE(cdStart, 12 + 4) // 0x0c is not a field; fix below
  // write offsets correctly
  eocd.writeUInt32LE(cdStart, 12 + 4)
  void offsets
  return new Uint8Array(Buffer.concat([Buffer.concat(chunks), Buffer.concat(central), eocd]))
}

const LAYOUT: Array<{ name: string; data?: Uint8Array; method?: 0 | 8 }> = [
  { name: 'harness/', data: undefined },
  { name: 'harness/apps/', data: undefined },
  { name: 'harness/apps/cli/lib/bin.js', data: Buffer.from('// bin'), method: 8 },
  { name: 'node.exe', data: Buffer.from('MZ'), method: 0 },
  { name: 'origin.json', data: Buffer.from('{"ref":"0.2.0"}'), method: 8 },
]

test('parseZipEntries reads stored and deflated entries', () => {
  const zip = buildZip(LAYOUT)
  const entries = parseZipEntries(zip)
  const bin = entries.find((e) => e.path === 'harness/apps/cli/lib/bin.js')
  assert.ok(bin)
  assert.equal(Buffer.from(bin.data).toString(), '// bin')
  const origin = entries.find((e) => e.path === 'origin.json')
  assert.ok(origin && !origin.isDirectory)
  const dirs = entries.filter((e) => e.isDirectory)
  assert.ok(dirs.length >= 2)
})

test('extractEnginePayload materializes files and flattens zip', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-extract-'))
  const version = '0.2.0'
  const dir = engineVersionDir(root, version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'engine.zip'), buildZip(LAYOUT))
  const info = extractEnginePayload({ cacheRoot: root, version })
  assert.ok(info.entries >= 2)
  assert.equal(
    Buffer.from(readFileSync(join(dir, 'harness', 'apps', 'cli', 'lib', 'bin.js'))).toString(),
    '// bin',
  )
  assert.equal(readFileSync(join(dir, 'origin.json'), 'utf8'), '{"ref":"0.2.0"}')
  assert.equal(isUsableEngineDir(dir), true)
  // zip removed after extraction
  assert.throws(() => readFileSync(join(dir, 'engine.zip')))
})

test('extraction skips symlink entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-extract-safe-'))
  const version = '0.2.0'
  const dir = engineVersionDir(root, version)
  mkdirSync(dir, { recursive: true })
  const evil = buildZip([
    ...LAYOUT,
    { name: 'evil-link', data: Buffer.from('/etc/passwd'), symlinkAttrs: true },
  ])
  writeFileSync(join(dir, 'engine.zip'), evil)
  extractEnginePayload({ cacheRoot: root, version })
  assert.ok(!existsSync(join(dir, 'evil-link')))
})

test('activateEngineVersion extracts + pins; re-activation is idempotent', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-activate-'))
  const version = '0.2.0'
  const dir = engineVersionDir(root, version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'engine.zip'), buildZip(LAYOUT))
  activateEngineVersion({ cacheRoot: root, version })
  assert.equal(readActiveEngineVersion(root), version)
  assert.equal(readFileSync(activeMarkerPath(root), 'utf8').trim(), version)
  // Second call reuses already-extracted engine without throwing.
  const again = activateEngineVersion({ cacheRoot: root, version })
  assert.equal(again.entries, 0)
})

function activeMarkerPath(root: string): string {
  // .active lives at the cache root.
  return join(root, '.active')
}

test('active pin drives resolveActiveEngineDir; clear lifts it', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pin-'))
  makeEngineDir(root, '0.2.0')
  makeEngineDir(root, '0.3.0')
  // default resolves highest usable
  assert.equal(resolveActiveEngineDir(root, '0.1.0')?.version, '0.3.0')
  // pin to 0.2.0 => resolved as active even though 0.3.0 is newer
  writeActiveEngineVersion(root, '0.2.0')
  assert.equal(resolveActiveEngineDir(root, '0.1.0')?.version, '0.2.0')
  // a pin below the bundled version is ignored (falls back to highest)
  writeActiveEngineVersion(root, '0.0.5')
  assert.equal(resolveActiveEngineDir(root, '0.1.0')?.version, '0.3.0')
  // clearing restores highest
  clearActiveEngineVersion(root)
  assert.equal(resolveActiveEngineDir(root, '0.1.0')?.version, '0.3.0')
})

test('engineLauncherName matches platform', () => {
  assert.equal(engineLauncherName('win32'), 'dsh.cmd')
  assert.equal(engineLauncherName('darwin'), 'dsh')
})
