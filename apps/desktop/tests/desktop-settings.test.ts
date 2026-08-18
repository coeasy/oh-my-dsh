import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  loadDesktopSettings,
  parseDesktopSettings,
  saveDesktopSettings,
} from '../src/desktop-settings.ts'

describe('desktop settings', () => {
  it('parses a workspace path and ignores unknown fields', () => {
    const parsed = parseDesktopSettings('{"workspace":"D:\\\\proj","autoUpdate":false,"extra":1}')
    assert.equal(parsed.workspace, 'D:\\proj')
    assert.equal(parsed.autoUpdate, false)
  })

  it('round-trips through userData', () => {
    const userData = mkdtempSync(join(tmpdir(), 'dsh-settings-'))
    try {
      assert.deepEqual(loadDesktopSettings(userData), {})
      saveDesktopSettings(userData, { workspace: join(userData, 'ws'), autoUpdate: true })
      const loaded = loadDesktopSettings(userData)
      assert.equal(loaded.autoUpdate, true)
      assert.match(readFileSync(join(userData, 'desktop-settings.json'), 'utf8'), /workspace/)
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
