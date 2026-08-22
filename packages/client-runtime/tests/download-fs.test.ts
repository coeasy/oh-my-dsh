import assert from 'node:assert/strict'
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ensureDownloadedRuntime } from '../src/download.ts'
import { cachedBinaryPath } from '../src/resolve-runtime.ts'

describe('ensureDownloadedRuntime filesystem', () => {
  it('writes the fetched payload into a real cache directory', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-cache-'))
    try {
      const dest = await ensureDownloadedRuntime({
        url: 'https://example.test/dsh.bin',
        cacheDir,
        exists: () => false,
        fetchImpl: async () => new Response(new Uint8Array([7, 8, 9]), { status: 200 }),
      })
      assert.equal(dest, cachedBinaryPath(cacheDir))
      assert.equal(existsSync(dest), true)
      assert.deepEqual(Uint8Array.from(readFileSync(dest)), new Uint8Array([7, 8, 9]))

      const again = await ensureDownloadedRuntime({
        url: 'https://example.test/should-not-fetch',
        cacheDir,
        fetchImpl: async () => {
          throw new Error('network should not run on cache hit')
        },
      })
      assert.equal(again, dest)
    } finally {
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  it('replaces a corrupt cache when the expected checksum changes', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-cache-checksum-'))
    try {
      const dest = cachedBinaryPath(cacheDir)
      writeFileSync(dest, 'corrupt')
      const payload = new Uint8Array([4, 5, 6])
      const digest = createHash('sha256').update(payload).digest('hex')
      await ensureDownloadedRuntime({
        url: 'https://example.test/dsh.bin',
        cacheDir,
        sha256: digest,
        fetchImpl: async () => new Response(payload, { status: 200 }),
      })
      assert.deepEqual(Uint8Array.from(readFileSync(dest)), payload)
    } finally {
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })

  it('removes a partial streamed download after checksum failure', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-cache-stream-'))
    try {
      const dest = cachedBinaryPath(cacheDir)
      await assert.rejects(
        () =>
          ensureDownloadedRuntime({
            url: 'https://example.test/dsh.bin',
            cacheDir,
            sha256: 'a'.repeat(64),
            openWriteStream: (path) => createWriteStream(path),
            fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
          }),
        /sha256 mismatch/,
      )
      assert.equal(existsSync(dest), false)
      assert.equal(existsSync(`${dest}.part`), false)
    } finally {
      rmSync(cacheDir, { recursive: true, force: true })
    }
  })
})
