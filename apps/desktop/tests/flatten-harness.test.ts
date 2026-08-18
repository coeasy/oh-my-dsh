import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  lstatSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { flattenHarness, findReparsePath } from '../../../scripts/flatten-harness.mjs'

describe('flattenHarness', () => {
  it('hoists a relative dir symlink into node_modules as a real copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-flat-'))
    try {
      mkdirSync(join(root, 'src', 'pkg'), { recursive: true })
      writeFileSync(join(root, 'src', 'pkg', 'package.json'), '{"name":"pkg"}\n')
      writeFileSync(join(root, 'src', 'pkg', 'index.js'), 'ok\n')
      mkdirSync(join(root, 'src', 'node_modules'))
      symlinkSync(join('..', 'pkg'), join(root, 'src', 'node_modules', 'pkg'), 'dir')
      const dest = join(root, 'dest')
      flattenHarness(join(root, 'src'), dest, { extraXd: [] })
      assert.equal(lstatSync(join(dest, 'node_modules', 'pkg')).isSymbolicLink(), false)
      assert.equal(readFileSync(join(dest, 'node_modules', 'pkg', 'index.js'), 'utf8'), 'ok\n')
      assert.equal(findReparsePath(dest), undefined)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('hoists a cyclic package once without nesting it inside itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-flat-cyc-'))
    try {
      mkdirSync(join(root, 'src', 'cordis', 'node_modules'), { recursive: true })
      writeFileSync(join(root, 'src', 'cordis', 'package.json'), '{"name":"cordis"}\n')
      writeFileSync(join(root, 'src', 'cordis', 'index.js'), 'c\n')
      symlinkSync(
        join('..', '..', 'cordis'),
        join(root, 'src', 'cordis', 'node_modules', 'cordis'),
        'dir',
      )
      mkdirSync(join(root, 'src', 'node_modules'))
      symlinkSync(join('..', 'cordis'), join(root, 'src', 'node_modules', 'cordis'), 'dir')
      const dest = join(root, 'dest')
      flattenHarness(join(root, 'src'), dest, { extraXd: [] })
      assert.equal(readFileSync(join(dest, 'node_modules', 'cordis', 'index.js'), 'utf8'), 'c\n')
      assert.equal(existsSync(join(dest, 'node_modules', 'cordis', 'node_modules')), false)
      assert.equal(findReparsePath(dest), undefined)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('hoists a shared dependency once for sibling packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-flat-share-'))
    try {
      mkdirSync(join(root, 'src', 'd'), { recursive: true })
      writeFileSync(join(root, 'src', 'd', 'package.json'), '{"name":"d"}\n')
      writeFileSync(join(root, 'src', 'd', 'index.js'), 'd\n')
      mkdirSync(join(root, 'src', 'c', 'node_modules'), { recursive: true })
      writeFileSync(join(root, 'src', 'c', 'package.json'), '{"name":"c"}\n')
      writeFileSync(join(root, 'src', 'c', 'index.js'), 'c\n')
      symlinkSync(join('..', '..', 'd'), join(root, 'src', 'c', 'node_modules', 'd'), 'dir')
      mkdirSync(join(root, 'src', 'node_modules'))
      symlinkSync(join('..', 'c'), join(root, 'src', 'node_modules', 'c'), 'dir')
      const dest = join(root, 'dest')
      flattenHarness(join(root, 'src'), dest, { extraXd: [] })
      assert.equal(readFileSync(join(dest, 'node_modules', 'c', 'index.js'), 'utf8'), 'c\n')
      assert.equal(readFileSync(join(dest, 'node_modules', 'd', 'index.js'), 'utf8'), 'd\n')
      assert.equal(existsSync(join(dest, 'node_modules', 'c', 'node_modules')), false)
      assert.equal(findReparsePath(dest), undefined)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips excluded directory names', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-flat-xd-'))
    try {
      mkdirSync(join(root, 'src', 'apps', 'cli', 'lib'), { recursive: true })
      mkdirSync(join(root, 'src', 'tests'), { recursive: true })
      writeFileSync(join(root, 'src', 'apps', 'cli', 'lib', 'bin.js'), 'bin\n')
      writeFileSync(join(root, 'src', 'tests', 'nope.js'), 'nope\n')
      const dest = join(root, 'dest')
      flattenHarness(join(root, 'src'), dest, { extraXd: ['tests'] })
      assert.equal(readFileSync(join(dest, 'apps', 'cli', 'lib', 'bin.js'), 'utf8'), 'bin\n')
      assert.equal(existsSync(join(dest, 'tests')), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
