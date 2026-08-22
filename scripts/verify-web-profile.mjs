/**
 * A4 static metric — "sidebar slot registration wired into the web profile".
 *
 * Guards the official-slot migration (Phase A1): any client plugin that ships a
 * `dsh.client.platform: "web"` row and registers a sidebar slot must actually
 * reach the running web SPA. That chain is purely declarative and checked in,
 * so it can be locked statically — no build artifacts, no network, no harness
 * clone required. Runs before any compile.
 *
 * Per a plugins/{pkg}/package.json declaring a web client row, we assert:
 *   W1  "into web profile" — the package is in FIRST_PARTY_PLUGINS
 *       (apps/desktop/src/first-party-plugins.ts), i.e. the desktop client
 *       installs it into the `web` profile at first run. Without this the
 *       `dsh.client` row is dead: no client bundle is ever requested by the shell.
 *   W2  "client bundle plumbing" — exports exposes both "." and "./client",
 *       the "./client" default resolves to a `client.js` under client/, and
 *       package `files` includes that client dir so the assembled/published
 *       package ships the browser bundle the ./client export points at.
 *   W3  "bundle patch" — cordis.patch.yml exists at the plugin root and its
 *       `insert` names the npm package, so `dsh plugin ... add` reconciles it
 *       into `dsh.profile.bundles` (web layer stack).
 *   W4  "slot registration" — when the client entry uses the slots service
 *       (`ctx.slots.inject` / `slots.register`) it must target the official
 *       `sidebar.footer.action` slot, locking the A1/A2 migration shape so a
 *       future regression cannot silently fall back to DOM injection.
 *
 * Usage: node scripts/verify-web-profile.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const GATE = 'verify-web-profile'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'plugins')
const firstPartySource = join(root, 'apps', 'desktop', 'src', 'first-party-plugins.ts')
const FOOTER_SLOT = 'sidebar.footer.action'
const PLATFORM = 'web'

function fail(message) {
  console.error(GATE + ': ' + message)
  process.exit(1)
}

/** Package names installed into the web profile by the desktop bootstrap. */
function webProfileRoster() {
  const source = readFileSync(firstPartySource, 'utf8')
  const names = new Set()
  const pattern = /name:\s*'(@[^']+)'/g
  let match
  while ((match = pattern.exec(source)) !== null) names.add(match[1])
  // The community marketplace is installed into the web profile by a separate
  // bootstrap (market-bootstrap.ts MARKET_PACKAGE), not the first-party list.
  const marketSource = readFileSync(
    join(root, 'apps', 'desktop', 'src', 'market-bootstrap.ts'),
    'utf8',
  )
  const market = /MARKET_PACKAGE\s*=\s*'(@[^']+)'/.exec(marketSource)
  if (market) names.add(market[1])
  return names
}

/** Parse a small, deterministic two-level YAML subset used by cordis.patch.yml. */
function parsePatchInsertNames(pluginDir) {
  const patchPath = join(pluginDir, 'cordis.patch.yml')
  try {
    statSync(patchPath)
  } catch {
    return { file: false, names: [] }
  }
  const lines = readFileSync(patchPath, 'utf8').split(/\r?\n/)
  const names = []
  let inInsert = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- id:') || trimmed === 'insert:') {
      inInsert = trimmed.startsWith('insert:') ? false : true
      continue
    }
    if (!inInsert) continue
    if (/^[a-zA-Z]+:/.test(line) && !line.startsWith(' ') && !line.startsWith('-')) {
      inInsert = false
      continue
    }
    const nameMatch = /^\s*-?\s*name:\s*["']?(@?[^"'\s]+)["']?\s*$/.exec(trimmed)
    if (nameMatch) names.push(nameMatch[1])
  }
  return { file: true, names }
}

/** Web client entry source file path (default src/client/index.ts) or null. */
function clientEntry(manifest) {
  const exportsField = manifest.exports && typeof manifest.exports === 'object'
    ? manifest.exports
    : {}
  const clientExport =
    typeof exportsField['./client'] === 'string'
      ? exportsField['./client']
      : exportsField['./client'] && typeof exportsField['./client'] === 'object'
        ? exportsField['./client'].default
        : undefined
  if (typeof clientExport !== 'string') return null
  // project-relative source mirror of the runtime export path
  return clientExport.replace(/^\.\//, 'src/').replace(/\.js$/, '.ts')
}

function collectViolations() {
  const roster = webProfileRoster()
  const violations = []
  let webCount = 0

  for (const entry of readdirSync(pluginsDir)) {
    if (entry.startsWith('.')) continue
    const pluginDir = join(pluginsDir, entry)
    let stat
    try {
      stat = statSync(pluginDir)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    const manifestPath = join(pluginDir, 'package.json')
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      continue
    }
    const dsh = manifest.dsh
    const client = dsh && typeof dsh === 'object' ? dsh.client : undefined
    const isWebClient =
      client && typeof client === 'object' && client.platform === PLATFORM
    if (!isWebClient) continue
    webCount += 1

    const name = manifest.name
    const label = manifestPath.split(sep).join('/')

    // W1 — into web profile
    if (!roster.has(name)) {
      violations.push(
        label + ': ' + name + ' declares dsh.client.platform="' + PLATFORM
          + '" but is missing from FIRST_PARTY_PLUGINS in '
          + firstPartySource.split(root + sep)[1]
          + ' — its client row will never be installed into the web profile',
      )
    }

    // W2 — client bundle plumbing
    const exportsField = manifest.exports
    const dotExport = exportsField && typeof exportsField === 'object' ? exportsField['.'] : undefined
    const clientExport =
      exportsField && typeof exportsField === 'object'
        ? typeof exportsField['./client'] === 'string'
          ? exportsField['./client']
          : exportsField['./client'] && typeof exportsField['./client'] === 'object'
            ? exportsField['./client'].default
            : undefined
        : undefined
    if (dotExport === undefined || clientExport === undefined) {
      violations.push(label + ': ' + name + ' must export both "." and "./client" for a browser client row')
    } else {
      const seg = (clientExport.match(/([^/]+\.js)$/) ?? [])[1]
      if (seg !== 'client.js') {
        violations.push(
          label + ': exports["./client"] must resolve to a client/client.js bundle, got ' + clientExport,
        )
      }
    }
    const files = Array.isArray(manifest.files) ? manifest.files : []
    if (!files.includes('client')) {
      violations.push(
        label + ': package files must include "client" so the ./client browser bundle ships with the plugin',
      )
    }

    // W3 — bundle patch
    const patch = parsePatchInsertNames(pluginDir)
    if (!patch.file) {
      violations.push(label + ': ' + name + ' is missing cordis.patch.yml bundle insert for the web profile')
    } else if (!patch.names.includes(name)) {
      violations.push(
        label + ': cordis.patch.yml insert must name "' + name + '" so "dsh plugin ... add" reaches dsh.profile.bundles'
          + ' (found: ' + (patch.names.join(', ') || 'none') + ')',
      )
    }

    // W4 — official slot registration
    const entryRel = clientEntry(manifest)
    if (entryRel !== null) {
      const entryPath = join(pluginDir, entryRel)
      let source = ''
      try {
        source = readFileSync(entryPath, 'utf8')
      } catch {
        source = ''
      }
      if (source && /\.slots\.(inject|register)\s*\(/.test(source) && !source.includes(FOOTER_SLOT)) {
        violations.push(
          entryRel.split(sep).join('/') + ': ' + name + ' uses the slots service but never targets "'
            + FOOTER_SLOT + '" — the official-slot migration wiring is lost',
        )
      }
    }
  }
  return { violations, webCount }
}

const { violations, webCount } = collectViolations()
if (violations.length > 0) {
  console.error(GATE + ': ' + String(webCount) + ' web client row(s), ' + String(violations.length) + ' violation(s):')
  for (const violation of violations) console.error('  ' + violation)
  process.exit(1)
}

if (webCount === 0) {
  fail('no dsh.client platform="' + PLATFORM + '" rows found — nothing verified')
}
console.log(GATE + ': ' + String(webCount) + ' web client row(s) wired into the web profile; slot registration OK')