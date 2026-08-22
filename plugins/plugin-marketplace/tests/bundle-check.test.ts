import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateInstalledBundle } from '../src/bundle-check.ts'

function makeProfile(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bundlecheck-'))
  const profileDir = join(root, 'profiles', 'web')
  mkdirSync(join(profileDir, 'node_modules', '@acme', 'plugin'), { recursive: true })
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: { '@acme/plugin': '1.0.0' } }),
  )
  return profileDir
}

function writePlugin(
  profileDir: string,
  opts: { main?: string; mainBody?: string; patch?: string | null; writePatch?: boolean; entry?: string },
): void {
  const pkgDir = join(profileDir, 'node_modules', '@acme', 'plugin')
  const manifest: Record<string, unknown> = {
    name: '@acme/plugin',
    version: '1.0.0',
    type: 'module',
    main: opts.main ?? 'lib/index.js',
  }
  if (opts.patch !== null) {
    manifest.dsh = { bundle: { patch: opts.patch ?? './cordis.patch.yml' } }
  }
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest))
  const patchPath = opts.patch ?? './cordis.patch.yml'
  if (opts.writePatch !== false) {
    writeFileSync(join(pkgDir, patchPath), '- insert:\n    - id: acme\n      name: "@acme/plugin"\n')
  }
  if (opts.entry) {
    mkdirSync(join(pkgDir, 'lib'), { recursive: true })
    writeFileSync(join(pkgDir, 'lib', 'index.js'), opts.mainBody ?? '')
  }
}

const dirs: string[] = []
const track = (d: string): string => {
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe('validateInstalledBundle', () => {
  it('accepts a valid bundle (entry parses)', () => {
    const profileDir = track(makeProfile())
    writePlugin(profileDir, {
      entry: 'ok',
      mainBody: "export const name = 'acme'\nexport function apply() {}\n",
    })
    const r = validateInstalledBundle(profileDir, '@acme/plugin')
    assert.equal(r.ok, true, JSON.stringify(r.errors))
    assert.equal(r.entry, join(profileDir, 'node_modules', '@acme', 'plugin', 'lib', 'index.js'))
  })

  it('rejects a bundle whose entry has a syntax error (anti-brick)', () => {
    const profileDir = track(makeProfile())
    writePlugin(profileDir, { entry: 'ok', mainBody: 'export const name = ;\n' })
    const r = validateInstalledBundle(profileDir, '@acme/plugin')
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('syntax') || e.includes('Unexpected') || e.includes('Failed')))
  })

  it('rejects a bundle without dsh.bundle declaration', () => {
    const profileDir = track(makeProfile())
    writePlugin(profileDir, { entry: 'ok', patch: null })
    const r = validateInstalledBundle(profileDir, '@acme/plugin')
    assert.equal(r.ok, false)
    assert.match(r.errors[0], /does not declare dsh\.bundle\.patch/)
  })

  it('rejects a bundle whose declared patch file is missing', () => {
    const profileDir = track(makeProfile())
    writePlugin(profileDir, { entry: 'ok', patch: './missing.yml', writePatch: false })
    const r = validateInstalledBundle(profileDir, '@acme/plugin')
    assert.equal(r.ok, false)
    assert.match(r.errors[0], /declared patch .* is missing/)
  })

  it('rejects an unresolvable entry module', () => {
    const profileDir = track(makeProfile())
    writePlugin(profileDir, { main: 'lib/does-not-exist.js', entry: 'ok' })
    const r = validateInstalledBundle(profileDir, '@acme/plugin')
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('cannot be resolved')))
  })

  it('reports a missing package as a failure', () => {
    const profileDir = track(makeProfile())
    const r = validateInstalledBundle(profileDir, '@acme/missing')
    assert.equal(r.ok, false)
  })
})
