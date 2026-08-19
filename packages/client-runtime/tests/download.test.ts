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

  it('rejects a payload whose sha256 does not match', async () => {
    await assert.rejects(
      () =>
        ensureDownloadedRuntime({
          url: 'https://example.test/dsh.bin',
          cacheDir,
          exists: () => false,
          mkdir: () => {},
          writeFile: () => {},
          sha256: 'a'.repeat(64),
          fetchImpl: async () => httpResponse(new Uint8Array([1, 2, 3, 4]), 200),
        }),
      /sha256 mismatch/,
    )
  })

  it('accepts a payload whose sha256 matches', async () => {
    const { createHash } = await import('node:crypto')
    const payload = new Uint8Array([9, 8, 7, 6])
    const digest = createHash('sha256').update(payload).digest('hex')
    const dest = await ensureDownloadedRuntime({
      url: 'https://example.test/dsh.bin',
      cacheDir,
      exists: () => false,
      mkdir: () => {},
      writeFile: () => {},
      sha256: digest,
      fetchImpl: async () => httpResponse(payload, 200),
    })
    assert.equal(dest, cachedBinaryPath(cacheDir))
  })

  it('retries transient 5xx responses before failing', async () => {
    let calls = 0
    await assert.rejects(
      () =>
        ensureDownloadedRuntime({
          url: 'https://example.test/dsh.bin',
          cacheDir,
          exists: () => false,
          mkdir: () => {},
          writeFile: () => {},
          retries: 1,
          fetchImpl: async () => {
            calls += 1
            return httpResponse('boom', 503)
          },
        }),
      /HTTP 503/,
    )
    assert.equal(calls, 2)
  })

  it('recovers when a retry succeeds', async () => {
    let calls = 0
    const dest = await ensureDownloadedRuntime({
      url: 'https://example.test/dsh.bin',
      cacheDir,
      exists: () => false,
      mkdir: () => {},
      writeFile: () => {},
      retries: 1,
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) return httpResponse('boom', 503)
        return httpResponse(new Uint8Array([5, 5, 5]), 200)
      },
    })
    assert.equal(calls, 2)
    assert.equal(dest, cachedBinaryPath(cacheDir))
  })

  it('reports download progress stages', async () => {
    const events: string[] = []
    await ensureDownloadedRuntime({
      url: 'https://example.test/dsh.bin',
      cacheDir,
      exists: () => false,
      mkdir: () => {},
      writeFile: () => {},
      onProgress: (stage) => events.push(stage),
      fetchImpl: async () => httpResponse(new Uint8Array([1, 1]), 200),
    })
    assert.deepEqual(events, ['download-started', 'downloaded'])
  })
})
