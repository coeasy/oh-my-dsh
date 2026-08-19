/**
 * Replace directory/file symlinks with real copies so 7-Zip/NSIS can archive
 * the tree without following reparse points into a cycle.
 * Walks with lstat (does not follow). A repeated realpath copies the already
 * flattened dest; a dest that contains the link is skipped (cycle).
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

function isInside(child, parent) {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * @param {string} root
 * @param {{ logEvery?: number, onProgress?: (n: number, path: string) => void }} [opts]
 * @returns {number} replaced link count
 */
export function materializeLinks(root, opts = {}) {
  const logEvery = opts.logEvery ?? 50
  const seen = new Map()
  const walked = new Set()
  let replaced = 0
  let walkedDirs = 0

  function progress(msg) {
    if (opts.onProgress) opts.onProgress(replaced, msg)
    else process.stderr.write(`${msg}\n`)
  }

  function walk(dir) {
    let real
    try {
      real = realpathSync(dir)
    } catch {
      return
    }
    if (walked.has(real)) return
    walked.add(real)
    seen.set(real, dir)
    walkedDirs += 1
    if (walkedDirs % 500 === 0) progress(`materialize walk: ${walkedDirs} dirs, ${replaced} links`)

    let names
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const p = join(dir, name)
      let st
      try {
        st = lstatSync(p)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) materialize(p)
      else if (st.isDirectory()) walk(p)
    }
  }

  function materialize(p) {
    let real
    try {
      real = realpathSync(p)
    } catch {
      return
    }
    let isDir = false
    try {
      isDir = statSync(p).isDirectory()
    } catch {
      return
    }

    // p is always a symlink (walk only calls materialize on lstat.isSymbolicLink).
    // Remove the link itself with unlink; rmdir on a dir symlink fails on POSIX.
    unlinkSync(p)

    if (seen.has(real)) {
      const existing = seen.get(real)
      if (existing === p || isInside(p, existing) || isInside(existing, p)) {
        if (isDir) mkdirSync(p, { recursive: true })
        return
      }
      cpSync(existing, p, { recursive: true, force: true, dereference: false })
      replaced += 1
      return
    }

    if (isInside(p, real)) {
      if (isDir) mkdirSync(p, { recursive: true })
      return
    }

    seen.set(real, p)
    if (!isDir) {
      mkdirSync(dirname(p), { recursive: true })
      copyFileSync(real, p)
      replaced += 1
      return
    }

    cpSync(real, p, { recursive: true, force: true, dereference: false })
    replaced += 1
    if (replaced % logEvery === 0) {
      progress(`materialize: ${replaced} links (${p})`)
    }
    walk(p)
  }

  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`materialize-links: not a directory: ${root}`)
  }
  walk(root)
  return replaced
}
