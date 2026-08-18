import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureDownloadedRuntime } from '../src/download.ts'
import { cachedBinaryPath } from '../src/resolve-runtime.ts'

describe('ensureDownloadedRuntime', () => {
  it('returns the cached path without fetching', async () => {
    const cacheDir = 'C:\\cache\\dsh'
    const dest = await ensureDownloadedRuntime({
      url: 'https://example.invalid/dsh',
      cacheDir,
      exists: () => true,
      fetchImpl: async () => {
        throw new Error('network should not run')
      },
    })
    assert.equal(dest, cachedBinaryPath(cacheDir))
  })

  it('fails loud on cache miss without URL', async () => {
    await assert.rejects(
      () =>
        ensureDownloadedRuntime({
          url: '',
          cacheDir: 'Z:\\missing',
          exists: () => false,
        }),
      /DSH_RUNTIME_URL is unset/,
    )
  })

  it('writes the fetched payload into cache', async () => {
    const writes: Array<{ path: string; bytes: number }> = []
    const dest = await ensureDownloadedRuntime({
      url: 'https://example.test/dsh.bin',
      cacheDir: 'C:\\cache\\dsh',
      exists: () => false,
      mkdir: () => {},
      writeFile: (path, data) => {
        writes.push({ path, bytes: data.length })
      },
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    })
    assert.equal(dest, cachedBinaryPath('C:\\cache\\dsh'))
    assert.equal(writes.length, 1)
    assert.equal(writes[0].bytes, 4)
  })

  it('fails loud on HTTP error', async () => {
    await assert.rejects(
      () =>
        ensureDownloadedRuntime({
          url: 'https://example.test/missing',
          cacheDir: 'C:\\cache\\dsh',
          exists: () => false,
          fetchImpl: async () => new Response('nope', { status: 404 }),
        }),
      /HTTP 404/,
    )
  })

  it('fails loud on non-https download URLs', async () => {
    await assert.rejects(
      () =>
        ensureDownloadedRuntime({
          url: 'http://example.test/dsh.bin',
          cacheDir: 'C:\\cache\\dsh',
          exists: () => false,
          fetchImpl: async () => {
            throw new Error('network should not run')
          },
        }),
      /non-https/,
    )
  })
})
