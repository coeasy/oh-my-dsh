import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CORE_BUNDLES,
  disableCommunityBundles,
  disableNewestCommunityBundles,
  disableNewestCommunityBundlesMany,
} from '../src/plugin-recovery.ts'

const writeManifest = (home: string, bundles: string[]): void => {
  const dir = join(home, 'profiles', 'web')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dsh-profile-web',
        private: true,
        dependencies: { '@acme/broken': '^1.0.0' },
        dsh: { profile: { bundles } },
      },
      undefined,
      2,
    )}\n`,
  )
}

describe('disableCommunityBundles', () => {
  const homes: string[] = []
  const makeHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-recovery-'))
    homes.push(home)
    return home
  }
  afterEach(() => {
    for (const home of homes) rmSync(home, { recursive: true, force: true })
    homes.length = 0
  })

  it('keeps only core bundles and writes a .recovery.bak', () => {
    const home = makeHome()
    writeManifest(home, [...CORE_BUNDLES, '@acme/broken'])
    const result = disableCommunityBundles(home)
    assert.equal(result.ok, true)
    assert.deepEqual(result.disabled, ['@acme/broken'])
    const after = JSON.parse(
      readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'),
    ) as { dsh: { profile: { bundles: string[] } } }
    assert.deepEqual(after.dsh.profile.bundles, [...CORE_BUNDLES])
    assert.ok(existsSync(join(home, 'profiles', 'web', 'package.json.recovery.bak')))
  })

  it('reports nothing to disable when only core bundles are present', () => {
    const home = makeHome()
    writeManifest(home, [...CORE_BUNDLES])
    const result = disableCommunityBundles(home)
    assert.equal(result.ok, false)
    assert.equal(result.disabled.length, 0)
  })

  it('survives a missing profile', () => {
    const home = makeHome()
    const result = disableCommunityBundles(home)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /no profile manifest/)
  })

  it('survives a corrupt manifest without touching it', () => {
    const home = makeHome()
    const dir = join(home, 'profiles', 'web')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'package.json')
    writeFileSync(path, 'not json{{{')
    const result = disableCommunityBundles(home)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /valid JSON/)
    assert.equal(readFileSync(path, 'utf8'), 'not json{{{')
  })

  it('disables only the newest community bundle, leaving the rest', () => {
    const home = makeHome()
    writeManifest(home, [...CORE_BUNDLES, '@acme/a', '@acme/b', '@acme/c'])
    const result = disableNewestCommunityBundles(home, 'web', 1)
    assert.equal(result.ok, true)
    assert.deepEqual(result.disabled, ['@acme/c'])
    const after = JSON.parse(
      readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'),
    ) as { dsh: { profile: { bundles: string[] } } }
    assert.deepEqual(after.dsh.profile.bundles, [...CORE_BUNDLES, '@acme/a', '@acme/b'])
  })

  it('disables the last N community bundles', () => {
    const home = makeHome()
    writeManifest(home, [...CORE_BUNDLES, '@acme/a', '@acme/b', '@acme/c'])
    const result = disableNewestCommunityBundles(home, 'web', 2)
    assert.deepEqual(result.disabled, ['@acme/b', '@acme/c'])
    const after = JSON.parse(
      readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'),
    ) as { dsh: { profile: { bundles: string[] } } }
    assert.deepEqual(after.dsh.profile.bundles, [...CORE_BUNDLES, '@acme/a'])
  })
})

describe('disableNewestCommunityBundlesMany', () => {
  const homes: string[] = []
  const makeHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-fuse-many-'))
    homes.push(home)
    return home
  }
  afterEach(() => {
    for (const home of homes) rmSync(home, { recursive: true, force: true })
    homes.length = 0
  })

  it('fuses the newest bundle in every home independently', () => {
    const primary = makeHome()
    const mirror = makeHome()
    writeManifest(primary, [...CORE_BUNDLES, '@acme/a', '@acme/b'])
    writeManifest(mirror, [...CORE_BUNDLES, '@acme/x'])
    const { results } = disableNewestCommunityBundlesMany([primary, mirror])
    assert.equal(results.length, 2)
    assert.deepEqual(
      results.map((r) => r.disabled),
      [['@acme/b'], ['@acme/x']],
    )
    const primaryAfter = JSON.parse(
      readFileSync(join(primary, 'profiles', 'web', 'package.json'), 'utf8'),
    ) as { dsh: { profile: { bundles: string[] } } }
    const mirrorAfter = JSON.parse(
      readFileSync(join(mirror, 'profiles', 'web', 'package.json'), 'utf8'),
    ) as { dsh: { profile: { bundles: string[] } } }
    assert.deepEqual(primaryAfter.dsh.profile.bundles, [...CORE_BUNDLES, '@acme/a'])
    assert.deepEqual(mirrorAfter.dsh.profile.bundles, [...CORE_BUNDLES])
  })

  it('skips duplicate and empty homes', () => {
    const primary = makeHome()
    writeManifest(primary, [...CORE_BUNDLES, '@acme/a'])
    const { results } = disableNewestCommunityBundlesMany([primary, primary, ''])
    assert.equal(results.length, 1)
    assert.deepEqual(results[0].disabled, ['@acme/a'])
  })

  it('reports a home with no community bundles as not-ok without failing others', () => {
    const a = makeHome()
    const b = makeHome()
    writeManifest(a, [...CORE_BUNDLES, '@acme/a'])
    writeManifest(b, [...CORE_BUNDLES])
    const { results } = disableNewestCommunityBundlesMany([a, b])
    assert.equal(results.length, 2)
    assert.deepEqual(results[0].disabled, ['@acme/a'])
    assert.equal(results[1].ok, false)
    assert.equal(results[1].disabled.length, 0)
  })
})
