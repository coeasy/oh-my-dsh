import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackup, restoreBackup } from '../src/backup.ts'

describe('buildBackup', () => {
  it('snapshots dependencies and bundles from the official manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-backup-'))
    try {
      const web = join(tmp, 'profiles', 'web')
      mkdirSync(web, { recursive: true })
      writeFileSync(
        join(web, 'package.json'),
        JSON.stringify({
          dependencies: { 'dsh-a': '1.0.0', 'dsh-b': '2.0.0' },
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-app-boot'] } },
        }),
        'utf8',
      )
      const backup = buildBackup('web', tmp)
      assert.equal(backup.format, BACKUP_FORMAT)
      assert.equal(backup.version, BACKUP_VERSION)
      assert.deepEqual(backup.dependencies, ['dsh-a', 'dsh-b'])
      assert.deepEqual(backup.bundles, ['@deepseek-ai/dsh-app-boot'])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns empty for a missing profile', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-backup-empty-'))
    try {
      const backup = buildBackup('web', tmp)
      assert.deepEqual(backup.dependencies, [])
      assert.deepEqual(backup.bundles, [])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('restoreBackup', () => {
  it('restoring an empty backup is a no-op success', async () => {
    const r = await restoreBackup('web', { dependencies: [], bundles: [] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.restored, [])
    assert.deepEqual(r.failed, [])
  })

  it('skips bundle-only packages that are not also top-level deps (no CLI spawn)', async () => {
    // Only bundle-only packages → nothing to install → the CLI is never
    // spawned, keeping this test fast and fully offline.
    const r = await restoreBackup('web', {
      dependencies: [],
      bundles: ['@deepseek-ai/dsh-app-boot'],
    })
    assert.equal(r.ok, true)
    assert.ok(r.skipped.includes('@deepseek-ai/dsh-app-boot'))
    assert.deepEqual(r.restored, [])
  })

  it('rejects malformed package specs before spawning the CLI', async () => {
    const r = await restoreBackup('web', {
      dependencies: ['file:../../outside'],
      bundles: [],
    })
    assert.equal(r.ok, false)
    assert.equal(r.restored.length, 0)
    assert.match(r.failed[0]?.error ?? '', /invalid|oversized/)
  })
})
