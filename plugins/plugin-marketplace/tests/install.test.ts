import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { childEnv, installSpecOf, isInstallSpec, isNpmSpec } from '../src/install.ts'

describe('installSpecOf', () => {
  it('uses the npm package name when published', () => {
    assert.equal(installSpecOf({ pkg_name: 'dsh-market', full_name: 'x/market' }), 'dsh-market')
  })

  it('falls back to a github spec for git-only plugins', () => {
    assert.equal(installSpecOf({ pkg_name: null, full_name: 'x/market' }), 'github:x/market')
  })

  it('treats empty pkg_name as git-only', () => {
    assert.equal(installSpecOf({ pkg_name: '', full_name: 'x/market' }), 'github:x/market')
  })
})

describe('childEnv', () => {
  const OLD_HOME = process.env.DSH_HOME
  afterEach(() => {
    if (OLD_HOME === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = OLD_HOME
  })

  it('always sets CI=true to avoid TTY prompts', () => {
    assert.equal(childEnv().CI, 'true')
  })

  it('injects DSH_HOME when a home is provided', () => {
    const env = childEnv('/custom/home')
    assert.equal(env.DSH_HOME, '/custom/home')
  })

  it('does not inject DSH_HOME when no home is provided', () => {
    const env = childEnv()
    assert.equal(env.DSH_HOME, undefined)
  })
})

describe('install spec validation', () => {
  it('accepts catalog package and github specs only', () => {
    assert.equal(isNpmSpec('dsh-market'), true)
    assert.equal(isNpmSpec('@scope/plugin-name'), true)
    assert.equal(isInstallSpec('github:owner/repo'), true)
    assert.equal(isInstallSpec('https://evil.example/payload'), false)
    assert.equal(isInstallSpec('file:../../outside'), false)
    assert.equal(isInstallSpec('--unsafe-option'), false)
  })
})
