/**
 * One-click Harness auto-update: resolve the newest release for the requested
 * channel, pin engine.lock.json to it (ref + pinnedCommit), fetch, and rebuild.
 *
 *   node scripts/engine-update.mjs           # latest (incl. prereleases)
 *   node scripts/engine-update.mjs stable    # newest non-prerelease
 *   DSH_SKIP_ENGINE_BUILD=1 node scripts/engine-update.mjs
 *
 * Never edits kernel sources. Safe to re-run: when already on the newest ref
 * it prints "already up to date" and exits 0.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEngineLock, writeEngineLock } from './engine-lock.mjs'
import { defaultEngineRoot } from './engine-root.mjs'
import { resolveEngineRef } from './github-engine.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const channel = (process.argv[2] || process.env.DSH_ENGINE_CHANNEL || 'latest').trim().toLowerCase()
if (channel !== 'stable' && channel !== 'latest') {
  throw new Error(`engine-update: channel must be stable|latest, got ${channel}`)
}
const lock = loadEngineLock(root)
const dest = defaultEngineRoot(root)

function run(script, extraEnv = {}) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script)], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
    timeout: 3_600_000,
    env: { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) {
    throw new Error(`engine-update: ${script} failed (exit ${result.status})`)
  }
}

function gitRevParseHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: dest,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })
  if (result.status !== 0) return null
  const head = String(result.stdout || '').trim()
  return /^[0-9a-f]{40}$/u.test(head) ? head : null
}

const resolved = await resolveEngineRef({ channel, lock })
console.log(
  `engine-update: ${channel} → ${resolved.repository}#${resolved.ref} (${resolved.source})`,
)

if (resolved.ref === lock.ref) {
  console.log('engine-update: engine already up to date')
} else {
  console.log(`engine-update: pinning engine.lock.json ${lock.ref} → ${resolved.ref}`)
  writeEngineLock(root, { ref: resolved.ref, pinnedCommit: null })

  run('fetch-engine.mjs', { DSH_ENGINE_REF: resolved.ref })

  const head = gitRevParseHead()
  if (!head) {
    console.warn('engine-update: could not read fetched HEAD; pinnedCommit left unset')
  } else {
    writeEngineLock(root, { pinnedCommit: head })
    console.log(`engine-update: pinnedCommit ${head}`)
  }

  if (process.env.DSH_SKIP_ENGINE_BUILD !== '1') {
    run('build-engine.mjs')
  }

  console.log('OK: engine updated')
}
