import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

/**
 * C3 security-baseline lock: these tests fail the build when the preload
 * exposure surface or the window security flags regress. They are
 * source-level on purpose — loading preload.ts outside Electron would mock
 * away the very API we want to constrain.
 */

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const preload = source('../src/preload.ts')
const main = source('../src/main.ts')
const security = source('../src/security.ts')

describe('preload exposure surface (C3)', () => {
  const EXPOSED_METHODS = [
    'pickFolder',
    'setupDefaults',
    'completeSetup',
    'shouldSkipOnboarding',
    'marketAction',
  ]

  it('exposes exactly the allowlisted dshDesktop methods', () => {
    const block = /contextBridge\.exposeInMainWorld\('dshDesktop',\s*\{([\s\S]*?)\n\}\)/.exec(
      preload,
    )
    assert.ok(block, 'contextBridge.exposeInMainWorld("dshDesktop", {...}) block not found')
    const names = [...block[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort()
    assert.deepEqual(names, [...EXPOSED_METHODS].sort())
  })

  it('never exposes ipcRenderer or Node globals to the page', () => {
    // The exposed object must only contain invoke() wrappers; raw listeners,
    // sync channels or event emitters would punch through contextIsolation.
    assert.doesNotMatch(preload, /ipcRenderer\.on\(/)
    assert.doesNotMatch(preload, /ipcRenderer\.send\(/)
    assert.doesNotMatch(preload, /ipcRenderer\.sendSync\(/)
    assert.doesNotMatch(preload, /ipcRenderer\.postMessage\(/)
    assert.doesNotMatch(preload, /\brequire\(/)
    assert.doesNotMatch(preload, /\bprocess\.env\b/)
  })

  it('only invokes known main-process channels', () => {
    const ALLOWED = new Set([
      'desktop:pick-folder',
      'desktop:setup-defaults',
      'desktop:complete-setup',
      'desktop:should-skip-onboarding',
      'mobile:open-pairing',
      'mobile:status',
      'market:action',
    ])
    const channels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1])
    assert.ok(channels.length >= EXPOSED_METHODS.length + 1, 'expected several invoke call sites')
    for (const channel of channels) {
      assert.ok(ALLOWED.has(channel), `unexpected IPC channel in preload: ${channel}`)
    }
  })
})

describe('window security flags (C3)', () => {
  it('locks every webPreferences block to the hardened baseline', () => {
    // Matches both inline `webPreferences: {…}` and the shared
    // `const webPreferences = {…}` form used by createWindow().
    const blocks = [...main.matchAll(/webPreferences\s*[=:]\s*\{([\s\S]*?)\}/g)].map((m) => m[1])
    assert.ok(blocks.length >= 2, 'expected at least main + mobile window preferences')
    for (const block of blocks) {
      assert.match(block, /contextIsolation:\s*true/, 'contextIsolation must be true')
      assert.match(block, /nodeIntegration:\s*false/, 'nodeIntegration must be false')
      assert.match(block, /sandbox:\s*true/, 'sandbox must be true')
      assert.match(block, /webSecurity:\s*true/, 'webSecurity must be true')
    }
  })

  it('secures every window instance through secureWindow()', () => {
    assert.match(main, /secureWindow\(\s*window(?:,|\))/, 'main window must be hardened')
    assert.match(main, /secureWindow\(mobileWindow,/, 'mobile window must be hardened')
  })

  it('navigation interception: untrusted urls are denied and offloaded to the shell', () => {
    // secureWindow must keep the deny-by-default window-open handler and the
    // will-navigate guard; removing either reopens drive-by navigation.
    assert.match(security, /setWindowOpenHandler/)
    assert.match(security, /will-navigate/)
    assert.match(security, /will-attach-webview/)
    assert.match(security, /setPermissionRequestHandler/)
    assert.match(security, /setPermissionCheckHandler/)
  })
})
