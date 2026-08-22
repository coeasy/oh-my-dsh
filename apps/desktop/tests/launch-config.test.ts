import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseRuntimeFile,
  resolveBundledDshCommand,
  resolveDesktopDownloadUrl,
  resolveDesktopMode,
  resolvePluginPath,
} from '../src/launch-config.ts'

describe('desktop launch-config', () => {
  it('defaults unpackaged to local and packaged to bundled', () => {
    assert.equal(resolveDesktopMode({ packaged: false, env: {} }), 'local')
    assert.equal(resolveDesktopMode({ packaged: true, env: {} }), 'bundled')
    assert.equal(resolveDesktopMode({ packaged: true, env: { DSH_RUNTIME: 'local' } }), 'local')
    assert.equal(
      resolveDesktopMode({ packaged: false, env: { DSH_RUNTIME: 'download' } }),
      'download',
    )
    assert.equal(
      resolveDesktopMode({ packaged: false, env: { DSH_RUNTIME: 'bundled' } }),
      'bundled',
    )
  })

  it('prefers DSH_RUNTIME_URL over runtime.json', () => {
    assert.equal(
      resolveDesktopDownloadUrl({
        env: { DSH_RUNTIME_URL: 'https://example.test/dsh.bin' },
        bundled: { downloadUrl: 'https://example.test/bundled.bin' },
      }),
      'https://example.test/dsh.bin',
    )
    assert.equal(
      resolveDesktopDownloadUrl({
        env: {},
        bundled: { downloadUrl: 'https://example.test/bundled.bin' },
      }),
      'https://example.test/bundled.bin',
    )
    assert.equal(resolveDesktopDownloadUrl({ env: {}, bundled: {} }), undefined)
  })

  it('parses runtime.json and rejects arrays', () => {
    assert.deepEqual(parseRuntimeFile('{"downloadUrl":"https://example.test/dsh.bin"}'), {
      downloadUrl: 'https://example.test/dsh.bin',
    })
    assert.deepEqual(parseRuntimeFile('{"edition":"system"}'), { edition: 'system' })
    assert.deepEqual(parseRuntimeFile('{}'), {})
    assert.throws(() => parseRuntimeFile('[]'), /object/)
    assert.throws(() => parseRuntimeFile('{"edition":"unknown"}'), /bundled\|system/)
  })

  it('resolves the bundled launcher under extraResources when packaged', () => {
    assert.equal(
      resolveBundledDshCommand({
        packaged: true,
        resourcesPath: 'C:\\app\\resources',
        moduleDir: 'C:\\app\\asar\\out',
        platform: 'win32',
      }).replace(/\\/g, '/'),
      'C:/app/resources/runtime/dsh.cmd',
    )
    assert.equal(
      resolveBundledDshCommand({
        packaged: false,
        resourcesPath: 'C:\\app\\resources',
        moduleDir: 'D:\\ws\\apps\\desktop\\out',
        platform: 'win32',
      }).replace(/\\/g, '/'),
      'D:/ws/runtime/stage/dsh.cmd',
    )
  })

  it('loads the plugin from extraResources when packaged', () => {
    assert.equal(
      resolvePluginPath({
        packaged: true,
        resourcesPath: 'C:\\app\\resources',
        moduleDir: 'C:\\app\\asar\\out',
      }).replace(/\\/g, '/'),
      'C:/app/resources/embedded-client.js',
    )
    assert.equal(
      resolvePluginPath({
        packaged: false,
        resourcesPath: 'C:\\app\\resources',
        moduleDir: 'D:\\ws\\apps\\desktop\\out',
      }).replace(/\\/g, '/'),
      'D:/ws/apps/desktop/out/embedded-client.js',
    )
  })
})
