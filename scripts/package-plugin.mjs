#!/usr/bin/env node
/**
 * Generic plugin packaging for marketplace distribution.
 *
 * Mirrors scripts/package-usage-plugin.mjs but parameterized by plugin dir so
 * any Cordis plugin with the same manifest contract can ship:
 *
 *   node scripts/package-plugin.mjs model-config
 *   node scripts/package-plugin.mjs degeneration-guard
 *
 *  1. Validates manifest.json (id/api_version/version/permissions/targets).
 *  2. Rebuilds the plugin's UI bundle from ui-src (reproducible).
 *  3. Tars the plugin into dist/plugins/<id>-<version>.tgz.
 *  4. Writes a .sha256 checksum.
 *  5. Emits a manifest.signature placeholder (real signing uses the release
 *     key — see docs/signing.md).
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginName = process.argv[2]
if (!pluginName) {
  console.error('usage: node scripts/package-plugin.mjs <plugin-dir>')
  process.exit(1)
}
const PLUGIN = join(ROOT, 'plugins', pluginName)
const MANIFEST_PATH = join(PLUGIN, 'manifest.json')
const OUT_DIR = join(ROOT, 'dist', 'plugins')

const FORBIDDEN = new Set([
  'network.any',
  'filesystem.any',
  'native_code',
  'process.spawn',
  'credential.read',
])

function validateManifest(m) {
  const problems = []
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(m.id || '')) problems.push('invalid id')
  if (m.api_version !== 'plugin.host.v1') problems.push('api_version must be plugin.host.v1')
  if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) problems.push('version must be semver')
  if (!Array.isArray(m.targets) || m.targets.length === 0) problems.push('targets required')
  for (const p of m.permissions || []) {
    if (FORBIDDEN.has(p)) problems.push(`forbidden permission: ${p}`)
  }
  if (typeof m.host_entry !== 'string' || !m.host_entry.length) problems.push('host_entry required')
  return problems
}

function sha256File(path) {
  const buf = readFileSync(path)
  return createHash('sha256').update(buf).digest('hex')
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const problems = validateManifest(manifest)
  if (problems.length) {
    console.error('manifest invalid:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('manifest valid:', manifest.id, manifest.version)

  // Rebuild the UI bundle from source for reproducibility, then copy into ui/.
  const uiSrc = join(PLUGIN, 'ui-src', 'mount.ts')
  const bundle = join(PLUGIN, 'ui', 'bundle.js')
  const hasUi = fileExists(uiSrc)
  if (hasUi) {
    console.log('building UI bundle…')
    await build({
      entryPoints: [uiSrc],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      outfile: bundle,
      logLevel: 'warning',
    })
    console.log('ui bundle:', bundle)
  } else if (manifest.ui_entry) {
    console.warn('ui_entry declared but ui-src/mount.ts missing — skipping UI build')
  }

  // Package via tar (relative forward-slash paths rooted at the repo).
  mkdirSync(OUT_DIR, { recursive: true })
  const tarballName = `${manifest.id}-${manifest.version}.tgz`
  const tarball = join(OUT_DIR, tarballName)
  const relPlugin = `plugins/${pluginName}`
  const relOut = `dist/plugins/${tarballName}`
  execFileSync(
    'tar',
    [
      '-czf',
      relOut,
      '--exclude=node_modules',
      '--exclude=tests',
      '--exclude=.gitignore',
      '--exclude=ui-src',
      '-C',
      relPlugin,
      '.',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  const checksum = sha256File(tarball)
  writeFileSync(`${tarball}.sha256`, checksum)
  console.log('packaged:', tarball)
  console.log('sha256:', checksum)

  const signed = {
    ...manifest,
    artifact: `${manifest.id}-${manifest.version}.tgz`,
    artifact_sha256: checksum,
    signature: '', // filled by release owner with private key
  }
  const signedPath = join(OUT_DIR, `${manifest.id}-${manifest.version}.signed.json`)
  writeFileSync(signedPath, JSON.stringify(signed, null, 2))
  console.log('signature template:', signedPath)
}

function fileExists(p) {
  try {
    readFileSync(p)
    return true
  } catch {
    return false
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
