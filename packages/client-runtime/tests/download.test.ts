import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ensureDownloadedRuntime } from '../src/download.ts'
import { cachedBinaryPath } from '../src/resolve-runtime.ts'

// The runtime functions use the host platform's path semantics; use a path that
// is absolute on the running platform so the suite is portable across CI OSes.
const cacheDir = join(tmpdir(), 'dsh-cache')

function httpResponse(body: BodyInit, status: number): Response {
  return new Response(body, { status })
}

describe('ensureDownloadedRuntime', () => {
  it('returns the cached path without fetching', async () => {
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
          cacheDir,
          exists: () => false,
        }),
      /DSH_RUNTIME_URL is unset/,
    )
  })

  it('writes the fetched payload into cache', async () => {
    const writes: Array<{ path: string; bytes: number }> = []
    const dest = await ensureDownloadedRuntime({
      url: 'https://example.test/dsh.bin',
      cacheDir,
      exists: () => false,
      mkdir: () => {},
      writeFile: (path, data) => {
        writes.push({ path, bytes: data.length })
      },
      fetchImpl: async () => httpResponse(new Uint8Array([1, 2, 3, 4]), 200),
    })
    assert.equal(dest, cachedBinaryPath(cacheDir))
    assert.equal(writes.length, 1)
    assert.equal(writes[0].bytes, 4)
  })

  it('fails loud on HTTP error', async () => {
    await assert.rejects(
      () =>
        ensureDownloadedRuntime({
          url: 'https://example.test/missing',
          cacheDir,
          exists: () => false,
          fetchImpl: async () => httpResponse('nope', 404),
        }),
      /HTTP 404/,
    )
  })

  it('fails loud on non-https download URLs', async () => {
    await assert.rejects(
      () =>
        ensureDownloadedRuntime({
          url: 'http://example.test/dsh.bin',
          cacheDir,
          exists: () => false,
          fetchImpl: async () => {
            throw new Error('network should not run')
          },
        }),
      /non-https/,
    )
  })
})
