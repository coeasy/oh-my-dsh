import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  dshHomeOf,
  expandHomePath,
  isInstalled,
  profileDirOf,
  readOfficialState,
  type OfficialState,
  type RegistryEntry,
} from '../src/registry.ts'

describe('expandHomePath', () => {
  it('expands bare ~ to the home dir', () => {
    assert.equal(expandHomePath('~'), homedir())
  })

  it('expands ~/ and ~\\ prefixes', () => {
    const home = homedir()
    assert.equal(expandHomePath('~/abc'), join(home, 'abc'))
    assert.equal(expandHomePath('~\\abc'), join(home, 'abc'))
  })

  it('leaves absolute and non-tilde paths untouched', () => {
    assert.equal(expandHomePath('/abs/path'), '/abs/path')
    assert.equal(expandHomePath('~other/name'), '~other/name')
  })
})

describe('dshHomeOf', () => {
  const OLD_HOME = process.env.DSH_HOME
  afterEach(() => {
    if (OLD_HOME === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = OLD_HOME
  })

  it('defaults to ~/.dsh', () => {
    delete process.env.DSH_HOME
    const home = homedir()
    assert.equal(dshHomeOf(), resolve(join(home, '.dsh')))
  })

  it('configured path wins over $DSH_HOME', () => {
    process.env.DSH_HOME = '~/.env_home'
    const home = homedir()
    assert.equal(dshHomeOf('~/.my_dsh'), resolve(join(home, '.my_dsh')))
  })

  it('falls back to $DSH_HOME when no configured path', () => {
    process.env.DSH_HOME = '~/.env_home'
    const home = homedir()
    assert.equal(dshHomeOf(), resolve(join(home, '.env_home')))
  })

  it('treats blank $DSH_HOME as unset', () => {
    process.env.DSH_HOME = '   '
    const home = homedir()
    assert.equal(dshHomeOf(), resolve(join(home, '.dsh')))
  })
})

describe('profileDirOf', () => {
  it('resolves <home>/profiles/<profile>', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-home-test-'))
    try {
      assert.equal(profileDirOf('web', tmp), join(tmp, 'profiles', 'web'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('readOfficialState', () => {
  it('reads dependencies and bundles from the profile manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-state-test-'))
    try {
      const web = join(tmp, 'profiles', 'web')
      mkdirSync(web, { recursive: true })
      writeFileSync(
        join(web, 'package.json'),
        JSON.stringify({
          dependencies: { 'dsh-market': '1.0.0' },
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-app-boot'] } },
        }),
        'utf8',
      )
      const state = readOfficialState('web', tmp)
      assert.deepEqual(state.dependencies, ['dsh-market'])
      assert.deepEqual(state.bundles, ['@deepseek-ai/dsh-app-boot'])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns empty state for a missing profile', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-state-missing-'))
    try {
      assert.deepEqual(readOfficialState('web', tmp), { dependencies: [], bundles: [] })
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('isInstalled', () => {
  const state: OfficialState = {
    dependencies: ['dsh-market'],
    bundles: ['@deepseek-ai/dsh-app-boot'],
  }

  it('matches by pkg_name', () => {
    const entry = { pkg_name: 'dsh-market', name: 'market', full_name: 'x/market' } as RegistryEntry
    assert.equal(isInstalled(entry, state), true)
  })

  it('matches by repository name for git-only plugins', () => {
    const entry = { pkg_name: null, name: 'dsh-market', full_name: 'x/market' } as RegistryEntry
    assert.equal(isInstalled(entry, state), true)
  })

  it('returns false when not installed', () => {
    const entry = { pkg_name: 'other-pkg', name: 'other', full_name: 'x/other' } as RegistryEntry
    assert.equal(isInstalled(entry, state), false)
  })
})
