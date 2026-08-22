#!/usr/bin/env node
/**
 * Build-time version fingerprint for any first-party Cordis plugin package.
 *
 * WHY: the client installs bundled plugins as `file:` dependencies (pnpm
 * snapshots the directory on install). pnpm only re-snapshots a `file:` dep
 * when its package.json (version/deps) changes — editing the source without
 * bumping the version leaves STALE code in the installed copy. The desktop
 * client compares the bundled version to the installed one and runs
 * remove+add when they differ; this script makes the version change exactly
 * when the shipped code changes, so the client's freshness check can refresh.
 *
 * The fingerprint is `<base>-build.<sha>` where <sha> is the first 8 chars of
 * a SHA-256 over every source file under `src/` plus `cordis.patch.yml`
 * (build outputs like `out/` / `ui/` are excluded — esbuild rewrites them on
 * every build, so fingerprinting them would drift the version every run).
 *
 *   node scripts/bump-plugin-version.mjs <plugin-dir>
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = process.argv[2]
if (!pluginDir) {
  console.error('usage: node scripts/bump-plugin-version.mjs <plugin-dir>')
  process.exit(1)
}
const PLUGIN = join(root, pluginDir)
const manifestPath = join(PLUGIN, 'package.json')

/** Directories to fingerprint (SOURCE CODE only). */
const FINGERPRINT_DIRS = ['src']
/** Extra shipped files to fingerprint. */
const FINGERPRINT_FILES = ['cordis.patch.yml']
/** Never fingerprint build outputs or dependencies. */
const EXCLUDE = new Set(['out', 'ui', 'lib', 'dist', 'node_modules', 'tests', 'client'])

function walk(dir, out) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (EXCLUDE.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (st.isFile()) out.push(full)
  }
}

function fingerprint() {
  const files = []
  for (const dir of FINGERPRINT_DIRS) walk(join(PLUGIN, dir), files)
  for (const file of FINGERPRINT_FILES) {
    const full = join(PLUGIN, file)
    try {
      if (statSync(full).isFile()) files.push(full)
    } catch {
      /* optional file */
    }
  }
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(relative(PLUGIN, file).replace(/\\/g, '/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 8)
}

const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
const base = String(pkg.version ?? '0.1.0').split('-')[0]
const next = `${base}-build.${fingerprint()}`
if (pkg.version !== next) {
  writeFileSync(manifestPath, `${JSON.stringify({ ...pkg, version: next }, undefined, 2)}\n`)
}
console.log(`${pkg.name} version: ${pkg.version} -> ${next}`)
