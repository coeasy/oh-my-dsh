import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  ensureLaunchRoot,
  harnessHomePath,
  launchRootPath,
  desktopUserDataPath,
} from '../src/launch-root.ts'

describe('Harness launch root', () => {
  it('uses an application-owned directory under Electron userData', () => {
    assert.equal(
      launchRootPath('/application/user-data'),
      join('/application/user-data', 'launch-root'),
    )
    assert.equal(
      harnessHomePath('/application/user-data'),
      join('/application/user-data', 'harness'),
    )
  })

  it('does not derive userData from the scoped npm name', () => {
    assert.equal(
      desktopUserDataPath('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }).replace(
        /\\/g,
        '/',
      ),
      'C:/Users/me/AppData/Roaming/my-dsh',
    )
    assert.match(desktopUserDataPath('linux', { XDG_CONFIG_HOME: '/home/me/.config' }), /my-dsh$/)
  })

  it('creates the launch root idempotently', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'dsh-desktop-user-data-'))
    try {
      const first = await ensureLaunchRoot(userData)
      const second = await ensureLaunchRoot(userData)
      assert.equal(second, first)
      assert.equal(statSync(first).isDirectory(), true)
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
