import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { normalizeEngineJunction } from '../src/engine-junction.ts'

let tempDirs: string[] = []
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'engine-junction-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

function profileLink(home: string): string {
  return join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh')
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

function makeJunction(link: string, target: string): void {
  ensureDir(dirname(link))
  symlinkSync(target, link, 'junction')
}

describe('normalizeEngineJunction', () => {
  it('no-ops when the junction is missing (first boot)', () => {
    const home = tmp()
    const result = normalizeEngineJunction({ dshHome: home, runtimeDir: join(tmp(), 'runtime') })
    assert.equal(result.ok, true)
    assert.equal(result.action, 'missing')
  })

  it('keeps a junction that already points at the current runtime (path-form agnostic)', () => {
    const home = tmp()
    const runtime = tmp()
    const target = join(runtime, 'harness', 'apps', 'cli')
    ensureDir(target)
    const link = profileLink(home)
    // Create via a forward-slash path; the engine generates backslashes. A
    // naive === comparison would differ and force a rebuild every launch.
    makeJunction(link, target.split('\\').join('/'))
    const result = normalizeEngineJunction({ dshHome: home, runtimeDir: runtime })
    assert.equal(result.ok, true)
    assert.equal(result.action, 'kept')
  })

  it('repairs a stale junction pointing at a different target', () => {
    const home = tmp()
    const runtime = tmp()
    const stale = join(tmp(), 'other', 'runtime')
    ensureDir(stale)
    const link = profileLink(home)
    makeJunction(link, stale)
    const result = normalizeEngineJunction({ dshHome: home, runtimeDir: runtime })
    assert.equal(result.ok, true)
    assert.equal(result.action, 'repaired')
  })

  it('leaves a non-junction directory alone (engine owns it)', () => {
    const home = tmp()
    const link = profileLink(home)
    mkdirSync(join(home, 'profiles', 'node_modules', '@deepseek-ai'), { recursive: true })
    mkdirSync(link)
    writeFileSync(join(link, 'package.json'), '{}')
    const result = normalizeEngineJunction({ dshHome: home, runtimeDir: join(tmp(), 'runtime') })
    assert.equal(result.ok, true)
    assert.equal(result.action, 'skipped')
  })
})
