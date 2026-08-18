/**
 * Copy a DSH harness tree without following SYMLINKD.
 * Never merge into an existing dest: skip if complete, else rename dest aside
 * then robocopy /SL (Windows) or cp -a. Merging into a followed/exploded dest
 * can walk a cycle and not return.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export const HARNESS_BIN = join('apps', 'cli', 'lib', 'bin.js')
export const HARNESS_WEB = join('apps', 'web', 'dist', 'index.html')
export const HARNESS_BOOT = join('apps', 'cli', 'node_modules', '@deepseek-ai', 'dsh-app-boot')

/** Directories excluded when staging from the read-only clone. */
export const STAGE_EXCLUDE_DIRS = [
  '.git',
  'website',
  '.agents',
  'coverage',
  '.github',
  'docs',
  '.turbo',
  '.cache',
  '.idea',
  'tests',
  'examples',
  'python',
  'native',
  'assets',
]

/**
 * @param {string} root
 * @returns {boolean}
 */
export function harnessComplete(root) {
  return (
    existsSync(join(root, HARNESS_BIN)) &&
    existsSync(join(root, HARNESS_WEB)) &&
    existsSync(join(root, HARNESS_BOOT))
  )
}

/** True for file/dir symlinks and Windows junctions. */
export function isReparsePath(path) {
  if (!existsSync(path)) return false
  const st = lstatSync(path)
  if (st.isSymbolicLink()) return true
  try {
    readlinkSync(path)
    return true
  } catch {
    return false
  }
}

function robocopyLinkCopy(src, dest, extraXd = []) {
  mkdirSync(dest, { recursive: true })
  const args = [
    src,
    dest,
    '/E',
    '/SL',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/nc',
    '/ns',
    '/np',
  ]
  if (extraXd.length > 0) {
    args.push('/XD', ...extraXd)
  }
  const copied = spawnSync('robocopy', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1_800_000,
  })
  if ((copied.status ?? 1) >= 8) {
    throw new Error(`robocopy /SL failed (exit ${copied.status})`)
  }
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {{ force?: boolean, extraXd?: string[] }} [opts]
 * @returns {{ skipped: boolean, dest: string, stale?: string }}
 */
export function copyHarnessFresh(src, dest, opts = {}) {
  if (!existsSync(src)) {
    throw new Error(`copyHarnessFresh: missing source ${src}`)
  }
  if (harnessComplete(dest) && !opts.force && !isReparsePath(dest)) {
    return { skipped: true, dest }
  }
  let stale
  if (existsSync(dest)) {
    stale = `${dest}.stale-${Date.now()}`
    renameSync(dest, stale)
  }
  if (process.platform === 'win32') {
    robocopyLinkCopy(src, dest, opts.extraXd ?? [])
  } else {
    mkdirSync(dest, { recursive: true })
    const copied = spawnSync('cp', ['-a', `${src}/.`, dest], { timeout: 1_800_000 })
    if (copied.status !== 0) {
      throw new Error(`cp harness failed (exit ${copied.status})`)
    }
  }
  return stale ? { skipped: false, dest, stale } : { skipped: false, dest }
}
