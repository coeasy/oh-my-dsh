import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
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
