#!/usr/bin/env node
/**
 * Package the Usage Analytics plugin for marketplace distribution.
 *
 *  1. Validates manifest.json against the permission whitelist.
 *  2. Ensures the shared UI bundle is built.
 *  3. Tars the plugin into an installable package.
 *  4. Writes a .sha256 checksum file.
 *  5. Emits a manifest.signature placeholder (real signing requires the
 *     team's signing key — see docs/signing.md).
 *
 * The signature field is intentionally left empty here; signing is performed
 * by the release owner with the private key, matching the plan's Phase 6.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(ROOT, 'plugins', 'usage-analytics')
const UI_PKG = join(ROOT, 'packages', 'usage-analytics-ui')
const MANIFEST_PATH = join(PLUGIN, 'manifest.json')
const OUT_DIR = join(ROOT, 'dist', 'plugins')

// Mirror of the manifest validator (kept here so packaging can run standalone).
const ALLOWED = new Set(['usage.observe', 'storage.local', 'ui.mount', 'events.subscribe'])
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
  if (!Array.isArray(m.permissions)) problems.push('permissions must be array')
  else {
    for (const p of m.permissions) {
      if (FORBIDDEN.has(p)) problems.push(`forbidden permission: ${p}`)
      if (!ALLOWED.has(p)) problems.push(`unknown permission: ${p}`)
    }
  }
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

  // Always rebuild the UI bundle from source for a reproducible build, then
  // copy it into the plugin dir so the distributed package is self-contained
  // for the desktop host page (ui-page.ts loads it).
  const bundle = join(UI_PKG, 'ui', 'bundle.js')
  console.log('building UI bundle…')
  // Build via the esbuild Node API (no shell, no `npx` .cmd shim issues, no
  // platform-specific ENOENT/EINVAL). Reproducible from source every time.
  await build({
    entryPoints: [join(UI_PKG, 'src', 'mount-global.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    outfile: bundle,
    logLevel: 'warning',
  })
  mkdirSync(join(PLUGIN, 'ui'), { recursive: true })
  copyFileSync(bundle, join(PLUGIN, 'ui', 'bundle.js'))
  console.log('ui bundle:', bundle)

  // Package via tar (files under the plugin dir, excluding node_modules/tests).
  mkdirSync(OUT_DIR, { recursive: true })
  const tarballName = `${manifest.id}-${manifest.version}.tgz`
  const tarball = join(OUT_DIR, tarballName)
  // GNU tar under execFileSync mishandles backslash drive paths; use relative
  // forward-slash paths rooted at the repo.
  const relPlugin = 'plugins/usage-analytics'
  const relOut = `dist/plugins/${tarballName}`
  execFileSync(
    'tar',
    [
      '-czf',
      relOut,
      '--exclude=node_modules',
      '--exclude=tests',
      '--exclude=.gitignore',
      '-C',
      relPlugin,
      '.',
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  )
  const checksum = sha256File(tarball)
  writeFileSync(`${tarball}.sha256`, checksum)
  console.log('packaged:', tarball)
  console.log('sha256:', checksum)

  // Emit signed-manifest template.
  const signed = {
    ...manifest,
    artifact: `${manifest.id}-${manifest.version}.tgz`,
    artifact_sha256: checksum,
    signature: '', // filled by release owner with private key
  }
  const signedPath = join(OUT_DIR, `${manifest.id}-${manifest.version}.signed.json`)
  writeFileSync(signedPath, JSON.stringify(signed, null, 2))
  console.log('signature template:', signedPath)
  console.log(
    '\nsignature field is EMPTY — sign with the release key before publishing (docs/signing.md).',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
