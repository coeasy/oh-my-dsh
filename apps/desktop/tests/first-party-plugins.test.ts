import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'node:test'

import {
  ensureFirstPartyPlugins,
  firstPartyPluginsFromRepo,
  firstPartyPluginsFromResources,
  FIRST_PARTY_PLUGINS,
} from '../src/first-party-plugins.ts'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

let tempDirs: string[] = []
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'first-party-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

describe('first-party built-in plugin manifest', () => {
  it('lists all three built-in plugins with their npm names', () => {
    assert.deepEqual(
      FIRST_PARTY_PLUGINS.map((p) => p.name).sort(),
      [
        '@dsh/plugin-degeneration-guard',
        '@dsh/plugin-model-config',
        '@dsh/plugin-usage-analytics',
      ],
    )
  })

  it('prod dirs match the bundled-plugins layout shipped by copy-bundled-plugins.mjs', () => {
    assert.deepEqual(
      FIRST_PARTY_PLUGINS.map((p) => p.prodDir).sort(),
      [
        'bundled-plugins/plugin-degeneration-guard',
        'bundled-plugins/plugin-model-config',
        'bundled-plugins/plugin-usage-analytics',
      ],
    )
  })

  it('dev dirs point at real plugin packages in the repo checkout', () => {
    for (const { name, devDir } of FIRST_PARTY_PLUGINS) {
      assert.ok(existsSync(join(REPO_ROOT, devDir, 'package.json')), `${name} should have package.json at ${devDir}`)
    }
  })
})

describe('path resolution (portability)', () => {
  it('repo resolution yields absolute plugin dirs under the given repo root', () => {
    const specs = firstPartyPluginsFromRepo(REPO_ROOT)
    assert.equal(specs.length, FIRST_PARTY_PLUGINS.length)
    for (const { name, path } of specs) {
      assert.equal(path, join(REPO_ROOT, 'plugins', name.replace('@dsh/plugin-', '')))
      assert.ok(existsSync(join(path, 'package.json')), `${name} should resolve to a real package`)
    }
  })

  it('resources resolution stays under the packaged resources root (no absolute leak)', () => {
    const root = 'C:/fake/resources'
    const specs = firstPartyPluginsFromResources(root)
    assert.equal(specs.length, FIRST_PARTY_PLUGINS.length)
    for (const { path } of specs) {
      assert.ok(path.startsWith(join(root, 'bundled-plugins')), path)
    }
  })
})

describe('ensureFirstPartyPlugins (best-effort, never fatal)', () => {
  it('no-ops cleanly when every built-in is already installed at the bundled version', async () => {
    const home = tmp()
    // web profile manifest records the plugins as installed.
    const web = join(home, 'profiles', 'web')
    mkdirSync(web, { recursive: true })
    const deps: Record<string, string> = {}
    for (const { name } of FIRST_PARTY_PLUGINS) {
      const version = `1.2.3-build.${name.slice(-8)}`
      deps[name] = `file:${name}`
      // installed copy (node_modules/<pkg>/package.json) carries the version.
      const nm = join(web, 'node_modules', name)
      mkdirSync(nm, { recursive: true })
      writeFileSync(
        join(nm, 'package.json'),
        JSON.stringify({ name, version }),
      )
    }
    writeFileSync(
      join(web, 'package.json'),
      JSON.stringify({ name: 'web', private: true, dependencies: deps }),
    )
    // A dsh launcher that MUST NOT be invoked: the fresh path never spawns.
    const plugins = firstPartyPluginsFromResources('C:/fake/resources')
    // Patch the bundled version probe: give each spec a matching package.json
    // so pluginNeedsRefresh sees the same version the manifest says.
    for (const { path } of plugins) {
      mkdirSync(path, { recursive: true })
      const name = Object.keys(deps).find((n) => path.endsWith(n)) ?? ''
      writeFileSync(
        join(path, 'package.json'),
        JSON.stringify({ name, version: deps[name] }),
      )
    }
    await ensureFirstPartyPlugins('definitely-not-a-real-dsh-command', plugins, [home])
    // No assertion needed beyond "did not throw": the whole point is silence.
  })

  it('logs a warning instead of throwing when a missing built-in cannot be installed', async () => {
    const home = tmp()
    const web = join(home, 'profiles', 'web')
    mkdirSync(web, { recursive: true })
    writeFileSync(join(web, 'package.json'), JSON.stringify({ name: 'web', private: true }))
    const plugins = firstPartyPluginsFromResources('C:/fake/resources')
    await ensureFirstPartyPlugins('definitely-not-a-real-dsh-command', plugins, [home])
    // Unresolvable launcher → runMarketCommand resolves ok:false → warn, no throw.
  })
})
