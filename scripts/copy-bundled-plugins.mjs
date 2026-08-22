#!/usr/bin/env node
/**
 * Copy the built first-party plugin bundles (model-config / degeneration-guard
 * / usage-analytics) into the desktop out dir so electron-builder ships them
 * under resources/bundled-plugins. The desktop first-run bootstrap installs
 * each via the official CLI:
 *   dsh plugin --profile web add file:<resources>/bundled-plugins/<pkg>
 *
 * Only runtime artifacts are copied (package.json / cordis.patch.yml / out/);
 * no src, tests, ui-src or build config. Version fingerprints come from
 * scripts/bump-plugin-version.mjs (run by the build orchestration before
 * this), so a changed plugin re-snapshots the file: dep on install.
 *
 *   node scripts/copy-bundled-plugins.mjs [outDir]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir =
  process.argv[2] || join(root, 'apps', 'desktop', 'out', 'bundled-plugins')

/** plugin package dir -> destination dir name (used as the file: spec tail). */
const BUNDLED_PLUGINS = [
  { pkg: 'model-config', name: '@dsh/plugin-model-config', dest: 'plugin-model-config' },
  { pkg: 'degeneration-guard', name: '@dsh/plugin-degeneration-guard', dest: 'plugin-degeneration-guard' },
  { pkg: 'usage-analytics', name: '@dsh/plugin-usage-analytics', dest: 'plugin-usage-analytics' },
  { pkg: 'desktop-bridge', name: '@dsh/plugin-desktop-bridge', dest: 'plugin-desktop-bridge' },
]

/** Runtime artifacts shipped with the client (mirrors copy-market entries). */
const ENTRIES = ['package.json', 'cordis.patch.yml', 'out']

const PNPM_DIR = join(root, 'node_modules', '.pnpm')

/** @scope/pkg -> @scope+pkg (pnpm store dir naming). */
function pnpmDirName(name) {
  return name.startsWith('@') ? name.replace('/', '+') : name
}

/**
 * Resolve an installed dependency from the pnpm store to its real directory.
 * Matches `<name>@<version>` dirs; when several versions exist, picks the
 * highest one. Returns null when the package is not installed.
 */
function findPnpmPackage(name) {
  if (!existsSync(PNPM_DIR)) return null
  const prefix = `${pnpmDirName(name)}@`
  let best = null
  for (const entry of readdirSync(PNPM_DIR)) {
    if (!entry.startsWith(prefix)) continue
    const real = join(PNPM_DIR, entry, 'node_modules', name)
    if (!existsSync(real)) continue
    if (best === null || entry > best) best = entry
  }
  if (best === null) return null
  return join(PNPM_DIR, best, 'node_modules', name)
}

/**
 * Copy a plugin's production dependency tree into `<pluginDir>/node_modules`
 * so the bundled plugin is self-contained on any machine. The plugin's build
 * keeps heavy runtime deps external (e.g. usage-analytics externalises
 * sql.js), so without this the engine fails to load the plugin tree
 * (`ERR_MODULE_NOT_FOUND`) and the client renders a blank page.
 *
 * Dependencies MUST live under the plugin's OWN node_modules, not a shared
 * bundled-plugins/node_modules: electron-builder's extraResources copy
 * excludes a top-level `node_modules` dir (filter.js: relative ===
 * "node_modules" => false) but keeps nested ones, and Node resolves a
 * bare specifier from the importing plugin's nearest node_modules first.
 * Returns the number of packages copied.
 */
function copyProductionDeps(pkgJson, pluginDir) {
  const queue = [...Object.keys(pkgJson.dependencies || {})]
  const copied = new Set()
  const depDir = join(pluginDir, 'node_modules')
  while (queue.length) {
    const name = queue.shift()
    if (copied.has(name)) continue
    const real = findPnpmPackage(name)
    if (!real) {
      console.warn(
        `copy-bundled-plugins: dependency ${name} not found in pnpm store — skipped`,
      )
      copied.add(name)
      continue
    }
    const target = join(depDir, name)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(real, target, { recursive: true })
    copied.add(name)
    // Transitive dependencies.
    const subPkg = JSON.parse(
      readFileSync(join(real, 'package.json'), 'utf8'),
    )
    for (const sub of Object.keys(subPkg.dependencies || {})) {
      if (!copied.has(sub)) queue.push(sub)
    }
  }
  return copied.size
}

for (const { pkg, name, dest } of BUNDLED_PLUGINS) {
  const src = join(root, 'plugins', pkg)
  const host = join(src, 'out', 'index.js')
  if (!existsSync(host)) {
    console.error(
      `copy-bundled-plugins: missing ${host} — run the plugin build first (pnpm --filter ${name} build)`,
    )
    process.exit(1)
  }
  const pkgJson = JSON.parse(
    readFileSync(join(src, 'package.json'), 'utf8'),
  )
  if (!/^[\w.+-]+-build\.[0-9a-f]{8}$/u.test(pkgJson.version ?? '')) {
    console.error(
      `copy-bundled-plugins: ${name} has no build fingerprint (${pkgJson.version}) — run scripts/bump-plugin-version.mjs plugins/${pkg} first`,
    )
    process.exit(1)
  }
  const target = join(outDir, dest)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const entry of ENTRIES) {
    cpSync(join(src, entry), join(target, entry), { recursive: true })
  }
  const depsCopied = copyProductionDeps(pkgJson, target)
  console.log(
    `copy-bundled-plugins: bundled ${name}@${pkgJson.version} (${depsCopied} deps) -> ${target}`,
  )
}

console.log(`copy-bundled-plugins: ${BUNDLED_PLUGINS.length} plugin bundles -> ${outDir}`)
