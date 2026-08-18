import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  copyHarnessFresh,
  STAGE_EXCLUDE_DIRS,
  harnessComplete,
} from '../../../scripts/copy-harness.mjs'

function fakeHarness(root: string, { boot = true } = {}) {
  mkdirSync(join(root, 'apps', 'cli', 'lib'), { recursive: true })
  mkdirSync(join(root, 'apps', 'web', 'dist'), { recursive: true })
  writeFileSync(join(root, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n')
  writeFileSync(join(root, 'apps', 'web', 'dist', 'index.html'), '<html></html>\n')
  if (boot) {
    mkdirSync(join(root, 'apps', 'cli', 'node_modules', '@deepseek-ai'), { recursive: true })
    mkdirSync(join(root, 'apps', 'cli', 'node_modules', '@deepseek-ai', 'dsh-app-boot'))
    writeFileSync(
      join(root, 'apps', 'cli', 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'),
      '{}\n',
    )
  }
}

describe('copyHarnessFresh', () => {
  it('excludes clone-only trees from the staged copy', () => {
    assert.ok(STAGE_EXCLUDE_DIRS.includes('examples'))
    assert.ok(STAGE_EXCLUDE_DIRS.includes('python'))
    assert.ok(STAGE_EXCLUDE_DIRS.includes('native'))
    assert.ok(STAGE_EXCLUDE_DIRS.includes('tests'))
  })
  it('treats bin + web dist + boot package as complete', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-h-'))
    try {
      fakeHarness(root)
      assert.equal(harnessComplete(root), true)
      mkdirSync(join(root, 'incomplete'))
      assert.equal(harnessComplete(join(root, 'incomplete')), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips robocopy when dest is already complete', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-skip-'))
    try {
      const src = join(root, 'src')
      const dest = join(root, 'dest')
      fakeHarness(src)
      fakeHarness(dest)
      writeFileSync(join(dest, 'apps', 'cli', 'lib', 'bin.js'), 'keep\n')
      const result = copyHarnessFresh(src, dest)
      assert.equal(result.skipped, true)
      assert.equal(readFileSync(join(dest, 'apps', 'cli', 'lib', 'bin.js'), 'utf8'), 'keep\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not treat a junction dest as complete', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-junc-'))
    try {
      const src = join(root, 'src')
      const real = join(root, 'real')
      const dest = join(root, 'dest')
      fakeHarness(src)
      fakeHarness(real)
      symlinkSync(real, dest, 'junction')
      const result = copyHarnessFresh(src, dest)
      assert.equal(result.skipped, false)
      assert.ok(result.stale)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('renames an incomplete dest aside instead of merging into it', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rename-'))
    try {
      const src = join(root, 'src')
      const dest = join(root, 'dest')
      fakeHarness(src)
      mkdirSync(dest)
      writeFileSync(join(dest, 'junk.txt'), 'stale\n')
      const result = copyHarnessFresh(src, dest)
      assert.equal(result.skipped, false)
      assert.ok(result.stale)
      assert.equal(existsSync(join(result.stale, 'junk.txt')), true)
      assert.equal(harnessComplete(dest), true)
      assert.equal(existsSync(join(dest, 'junk.txt')), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
