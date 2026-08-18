import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cachedBinaryPath, resolveRuntime, resolveRuntimeMode } from '../src/resolve-runtime.ts'

describe('resolveRuntime', () => {
  it('defaults to local and honors DSH_BIN', () => {
    assert.equal(resolveRuntimeMode(undefined, {}), 'local')
    const resolved = resolveRuntime({ env: { DSH_BIN: 'C:\\tools\\dsh.cmd' } })
    assert.equal(resolved.mode, 'local')
    assert.equal(resolved.command, 'C:\\tools\\dsh.cmd')
  })

  it('download fails loud when cache and URL are missing', () => {
    assert.throws(
      () =>
        resolveRuntime({
          mode: 'download',
          cacheDir: 'Z:\\no-such-cache',
          env: {},
          exists: () => false,
        }),
      /DSH_RUNTIME_URL is unset/,
    )
  })

  it('download uses cached binary without falling back to PATH', () => {
    const cacheDir = 'C:\\Users\\me\\.dsh-client\\runtime'
    const resolved = resolveRuntime({
      mode: 'download',
      cacheDir,
      env: { DSH_RUNTIME_URL: 'https://example.invalid/dsh' },
      exists: () => true,
    })
    assert.equal(resolved.mode, 'download')
    assert.equal(resolved.command, cachedBinaryPath(cacheDir, process.platform))
  })

  it('rejects unknown DSH_RUNTIME values', () => {
    assert.throws(
      () => resolveRuntimeMode(undefined, { DSH_RUNTIME: 'path' }),
      /local\|download\|bundled/,
    )
  })

  it('bundled requires an existing absolute launcher and never uses PATH', () => {
    assert.equal(resolveRuntimeMode(undefined, { DSH_RUNTIME: 'bundled' }), 'bundled')
    assert.throws(() => resolveRuntime({ mode: 'bundled', env: {} }), /dshCommand or DSH_BIN/)
    assert.throws(
      () => resolveRuntime({ mode: 'bundled', dshCommand: 'dsh', env: {} }),
      /absolute path/,
    )
    assert.throws(
      () =>
        resolveRuntime({
          mode: 'bundled',
          dshCommand: 'C:\\app\\resources\\runtime\\dsh.cmd',
          exists: () => false,
          env: {},
        }),
      /launcher missing/,
    )
    const resolved = resolveRuntime({
      mode: 'bundled',
      dshCommand: 'C:\\app\\resources\\runtime\\dsh.cmd',
      exists: () => true,
      env: {},
    })
    assert.equal(resolved.mode, 'bundled')
    assert.equal(resolved.command, 'C:\\app\\resources\\runtime\\dsh.cmd')
  })
})
