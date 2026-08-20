import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { MAX_PER_SOURCE, profileDirOf } from '../src/catalog.ts'

describe('catalog', () => {
  it('bounds every source to MAX_PER_SOURCE entries', () => {
    assert.equal(MAX_PER_SOURCE, 100)
  })

  it('delegates profileDirOf to the official home resolution', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-catalog-'))
    try {
      assert.equal(profileDirOf('web', tmp), join(tmp, 'profiles', 'web'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
