import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { isUsableWorkspace, resolveLaunchDirectory } from '../src/workspace-choice.ts'

describe('workspace choice', () => {
  it('uses a saved directory when it exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    try {
      assert.equal(isUsableWorkspace(dir), true)
      assert.equal(resolveLaunchDirectory(dir, 'C:\\fallback'), dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back when the saved path is missing', () => {
    assert.equal(isUsableWorkspace(''), false)
    assert.equal(
      resolveLaunchDirectory('C:\\missing-dsh-workspace', 'C:\\fallback'),
      'C:\\fallback',
    )
  })
})
