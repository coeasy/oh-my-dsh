import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  homeMatrix,
  mirrorHomes,
  semverSatisfies,
  specsEquivalent,
  writePatchToggle,
} from '../src/install.ts'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dsh-sync-'))
  dirs.push(d)
  return d
}
const clean = (): void => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
}
afterEach(clean)

const writeWebProfile = (
  home: string,
  deps: Array<string | [string, string]>,
  bundles: string[] = [],
): void => {
  const dir = join(home, 'profiles', 'web')
  mkdirSync(dir, { recursive: true })
  const dependencies: Record<string, string> = {}
  for (const dep of deps) dependencies[typeof dep === 'string' ? dep : dep[0]] =
    typeof dep === 'string' ? '1.0.0' : dep[1]
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-web', dependencies, dsh: { profile: { bundles } } }),
  )
}

describe('specsEquivalent / semverSatisfies', () => {
  it('a fixed version inside a range is equivalent (pnpm normalization)', () => {
    assert.equal(specsEquivalent('0.2.0', '^0.2.0'), true)
    assert.equal(specsEquivalent('1.5.3', '~1.5.0'), true)
    assert.equal(specsEquivalent('1.9.0', '^1.5.0'), true) // ^1.5.0 allows <2.0.0
    assert.equal(specsEquivalent('1.0.0', '1.0.0'), true)
    assert.equal(specsEquivalent('1.0.0', '*'), true)
  })
  it('a fixed version OUTSIDE a range is drifted', () => {
    assert.equal(specsEquivalent('0.9.0', '^1.0.0'), false)
    assert.equal(specsEquivalent('2.0.0', '^1.0.0'), false)
    assert.equal(specsEquivalent('2.0.0', '~1.5.0'), false)
  })
  it('non-semver specs must match exactly', () => {
    assert.equal(specsEquivalent('file:D:/a', 'file:D:/a'), true)
    assert.equal(specsEquivalent('file:D:/a', 'file:D:/b'), false)
    assert.equal(specsEquivalent('github:a/b', 'file:D:/a'), false)
  })
  it('two different ranges are not equivalent', () => {
    assert.equal(specsEquivalent('^2.0.0', '^1.5.0'), false)
    assert.equal(specsEquivalent('^1.5.0', '~1.5.0'), false)
  })
  it('semverSatisfies handles caret/tilde/compound/bound', () => {
    assert.equal(semverSatisfies('1.4.0', '>=1.0.0 <2.0.0'), true)
    assert.equal(semverSatisfies('2.1.0', '>=1.0.0 <2.0.0'), false)
    assert.equal(semverSatisfies('1.2.3', '^0.2.0'), false)
    assert.equal(semverSatisfies('0.2.1', '^0.2.0'), true)
  })
})

describe('mirrorHomes', () => {
  const OLD = process.env.DSH_MARKET_MIRRORS
  beforeEach(() => {
    delete process.env.DSH_MARKET_MIRRORS
  })
  afterEach(() => {
    if (OLD === undefined) delete process.env.DSH_MARKET_MIRRORS
    else process.env.DSH_MARKET_MIRRORS = OLD
  })

  it('returns [] when the env var is unset', () => {
    assert.deepEqual(mirrorHomes(), [])
  })
  it('returns [] on malformed JSON or non-array', () => {
    process.env.DSH_MARKET_MIRRORS = 'not-json'
    assert.deepEqual(mirrorHomes(), [])
    process.env.DSH_MARKET_MIRRORS = JSON.stringify({ a: 1 })
    assert.deepEqual(mirrorHomes(), [])
  })
  it('parses a JSON array and drops the primary + duplicates', () => {
    const primary = join('C:', 'primary-home')
    const a = join('C:', 'mirror-a')
    const b = join('D:', 'mirror-b')
    process.env.DSH_MARKET_MIRRORS = JSON.stringify([primary, a, a, b, '  '])
    assert.deepEqual(mirrorHomes(primary), [a, b])
  })
})

describe('writePatchToggle', () => {
  it('writes the toggle into an empty patch', () => {
    const home = tmp()
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    const r = writePatchToggle('web', home, '@acme/foo', true)
    assert.equal(r.ok, true)
    const out = readFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
    assert.match(out, /- id: @acme\/foo/)
    assert.match(out, /disabled: true/)
  })
  it('preserves comment headers while replacing its own toggle', () => {
    const home = tmp()
    const dir = join(home, 'profiles', 'web')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'cordis.patch.yml'),
      '# manual note\n- id: @acme/foo\n  disabled: true\n',
      'utf8',
    )
    const r = writePatchToggle('web', home, '@acme/foo', false)
    assert.equal(r.ok, true)
    const out = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.match(out, /# manual note/)
    assert.doesNotMatch(out, /disabled: true/)
    assert.match(out, /disabled: false/)
  })
  it('refuses to touch a patch with unrelated user entries', () => {
    const home = tmp()
    const dir = join(home, 'profiles', 'web')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'cordis.patch.yml'), '- id: @other/manual\n', 'utf8')
    const r = writePatchToggle('web', home, '@acme/foo', true)
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /只读保护/)
  })
})

describe('homeMatrix', () => {
  const OLD = process.env.DSH_MARKET_MIRRORS
  beforeEach(() => {
    delete process.env.DSH_MARKET_MIRRORS
  })
  afterEach(() => {
    if (OLD === undefined) delete process.env.DSH_MARKET_MIRRORS
    else process.env.DSH_MARKET_MIRRORS = OLD
    clean()
  })

  it('flags a mirror missing primary deps as repairable', () => {
    const primary = tmp()
    const mirror = tmp()
    writeWebProfile(primary, ['@acme/one', '@acme/two'])
    writeWebProfile(mirror, ['@acme/one'])
    process.env.DSH_MARKET_MIRRORS = JSON.stringify([mirror])
    const matrix = homeMatrix('web', { primary })
    assert.equal(matrix.primary, primary)
    assert.equal(matrix.homes.length, 2)
    const m = matrix.homes[1]
    assert.equal(m.role, 'mirror')
    assert.equal(m.status, 'missing')
    assert.deepEqual(m.missing, ['@acme/two'])
    assert.deepEqual(m.extra, [])
  })
  it('flags a mirror with extra plugins as extra-only (kept, not removed)', () => {
    const primary = tmp()
    const mirror = tmp()
    writeWebProfile(primary, ['@acme/one'])
    writeWebProfile(mirror, ['@acme/one', '@acme/legacy'])
    process.env.DSH_MARKET_MIRRORS = JSON.stringify([mirror])
    const matrix = homeMatrix('web', { primary })
    const m = matrix.homes[1]
    assert.equal(m.status, 'extra')
    assert.deepEqual(m.missing, [])
    assert.deepEqual(m.extra, ['@acme/legacy'])
  })
  it('marks a fully-matching mirror as in-sync (same specs)', () => {
    const primary = tmp()
    const mirror = tmp()
    writeWebProfile(primary, [['@acme/one', '^1.0.0']])
    writeWebProfile(mirror, [['@acme/one', '^1.0.0']])
    process.env.DSH_MARKET_MIRRORS = JSON.stringify([mirror])
    const matrix = homeMatrix('web', { primary })
    assert.equal(matrix.homes[1].status, 'in-sync')
    assert.deepEqual(matrix.homes[1].drifted, [])
  })
  it('flags a mirror with a differing spec as drifted (alignable)', () => {
    const primary = tmp()
    const mirror = tmp()
    writeWebProfile(primary, [['@acme/one', '^2.0.0']])
    writeWebProfile(mirror, [['@acme/one', '^1.5.0']])
    process.env.DSH_MARKET_MIRRORS = JSON.stringify([mirror])
    const matrix = homeMatrix('web', { primary })
    const m = matrix.homes[1]
    assert.equal(m.status, 'drifted')
    assert.deepEqual(m.missing, [])
    assert.deepEqual(m.drifted, ['@acme/one'])
  })
  it('missing outranks drifted in status precedence', () => {
    const primary = tmp()
    const mirror = tmp()
    writeWebProfile(primary, [['@acme/one', '^2.0.0'], '@acme/two'])
    writeWebProfile(mirror, [['@acme/one', '^1.0.0']])
    process.env.DSH_MARKET_MIRRORS = JSON.stringify([mirror])
    const matrix = homeMatrix('web', { primary })
    const m = matrix.homes[1]
    assert.equal(m.status, 'missing')
    assert.deepEqual(m.missing, ['@acme/two'])
    assert.deepEqual(m.drifted, ['@acme/one'])
  })

  it('excludes the primary even if listed in mirrors', () => {
    const primary = tmp()
    writeWebProfile(primary, ['@acme/one'])
    process.env.DSH_MARKET_MIRRORS = JSON.stringify([primary])
    const matrix = homeMatrix('web', { primary })
    assert.equal(matrix.homes.length, 1)
  })
})
