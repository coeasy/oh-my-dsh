/**
 * Clone or update the gitignored DeepSeek Harness tree for packing.
 * Does not edit kernel sources. DSH_ENGINE_REF overrides engine.lock.json.
 * DSH_FETCH_ENGINE_FORCE=1 fails if the requested ref cannot be fetched.
 */
import { existsSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEngineLock } from './engine-lock.mjs'
import { defaultEngineRoot } from './engine-root.mjs'
import { fetchRefCandidates, shouldKeepExistingEngine } from './git-refs.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lock = loadEngineLock(root)
const ref = (process.env.DSH_ENGINE_REF || lock.ref).trim()
const dest = defaultEngineRoot(root)
const bin = join(dest, 'apps', 'cli', 'lib', 'bin.js')
const force = process.env.DSH_FETCH_ENGINE_FORCE === '1'

function git(args, cwd = dest) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  })
}

function fetchAndCheckout() {
  for (const candidate of fetchRefCandidates(ref)) {
    console.log(`fetch-engine: trying ${candidate.kind} ${candidate.args.join(' ')}`)
    const pulled = git(['fetch', '--depth', '1', 'origin', ...candidate.args])
    if (pulled.status !== 0) continue
    const fromFetchHead = git(['checkout', '--force', 'FETCH_HEAD'])
    if (fromFetchHead.status === 0) return true
    const named = git(['checkout', '--force', ref])
    if (named.status === 0) return true
  }
  return false
}

function cloneFresh() {
  const branched = spawnSync(
    'git',
    ['clone', '--depth', '1', '--branch', ref, lock.repository, dest],
    { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'inherit' },
  )
  if (branched.status === 0) return true
  console.warn(`fetch-engine: clone --branch ${ref} failed; cloning default HEAD`)
  const plain = spawnSync('git', ['clone', '--depth', '1', lock.repository, dest], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  })
  if (plain.status !== 0) return false
  return fetchAndCheckout()
}

function stashNonGitDest() {
  const aside = `${dest}.stale-${Date.now()}`
  console.warn(`fetch-engine: moving non-git ${dest} aside to ${aside}`)
  renameSync(dest, aside)
}

let updated = false
if (existsSync(join(dest, '.git'))) {
  updated = fetchAndCheckout()
} else if (existsSync(dest)) {
  stashNonGitDest()
  updated = cloneFresh()
} else {
  updated = cloneFresh()
}

if (!updated) {
  if (shouldKeepExistingEngine({ binExists: existsSync(bin), fetchFailed: true, force })) {
    console.warn(
      `fetch-engine: could not update ${dest} to ${ref}; keeping the existing built clone`,
    )
    process.exit(0)
  }
  throw new Error(
    `fetch-engine: could not fetch ${lock.repository}#${ref} into ${dest}. Set DSH_ENGINE_REF=master if the requested ref is unpublished.`,
  )
}

console.log(`OK: engine ${dest} → ${ref}`)
