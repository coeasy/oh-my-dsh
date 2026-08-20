import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { afterEach, describe, it, mock } from 'node:test'
import { githubRepoFromUrl, verifyNpmPackage, verifyTarballIntegrity } from '../src/verify.ts'

afterEach(() => mock.restoreAll())

describe('githubRepoFromUrl', () => {
  it('parses https urls with and without .git', () => {
    assert.equal(githubRepoFromUrl('https://github.com/owner/repo'), 'owner/repo')
    assert.equal(githubRepoFromUrl('https://github.com/owner/repo.git'), 'owner/repo')
  })

  it('parses git+https and ssh scp forms', () => {
    assert.equal(githubRepoFromUrl('git+https://github.com/owner/repo.git'), 'owner/repo')
    assert.equal(githubRepoFromUrl('git@github.com:owner/repo.git'), 'owner/repo')
  })

  it('strips fragment suffixes', () => {
    assert.equal(githubRepoFromUrl('https://github.com/owner/repo#readme'), 'owner/repo')
  })

  it('returns null for non-github or empty urls', () => {
    assert.equal(githubRepoFromUrl(null), null)
    assert.equal(githubRepoFromUrl('https://gitlab.com/owner/repo'), null)
    assert.equal(githubRepoFromUrl(''), null)
  })
})

describe('verifyNpmPackage', () => {
  it('rejects shell-metacharacter names without hitting the network', async () => {
    const r = await verifyNpmPackage('a;rm -rf /', null, 500)
    assert.equal(r.ok, false)
    assert.equal(r.exists, false)
  })

  it('strips a leading npm: prefix', async () => {
    const r = await verifyNpmPackage('npm:;x', null, 500)
    assert.equal(r.ok, false)
  })

  it('parses metadata, integrity and lifecycle from a published package (mock fetch)', async () => {
    const pkg = {
      name: 'dsh-market',
      version: '1.2.3',
      repository: { url: 'https://github.com/owner/dsh-market.git' },
      homepage: 'https://owner.github.io/dsh-market',
      dist: { integrity: 'sha512-abc123' },
      scripts: { postinstall: 'node scripts/postinstall.js', start: 'echo hi' },
    }
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(pkg), { status: 200 }))
    const r = await verifyNpmPackage('dsh-market', 'owner/dsh-market', 500)
    assert.equal(r.ok, true)
    assert.equal(r.exists, true)
    assert.equal(r.name, 'dsh-market')
    assert.equal(r.latest, '1.2.3')
    assert.equal(r.repository, 'owner/dsh-market')
    assert.equal(r.homepage, 'https://owner.github.io/dsh-market')
    assert.equal(r.integrity, 'sha512-abc123')
    assert.deepEqual(r.lifecycle, ['postinstall'])
    assert.equal(r.squat, false)
  })

  it('flags squat when the npm repo differs from the catalog source', async () => {
    const pkg = {
      name: 'dsh-market',
      version: '1.0.0',
      repository: { url: 'https://github.com/evil/dsh-market.git' },
    }
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(pkg), { status: 200 }))
    const r = await verifyNpmPackage('dsh-market', 'good/dsh-market', 500)
    assert.equal(r.ok, true)
    assert.equal(r.squat, true)
  })

  it('returns exists:false on a 404', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('Not found', { status: 404 }))
    const r = await verifyNpmPackage('dsh-not-taken', null, 500)
    assert.equal(r.ok, true)
    assert.equal(r.exists, false)
  })

  it('returns ok:false when the registry call throws', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('network down')
    })
    const r = await verifyNpmPackage('dsh-market', null, 500)
    assert.equal(r.ok, false)
  })
})

describe('verifyTarballIntegrity (C1)', () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5])
  const digest = (data: Uint8Array): string => createHash('sha512').update(data).digest('base64')

  it('reports match when the tarball hash equals dist.integrity', async () => {
    const fetchImpl = async () => new Response(payload, { status: 200 })
    const r = await verifyTarballIntegrity(
      {
        tarball: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz',
        integrity: `sha512-${digest(payload)}`,
      },
      fetchImpl,
      500,
    )
    assert.equal(r.status, 'match')
  })

  it('reports mismatch for a tampered tarball', async () => {
    const fetchImpl = async () => new Response(new Uint8Array([9, 9, 9]), { status: 200 })
    const r = await verifyTarballIntegrity(
      {
        tarball: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz',
        integrity: `sha512-${digest(payload)}`,
      },
      fetchImpl,
      500,
    )
    assert.equal(r.status, 'mismatch')
  })

  it('is unavailable when tarball or integrity metadata is missing', async () => {
    const none = await verifyTarballIntegrity({ tarball: null, integrity: null }, async () => {
      throw new Error('should not fetch')
    })
    assert.equal(none.status, 'unavailable')
  })

  it('is unavailable on a non-sha512 integrity string', async () => {
    const r = await verifyTarballIntegrity(
      { tarball: 'https://registry.npmjs.org/x.tgz', integrity: 'sha1-abc' },
      async () => new Response(payload, { status: 200 }),
      500,
    )
    assert.equal(r.status, 'unavailable')
  })

  it('is unavailable on a fetch error', async () => {
    const r = await verifyTarballIntegrity(
      { tarball: 'https://registry.npmjs.org/x.tgz', integrity: `sha512-${digest(payload)}` },
      async () => {
        throw new Error('offline')
      },
      500,
    )
    assert.equal(r.status, 'unavailable')
  })
})
