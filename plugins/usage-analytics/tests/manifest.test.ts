import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateManifest, defaultManifest } from '../src/manifest.ts'

describe('validateManifest', () => {
  it('accepts the shipped manifest', () => {
    assert.deepEqual(validateManifest(defaultManifest()), [])
  })
  it('rejects forbidden permissions', () => {
    const m = defaultManifest()
    m.permissions = ['usage.observe', 'network.any']
    const problems = validateManifest(m)
    assert.ok(problems.some((p) => p.includes('forbidden permission')))
  })
  it('rejects unknown permissions', () => {
    const m = defaultManifest()
    m.permissions = ['usage.observe', 'totally.made.up']
    assert.ok(validateManifest(m).some((p) => p.includes('unknown permission')))
  })
  it('rejects bad semver', () => {
    const m = defaultManifest()
    m.version = '1.0'
    assert.ok(validateManifest(m).some((p) => p.includes('semver')))
  })
  it('rejects wrong api_version', () => {
    const m = defaultManifest()
    m.api_version = 'plugin.host.v9'
    assert.ok(validateManifest(m).some((p) => p.includes('api_version')))
  })
  it('rejects forbidden id', () => {
    const m = defaultManifest()
    m.id = '../evil'
    assert.ok(validateManifest(m).some((p) => p.includes('id')))
  })
  it('rejects missing host_entry', () => {
    const m = defaultManifest()
    m.host_entry = ''
    assert.ok(validateManifest(m).some((p) => p.includes('host_entry')))
  })
})
