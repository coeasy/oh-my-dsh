import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  discoverHarnessHomes,
  importHarnessHome,
  officialHarnessHome,
  resolveHarnessHome,
  resolvePluginHomes,
} from '../src/harness-home.ts'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  dirs.push(d)
  return d
}
const clean = (): void => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
}
afterEach(clean)

const writeWebProfile = (home: string, deps = 0, bundles = 0): void => {
  const dir = join(home, 'profiles', 'web')
  mkdirSync(dir, { recursive: true })
  const dependencies: Record<string, string> = {}
  for (let i = 0; i < deps; i += 1) dependencies[`dep${i}`] = '1.0.0'
  const bundleList = Array.from({ length: bundles }, (_, i) => `@acme/b${i}`)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-web',
      dependencies,
      dsh: { profile: { bundles: bundleList } },
    }),
  )
}

describe('officialHarnessHome', () => {
  it('uses $DSH_HOME when set', () => {
    assert.equal(officialHarnessHome({ DSH_HOME: 'C:/custom/home' }), 'C:\\custom\\home')
  })
  it('ignores blank $DSH_HOME and falls back to ~/.dsh', () => {
    const home = officialHarnessHome({ DSH_HOME: '   ' })
    assert.equal(home.endsWith(join('.dsh')), true)
  })
})

describe('resolveHarnessHome', () => {
  it('custom mode → userData/harness', () => {
    const userData = tmp()
    assert.equal(resolveHarnessHome('custom', userData), join(userData, 'harness'))
  })
  it('official mode → official home', () => {
    const userData = tmp()
    assert.equal(resolveHarnessHome('official', userData, { DSH_HOME: 'C:/o' }), 'C:\\o')
  })
  it('explicit path wins', () => {
    const userData = tmp()
    assert.equal(resolveHarnessHome('D:/third/home', userData), 'D:\\third\\home')
  })
  it('auto prefers the richer existing home', () => {
    const userData = tmp()
    writeWebProfile(join(userData, 'harness'), 0, 1) // custom: 1 bundle
    const official = join(tmp(), '.dsh')
    writeWebProfile(official, 0, 5) // official: 5 bundles → richer
    assert.equal(resolveHarnessHome('auto', userData, { DSH_HOME: official }), official)
  })
  it('auto falls back to custom when official is empty', () => {
    const userData = tmp()
    writeWebProfile(join(userData, 'harness'), 0, 3)
    const official = join(tmp(), '.dsh')
    writeWebProfile(official, 0, 0) // exists but no bundles
    assert.equal(
      resolveHarnessHome('auto', userData, { DSH_HOME: official }),
      join(userData, 'harness'),
    )
  })
})

describe('discoverHarnessHomes', () => {
  it('finds custom, official and a third-party appdata home', () => {
    const userData = tmp()
    const appdata = tmp()
    const custom = join(userData, 'harness')
    const official = join(appdata, 'official-home')
    const third = join(appdata, 'dsh-client-desktop', 'harness')
    writeWebProfile(custom, 2, 1)
    writeWebProfile(official, 0, 3)
    writeWebProfile(third, 1, 1)
    const homes = discoverHarnessHomes(userData, { DSH_HOME: official, APPDATA: appdata })
    const ids = homes.map((h) => h.id)
    assert.ok(ids.includes('custom'))
    assert.ok(ids.includes('official'))
    assert.ok(homes.some((h) => h.path === third))
    const customInfo = homes.find((h) => h.id === 'custom')
    assert.equal(customInfo?.hasPlugins, true)
    assert.equal(customInfo?.bundleCount, 1)
  })
})

describe('resolvePluginHomes', () => {
  it('defaults primary to auto resolution and mirrors to discovered homes', () => {
    const userData = tmp()
    const official = join(tmp(), '.dsh')
    writeWebProfile(join(userData, 'harness'), 0, 3)
    writeWebProfile(official, 0, 1)
    const homes = resolvePluginHomes(userData, {}, { DSH_HOME: official })
    assert.equal(homes.primary, join(userData, 'harness'))
    assert.ok(homes.mirrors.includes(official))
  })
  it('resolves primary from the harnessHome setting (matches engine home)', () => {
    const userData = tmp()
    const official = join(tmp(), '.dsh')
    writeWebProfile(official, 0, 1)
    // harnessHome='official' must make the engine home AND the plugin primary
    // the same directory — never 'auto'.
    const homes = resolvePluginHomes(userData, { harnessHome: 'official' }, { DSH_HOME: official })
    assert.equal(homes.primary, official)
    assert.ok(!homes.mirrors.includes(official))
  })
  it('explicit primary and mirrors override defaults and dedup', () => {
    const userData = tmp()
    const primary = join(tmp(), 'p')
    const a = join(tmp(), 'a')
    const b = join(tmp(), 'b')
    const homes = resolvePluginHomes(userData, {
      pluginHomes: { primary, mirrors: [a, b, primary, b] },
    })
    assert.equal(homes.primary, primary)
    assert.deepEqual(homes.mirrors, [a, b])
  })
  it('empty explicit mirrors → falls back to discovered homes (primary pinned)', () => {
    const userData = tmp()
    const official = join(tmp(), '.dsh')
    const custom = join(userData, 'harness')
    writeWebProfile(official, 0, 1)
    writeWebProfile(custom, 0, 3)
    const homes = resolvePluginHomes(
      userData,
      { pluginHomes: { primary: custom, mirrors: [] } },
      { DSH_HOME: official },
    )
    assert.equal(homes.primary, custom)
    assert.ok(homes.mirrors.includes(official))
    assert.ok(!homes.mirrors.includes(custom))
  })
})

describe('importHarnessHome', () => {
  it('copies a source home into an empty target', () => {
    const source = tmp()
    writeWebProfile(source, 2, 2)
    const target = join(tmp(), 'harness')
    const result = importHarnessHome(source, target)
    assert.equal(result.ok, true)
    assert.equal(result.copied, true)
    const probe = join(target, 'profiles', 'web', 'package.json')
    const manifest = JSON.parse(readFileSync(probe, 'utf8'))
    assert.equal(manifest.dependencies.dep1, '1.0.0')
  })
  it('refuses when the target already has a web profile', () => {
    const source = tmp()
    writeWebProfile(source, 1, 1)
    const target = join(tmp(), 'harness')
    writeWebProfile(target, 1, 1)
    const result = importHarnessHome(source, target)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /already has a web profile/)
  })
  it('refuses a non-home source', () => {
    const source = tmp() // no profiles/
    const target = join(tmp(), 'harness')
    const result = importHarnessHome(source, target)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /not a harness home/)
  })
})
