/**
 * Copy a DSH harness tree into a link-free payload so NSIS/7-Zip can archive
 * it without following SYMLINKD into a workspace cycle.
 *
 * Layout: the non-node_modules tree is copied as real files; every unique
 * package is copied once (no nested node_modules) into
 * `apps/cli/node_modules` (and `node_modules` when that CLI dir is absent)
 * so Node's walk-up resolution finds siblings without directory cycles.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { HARNESS_BIN, HARNESS_BOOT, HARNESS_WEB, STAGE_EXCLUDE_DIRS, isReparsePath } from './copy-harness.mjs'

/** True for file/dir symlinks and Windows junctions. Re-exported from copy-harness. */
export { isReparsePath }

/**
 * @param {string} root
 * @returns {string | undefined} first reparse path
 */
export function findReparsePath(root) {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue
    let names
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const p = join(dir, name)
      let st
      try {
        st = lstatSync(p)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) return p
      try {
        readlinkSync(p)
        return p
      } catch {
        /* regular path */
      }
      if (st.isDirectory()) stack.push(p)
    }
  }
  return undefined
}

function copyFile(src, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}

function copyTree(src, dest, exclude, onFile) {
  let st
  try {
    st = lstatSync(src)
  } catch {
    return
  }
  if (st.isSymbolicLink()) return
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true })
    let names
    try {
      names = readdirSync(src)
    } catch {
      return
    }
    for (const name of names) {
      if (name === 'node_modules' || exclude.has(name)) continue
      copyTree(join(src, name), join(dest, name), exclude, onFile)
    }
    return
  }
  copyFile(src, dest)
  onFile(dest)
}

function copyPackageFiles(src, dest, onFile) {
  mkdirSync(dest, { recursive: true })
  let names
  try {
    names = readdirSync(src)
  } catch {
    return
  }
  for (const name of names) {
    if (name === 'node_modules') continue
    const from = join(src, name)
    const to = join(dest, name)
    let st
    try {
      st = lstatSync(from)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
    if (st.isDirectory()) copyPackageFiles(from, to, onFile)
    else {
      copyFile(from, to)
      onFile(to)
    }
  }
}

/**
 * Host platform tags for native binary packages (e.g. `@koromix/koffi-win32-x64`).
 * We only ship the host's native binaries so a foreign platform's `.node` files
 * never leak into the payload.
 */
const HOST_PLATFORM_TAG = `${process.platform}-${process.arch}`
const PLATFORM_TAG_RE =
  /(darwin|win32|linux|freebsd|openbsd)-(ia32|x64|arm64|riscv64|loong64)(?:\.(?:msvc|gnu|musl))?/

function packageHasForeignPlatformTag(name) {
  const match = PLATFORM_TAG_RE.exec(name)
  if (!match) return false
  return match[0].replace(/\.(?:msvc|gnu|musl)$/, '') !== HOST_PLATFORM_TAG
}

/**
 * pnpm lays every package into `<root>/node_modules/.pnpm/<name>@<version>/node_modules/<pkg>`.
 * The flatten's main walk skips entries starting with `.`, so transitive deps that are
 * only reachable through the virtual store (e.g. `readdirp` for chokidar) and native
 * platform binaries (e.g. `@koromix/koffi-win32-x64`) would be dropped, leaving a
 * payload that cannot boot `dsh web`. Traverse the store and fill those gaps.
 */
function collectFromPnpmStore(pnpmDir, packages, scanned) {
  let entries
  try {
    entries = readdirSync(pnpmDir)
  } catch {
    return
  }
  for (const entry of entries) {
    const entryDir = join(pnpmDir, entry)
    let st
    try {
      st = lstatSync(entryDir)
    } catch {
      continue
    }
    if (!st.isDirectory() || st.isSymbolicLink()) continue
    const nm = join(entryDir, 'node_modules')
    let pkgDirs
    try {
      pkgDirs = readdirSync(nm)
    } catch {
      continue
    }
    for (const part of pkgDirs) {
      const pkgDir = join(nm, part)
      let pkgSt
      try {
        pkgSt = lstatSync(pkgDir)
      } catch {
        continue
      }
      if (pkgSt.isSymbolicLink()) continue
      if (part.startsWith('@')) {
        let children
        try {
          children = readdirSync(pkgDir)
        } catch {
          continue
        }
        for (const child of children) {
          const childDir = join(pkgDir, child)
          let childSt
          try {
            childSt = lstatSync(childDir)
          } catch {
            continue
          }
          if (childSt.isSymbolicLink()) continue
          const rel = `${part}/${child}`
          if (packageHasForeignPlatformTag(rel)) continue
          addPackage(childDir, rel, packages, scanned)
        }
      } else {
        if (packageHasForeignPlatformTag(part)) continue
        addPackage(pkgDir, part, packages, scanned)
      }
    }
  }
}

function collectFromNodeModules(nm, packages, scanned) {
  let entries
  try {
    entries = readdirSync(nm)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const p = join(nm, entry)
    let st
    try {
      st = lstatSync(p)
    } catch {
      continue
    }
    if (entry.startsWith('@') && st.isDirectory() && !st.isSymbolicLink()) {
      let scoped
      try {
        scoped = readdirSync(p)
      } catch {
        continue
      }
      for (const child of scoped) addPackage(join(p, child), `${entry}/${child}`, packages, scanned)
      continue
    }
    addPackage(p, entry, packages, scanned)
  }
}

function addPackage(p, rel, packages, scanned) {
  let real
  try {
    real = realpathSync(p)
  } catch {
    return
  }
  if (scanned.has(real)) return
  scanned.add(real)
  if (!existsSync(join(real, 'package.json'))) return
  if (!packages.has(rel)) packages.set(rel, real)
  const nested = join(real, 'node_modules')
  if (existsSync(nested)) collectFromNodeModules(nested, packages, scanned)
}

function collectPackages(root, exclude) {
  const packages = new Map()
  const scanned = new Set()
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue
    let names
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (exclude.has(name) && name !== 'node_modules') continue
      const p = join(dir, name)
      let st
      try {
        st = lstatSync(p)
      } catch {
        continue
      }
      if (name === 'node_modules') {
        collectFromNodeModules(p, packages, scanned)
        const pnpm = join(p, '.pnpm')
        if (existsSync(pnpm)) collectFromPnpmStore(pnpm, packages, scanned)
        continue
      }
      if (st.isDirectory() && !st.isSymbolicLink()) stack.push(p)
    }
  }
  return packages
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {{ force?: boolean, extraXd?: string[], onProgress?: (files: number, path: string) => void }} [opts]
 * @returns {{ skipped: boolean, dest: string, stale?: string, files: number }}
 */
export function flattenHarness(src, dest, opts = {}) {
  if (!existsSync(src)) {
    throw new Error(`flattenHarness: missing source ${src}`)
  }
  const exclude = new Set(opts.extraXd ?? STAGE_EXCLUDE_DIRS)
  const complete =
    existsSync(join(dest, HARNESS_BIN)) &&
    existsSync(join(dest, HARNESS_WEB)) &&
    existsSync(join(dest, HARNESS_BOOT)) &&
    !findReparsePath(dest)
  if (complete && !opts.force) {
    return { skipped: true, dest, files: 0 }
  }

  let stale
  if (existsSync(dest)) {
    stale = `${dest}.stale-${Date.now()}`
    renameSync(dest, stale)
  }
  mkdirSync(dest, { recursive: true })

  let files = 0
  function onFile(path) {
    files += 1
    if (opts.onProgress) opts.onProgress(files, path)
    else if (files % 2000 === 0) process.stderr.write(`flatten: ${files} files (${path})\n`)
  }

  copyTree(src, dest, exclude, onFile)

  const packages = collectPackages(src, exclude)
  const hoistRoot = existsSync(join(dest, 'apps', 'cli'))
    ? join(dest, 'apps', 'cli', 'node_modules')
    : join(dest, 'node_modules')
  mkdirSync(hoistRoot, { recursive: true })
  for (const [rel, real] of packages) {
    copyPackageFiles(real, join(hoistRoot, ...rel.split('/')), onFile)
  }

  return stale ? { skipped: false, dest, stale, files } : { skipped: false, dest, files }
}
