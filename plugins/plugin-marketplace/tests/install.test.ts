import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  childEnv,
  healPnpmBuildGate,
  installSpecOf,
  isInstallSpec,
  isNpmSpec,
} from '../src/install.ts'

describe('installSpecOf', () => {
  it('uses the npm package name when published', () => {
    assert.equal(installSpecOf({ pkg_name: 'dsh-market', full_name: 'x/market' }), 'dsh-market')
  })

  it('falls back to a github spec for git-only plugins', () => {
    assert.equal(installSpecOf({ pkg_name: null, full_name: 'x/market' }), 'github:x/market')
  })

  it('treats empty pkg_name as git-only', () => {
    assert.equal(installSpecOf({ pkg_name: '', full_name: 'x/market' }), 'github:x/market')
  })
})

describe('childEnv', () => {
  const OLD_HOME = process.env.DSH_HOME
  afterEach(() => {
    if (OLD_HOME === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = OLD_HOME
  })

  it('always sets CI=true to avoid TTY prompts', () => {
    assert.equal(childEnv().CI, 'true')
  })

  it('injects DSH_HOME when a home is provided', () => {
    const env = childEnv('/custom/home')
    assert.equal(env.DSH_HOME, '/custom/home')
  })

  it('does not inject DSH_HOME when no home is provided', () => {
    const env = childEnv()
    assert.equal(env.DSH_HOME, undefined)
  })
})

describe('install spec validation', () => {
  it('accepts catalog package and github specs only', () => {
    assert.equal(isNpmSpec('dsh-market'), true)
    assert.equal(isNpmSpec('@scope/plugin-name'), true)
    assert.equal(isInstallSpec('github:owner/repo'), true)
    assert.equal(isInstallSpec('https://evil.example/payload'), false)
    assert.equal(isInstallSpec('file:../../outside'), false)
    assert.equal(isInstallSpec('--unsafe-option'), false)
  })
})

describe('healPnpmBuildGate', () => {
  const dirs: string[] = []
  const tmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-heal-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  const workspace = (dir: string, body: string): string => {
    const p = join(dir, 'pnpm-workspace.yaml')
    writeFileSync(p, body)
    return p
  }

  it('replaces only the pnpm placeholder with false', () => {
    const dir = tmp()
    const p = workspace(
      dir,
      'packages:\n  - .\n\nnodeLinker: hoisted\nallowBuilds:\n  node-pty: set this to true or false\n  ssh2: set this to true or false\n',
    )
    const r = healPnpmBuildGate(dir)
    assert.equal(r.changed, true)
    assert.equal(r.path, p)
    const out = readFileSync(p, 'utf8')
    assert.match(out, /node-pty: false/)
    assert.match(out, /ssh2: false/)
    assert.doesNotMatch(out, /set this to true or false/)
  })

  it('never touches a value the user already decided', () => {
    const dir = tmp()
    workspace(dir, 'allowBuilds:\n  node-pty: true\n  ssh2: false\n')
    const r = healPnpmBuildGate(dir)
    assert.equal(r.changed, false)
    assert.equal(
      readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8'),
      'allowBuilds:\n  node-pty: true\n  ssh2: false\n',
    )
  })

  it('is a no-op when there is no workspace file', () => {
    const dir = tmp()
    const r = healPnpmBuildGate(dir)
    assert.equal(r.changed, false)
  })

  it('is a no-op on a clean workspace (no gate entries)', () => {
    const dir = tmp()
    workspace(dir, 'packages:\n  - .\nnodeLinker: hoisted\n')
    const r = healPnpmBuildGate(dir)
    assert.equal(r.changed, false)
  })
})
