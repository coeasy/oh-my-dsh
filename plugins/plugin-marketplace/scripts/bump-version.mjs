/**
 * Build-time version fingerprint for the marketplace bundle.
 *
 * WHY: the client installs the marketplace as a `file:` dependency (pnpm
 * snapshots the directory on install). pnpm only re-snapshots a `file:`
 * dependency when its package.json (version/deps) changes — so editing the
 * source without bumping the version leaves STALE code in the installed copy
 * ("file: 市场快照陈旧"). The desktop client compares the bundled version to
 * the installed one and runs remove+add when they differ; this script makes
 * the version change exactly when the shipped code changes.
 *
 * The fingerprint is `0.1.0-build.<sha>` where <sha> is the first 8 chars of
 * the hash over every source file (src/, client/, data/, cordis.patch.yml).
 * Running it before `build:host`/`build:client` guarantees a NEW version
 * whenever any shipped file differs → pnpm re-snapshots → the client's
 * freshness check triggers a refresh.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'package.json')

/**
 * Directories to fingerprint (SOURCE CODE only). `client/` and `lib/` are
 * BUILD OUTPUTS (esbuild/tsdown rewrite them on every build) — fingerprinting
 * them would make the version drift on every build. `data/` (the offline
 * snapshot) is refreshed by scripts/build-snapshot.mjs with a fresh
 * generated_at on every build too, so it is excluded as well: the runtime
 * catalog always pulls LIVE data and the snapshot is only an offline
 * fallback, so a stale snapshot doesn't warrant reinstalling the market.
 */
const FINGERPRINT_DIRS = ['src']
/** Extra shipped files to fingerprint. */
const FINGERPRINT_FILES = ['cordis.patch.yml', 'tsdown.config.ts']
/** Never fingerprint build outputs or dependencies. */
const EXCLUDE = new Set(['lib', 'dist', 'node_modules'])

/** Collect every file under `dir` (recursively), skipping EXCLUDE. */
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

/** Stable SHA-256 over the sorted file list (content-hash of shipped code). */
function fingerprint() {
  const files = []
  for (const dir of FINGERPRINT_DIRS) walk(join(root, dir), files)
  for (const file of FINGERPRINT_FILES) {
    const full = join(root, file)
    try {
      if (statSync(full).isFile()) files.push(full)
    } catch {
      /* optional file */
    }
  }
  const hash = createHash('sha256')
  // Sort so filesystem enumeration order never changes the fingerprint.
  for (const file of files.sort()) {
    hash.update(relative(root, file).replace(/\\/g, '/'))
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
console.log(`marketplace version: ${pkg.version} -> ${next}`)
