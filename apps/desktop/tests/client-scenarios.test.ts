import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { appResourcesDir } from '../../../scripts/app-resources-dir.mjs'
import {
  assertScenariosForPlatform,
  defaultClientScenarios,
  electronBuilderArgs,
  parseClientScenarios,
} from '../../../scripts/client-scenarios.mjs'

describe('client scenarios', () => {
  it('defaults to the host OS pack set', () => {
    assert.deepEqual(parseClientScenarios('', 'win32'), ['vscode', 'nsis', 'portable', 'zip'])
    assert.deepEqual(parseClientScenarios('all', 'darwin'), ['vscode', 'dmg', 'zip'])
    assert.deepEqual(parseClientScenarios('', 'linux'), ['vscode', 'appimage', 'zip'])
    assert.deepEqual(defaultClientScenarios('win32'), ['vscode', 'nsis', 'portable', 'zip'])
  })

  it('accepts a subset and rejects unknown names', () => {
    assert.deepEqual(parseClientScenarios('vscode,zip', 'win32'), ['vscode', 'zip'])
    assert.throws(() => parseClientScenarios('tauri', 'win32'), /unknown client scenario/)
  })

  it('rejects a target that this OS cannot pack', () => {
    assert.throws(() => parseClientScenarios('dmg', 'win32'), /cannot be packed on win32/)
    assert.throws(
      () => assertScenariosForPlatform(['nsis'], 'darwin'),
      /cannot be packed on darwin/,
    )
  })

  it('maps desktop scenarios to electron-builder flags', () => {
    assert.deepEqual(electronBuilderArgs(['nsis', 'portable', 'zip'], 'win32'), [
      '--win',
      'nsis',
      '--win',
      'portable',
      '--win',
      'zip',
    ])
    assert.deepEqual(electronBuilderArgs(['vscode', 'dmg', 'zip'], 'darwin'), [
      '--mac',
      'dmg',
      '--mac',
      'zip',
    ])
    assert.deepEqual(electronBuilderArgs(['appimage', 'zip'], 'linux'), [
      '--linux',
      'AppImage',
      '--linux',
      'zip',
    ])
  })
})

describe('pack resources dir', () => {
  it('uses Resources on macOS and resources elsewhere', () => {
    assert.equal(
      appResourcesDir('C:\\out\\win-unpacked', 'win32').replace(/\\/g, '/'),
      'C:/out/win-unpacked/resources',
    )
    assert.equal(
      appResourcesDir('/out/App.app/Contents', 'darwin'),
      join('/out/App.app/Contents', 'Resources'),
    )
    assert.equal(
      appResourcesDir('/out/App.app/Contents', 'mac'),
      join('/out/App.app/Contents', 'Resources'),
    )
    assert.equal(
      appResourcesDir('/out/linux-unpacked', 'linux'),
      join('/out/linux-unpacked', 'resources'),
    )
  })
})
