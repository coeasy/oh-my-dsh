import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { resolveEngineLaunch } from '../src/launch-config.ts'

const repoRoot = 'D:\\ws'
const moduleDir = join(repoRoot, 'apps', 'desktop', 'out')

describe('engine launch selection', () => {
  it('unpackaged prefers the repo clone over PATH dsh', () => {
    const cloneBin = join(repoRoot, 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
    const resolved = resolveEngineLaunch({
      packaged: false,
      resourcesPath: 'C:\\app\\resources',
      moduleDir,
      repoRoot,
      env: {},
      exists: (path) => path === cloneBin,
      platform: 'win32',
    })
    assert.equal(resolved.mode, 'bundled')
    assert.equal(resolved.cloneBin, cloneBin)
    assert.match(resolved.dshCommand?.replace(/\\/g, '/') ?? '', /runtime\/dev\/dsh\.cmd$/)
  })

  it('unpackaged prefers a staged relocatable launcher when present', () => {
    const staged = join(repoRoot, 'runtime', 'stage', 'dsh.cmd')
    const cloneBin = join(repoRoot, 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
    const resolved = resolveEngineLaunch({
      packaged: false,
      resourcesPath: 'C:\\app\\resources',
      moduleDir,
      repoRoot,
      env: {},
      exists: (path) => path === staged || path === cloneBin,
      platform: 'win32',
    })
    assert.equal(resolved.mode, 'bundled')
    assert.equal(resolved.dshCommand, staged)
    assert.equal(resolved.cloneBin, undefined)
  })

  it('packaged ignores ambient DSH_RUNTIME=local and uses extraResources', () => {
    const resolved = resolveEngineLaunch({
      packaged: true,
      resourcesPath: 'C:\\app\\resources',
      moduleDir,
      repoRoot,
      env: { DSH_RUNTIME: 'local' },
      exists: () => false,
      platform: 'win32',
    })
    assert.equal(resolved.mode, 'bundled')
    assert.equal(resolved.dshCommand?.replace(/\\/g, '/'), 'C:/app/resources/runtime/dsh.cmd')
  })

  it('unpackaged DSH_RUNTIME=local still prefers the clone unless DSH_BIN is set', () => {
    const cloneBin = join(repoRoot, 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
    const resolved = resolveEngineLaunch({
      packaged: false,
      resourcesPath: 'C:\\app\\resources',
      moduleDir,
      repoRoot,
      env: { DSH_RUNTIME: 'local' },
      exists: (path) => path === cloneBin,
      platform: 'win32',
    })
    assert.equal(resolved.mode, 'bundled')
    assert.equal(resolved.cloneBin, cloneBin)
  })

  it('DSH_BIN wins over the clone when local runtime is requested', () => {
    const cloneBin = join(repoRoot, 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
    const resolved = resolveEngineLaunch({
      packaged: false,
      resourcesPath: 'C:\\app\\resources',
      moduleDir,
      repoRoot,
      env: { DSH_RUNTIME: 'local', DSH_BIN: 'D:\\tools\\dsh.cmd' },
      exists: (path) => path === cloneBin,
      platform: 'win32',
    })
    assert.equal(resolved.mode, 'local')
    assert.equal(resolved.dshCommand, 'D:\\tools\\dsh.cmd')
  })
})
