import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
})
