import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { materializeLinks } from '../../../scripts/materialize-links.mjs'

describe('materializeLinks', () => {
  it('replaces a relative dir symlink with a real copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-mat-'))
    try {
      mkdirSync(join(root, 'pkg'))
      writeFileSync(join(root, 'pkg', 'index.js'), 'ok\n')
      mkdirSync(join(root, 'node_modules'))
      symlinkSync(join('..', 'pkg'), join(root, 'node_modules', 'pkg'), 'dir')
      assert.equal(lstatSync(join(root, 'node_modules', 'pkg')).isSymbolicLink(), true)
      const n = materializeLinks(root)
      assert.ok(n >= 1)
      assert.equal(lstatSync(join(root, 'node_modules', 'pkg')).isSymbolicLink(), false)
      assert.equal(readFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'utf8'), 'ok\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not copy a cycle into itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-cyc-'))
    try {
      mkdirSync(join(root, 'cordis'))
      writeFileSync(join(root, 'cordis', 'index.js'), 'c\n')
      mkdirSync(join(root, 'cordis', 'node_modules'))
      symlinkSync(join('..', '..', 'cordis'), join(root, 'cordis', 'node_modules', 'cordis'), 'dir')
      materializeLinks(root)
      assert.equal(lstatSync(join(root, 'cordis')).isSymbolicLink(), false)
      assert.equal(readFileSync(join(root, 'cordis', 'index.js'), 'utf8'), 'c\n')
      const inner = join(root, 'cordis', 'node_modules', 'cordis')
      assert.equal(lstatSync(inner).isSymbolicLink(), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
