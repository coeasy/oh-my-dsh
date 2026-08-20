import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveVscodeEngineLaunch, resolveVscodeRuntimeMode } from '../src/runtime-mode.ts'

describe('vscode runtime-mode', () => {
  it('uses an explicit setting over production default', () => {
    assert.equal(resolveVscodeRuntimeMode({ production: true, configured: 'local' }), 'local')
    assert.equal(
      resolveVscodeRuntimeMode({ production: false, configured: 'download' }),
      'download',
    )
  })

  it('defaults production VSIX and F5 to the local runtime', () => {
    assert.equal(resolveVscodeRuntimeMode({ production: true }), 'local')
    assert.equal(resolveVscodeRuntimeMode({ production: false }), 'local')
    assert.equal(
      resolveVscodeEngineLaunch({ production: true, repoRoot: '/workspace' }).mode,
      'local',
    )
  })

  it('F5 prefers the repo clone over PATH dsh', () => {
    const repoRoot = 'D:\\ws'
    const cloneBin = `${repoRoot}\\deepseek-harness\\apps\\cli\\lib\\bin.js`
    const resolved = resolveVscodeEngineLaunch({
      production: false,
      repoRoot,
      exists: (path) => path === cloneBin,
      platform: 'win32',
    })
    assert.equal(resolved.mode, 'bundled')
    assert.equal(resolved.cloneBin, cloneBin)
    assert.match(resolved.dshCommand?.replace(/\\/g, '/') ?? '', /runtime\/dev\/dsh\.cmd$/)
  })

  it('honors an explicit local setting even when a clone exists', () => {
    const repoRoot = 'D:\\ws'
    const cloneBin = `${repoRoot}\\deepseek-harness\\apps\\cli\\lib\\bin.js`
    const resolved = resolveVscodeEngineLaunch({
      production: false,
      configured: 'local',
      repoRoot,
      exists: (path) => path === cloneBin,
      platform: 'win32',
    })
    assert.equal(resolved.mode, 'local')
    assert.equal(resolved.dshCommand, undefined)
  })
})
