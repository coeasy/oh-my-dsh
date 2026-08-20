import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  atomicActivateDirectory,
  commitFromLsRemote,
  validateInstallTree,
} from '../src/file-installer.ts'

describe('atomic skill/preset installation', () => {
  it('parses only immutable git commits', () => {
    assert.equal(
      commitFromLsRemote('0123456789abcdef0123456789abcdef01234567\tHEAD\n'),
      '0123456789abcdef0123456789abcdef01234567',
    )
    assert.equal(commitFromLsRemote('main\tHEAD'), undefined)
  })

  it('requires a manifest and rejects symbolic links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tree-'))
    try {
      assert.throws(() => validateInstallTree(dir, 'skill'), /SKILL\.md/)
      writeFileSync(join(dir, 'SKILL.md'), '# safe\n')
      validateInstallTree(dir, 'skill')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('activates from staging and replaces the old version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-atomic-'))
    const source = join(dir, 'source')
    const target = join(dir, 'skills', 'demo')
    try {
      mkdirSync(source, { recursive: true })
      mkdirSync(target, { recursive: true })
      writeFileSync(join(source, 'SKILL.md'), 'new')
      writeFileSync(join(target, 'SKILL.md'), 'old')
      atomicActivateDirectory(source, target)
      assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), 'new')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
