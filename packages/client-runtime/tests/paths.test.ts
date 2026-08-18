import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { assertAbsolutePluginPath, assertSafeReadyPath, isPathInside } from '../src/paths.ts'

describe('paths', () => {
  it('accepts a ready file under tmpdir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ready-test-'))
    const file = join(dir, 'ready.json')
    assert.equal(assertSafeReadyPath(file), resolve(file))
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects relative and traversal ready paths', () => {
    assert.throws(() => assertSafeReadyPath('ready.json'), /must be absolute/)
    assert.throws(() => assertSafeReadyPath('..\\windows\\ready.json'), /must be absolute/)
    assert.throws(
      () => assertSafeReadyPath(join(tmpdir(), '..', 'Windows', 'ready.json')),
      /escapes allowed roots/,
    )
  })

  it('rejects npm package names as plugin paths', () => {
    assert.throws(() => assertAbsolutePluginPath('@dsh/plugin-embedded-client'), /npm package/)
    assert.throws(() => assertAbsolutePluginPath('embedded-client/index.js'), /npm package/)
    assert.throws(() => assertAbsolutePluginPath('./plugin.ts'), /absolute/)
    assert.throws(() => assertAbsolutePluginPath(''), /empty/)
  })

  it('isPathInside is prefix-safe', () => {
    assert.equal(isPathInside(join(tmpdir(), 'a', 'b'), tmpdir()), true)
    assert.equal(isPathInside(join(tmpdir() + '-sibling', 'x'), tmpdir()), false)
  })
})
