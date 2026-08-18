/**
 * Build a link-free engine payload for the NSIS installer.
 * Reads the DSH clone (does not edit it). Output:
 *   runtime/payload/node.exe
 *   runtime/payload/dsh.cmd
 *   runtime/payload/origin.json
 *   runtime/payload/harness/   → flattened real files, no SYMLINKD
 *
 * Set DSH_ENGINE_ROOT to override the clone. Set DSH_PAYLOAD_FORCE=1 to rebuild.
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessComplete, STAGE_EXCLUDE_DIRS } from './copy-harness.mjs'
import { flattenHarness, findReparsePath } from './flatten-harness.mjs'
import { buildPosixLauncher, buildWinLauncher, isRelocatableWinLauncher } from './engine-launcher.mjs'
import { loadEngineLock } from './engine-lock.mjs'
import { defaultEngineRoot } from './engine-root.mjs'
import { loadProductVersion } from './product-version.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const engineRoot = defaultEngineRoot(root)
const payload = join(root, 'runtime', 'payload')
const harness = join(payload, 'harness')
const launcherName = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
const cloneBin = join(engineRoot, 'apps', 'cli', 'lib', 'bin.js')
const payloadBin = join(harness, 'apps', 'cli', 'lib', 'bin.js')
const webHtml = join(engineRoot, 'apps', 'web', 'dist', 'index.html')
const force = process.env.DSH_PAYLOAD_FORCE === '1'

function probeVersion(nodePath, scriptPath) {
  return spawnSync(nodePath, [scriptPath, '--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    cwd: dirname(scriptPath),
  })
}

function isComplete() {
  if (!existsSync(join(payload, launcherName))) return false
  if (!existsSync(join(payload, nodeName))) return false
  if (process.platform === 'win32') {
    const text = readFileSync(join(payload, launcherName), 'utf8')
    if (!isRelocatableWinLauncher(text)) return false
  }
  if (!harnessComplete(harness) || findReparsePath(harness)) return false
  return probeVersion(process.execPath, payloadBin).status === 0
}

if (!existsSync(cloneBin)) {
  throw new Error(
    `stage-payload: missing ${cloneBin} — build the DSH clone first (do not edit it)`,
  )
}
if (!existsSync(webHtml)) {
  throw new Error(
    `stage-payload: missing ${webHtml} — run pnpm run build:web in the DSH clone (read-only)`,
  )
}

function writeOrigin() {
  const lock = loadEngineLock(root)
  writeFileSync(
    join(payload, 'origin.json'),
    `${JSON.stringify(
      {
        relocatable: true,
        flattened: true,
        relativeBin: 'harness/apps/cli/lib/bin.js',
        clientVersion: loadProductVersion(root),
        repository: lock.repository,
        ref: lock.ref,
        node: process.version,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

if (isComplete() && !force) {
  writeOrigin()
  console.log(`OK: link-free payload already staged at ${payload}`)
  process.exit(0)
}

console.log(`Flattening harness ${engineRoot} → ${harness}`)
const flattened = flattenHarness(engineRoot, harness, { force, extraXd: STAGE_EXCLUDE_DIRS })
if (flattened.skipped) {
  console.log(`flatten skipped (already complete) at ${harness}`)
} else {
  console.log(`flatten wrote ${flattened.files} files`)
}

const reparse = findReparsePath(harness)
if (reparse) {
  throw new Error(`stage-payload: payload still has a reparse point: ${reparse}`)
}
if (!harnessComplete(harness)) {
  throw new Error(`stage-payload: flatten did not produce a complete harness at ${harness}`)
}

const nodeDest = join(payload, nodeName)
try {
  copyFileSync(process.execPath, nodeDest)
} catch (err) {
  if (!existsSync(nodeDest)) throw err
  console.warn(`stage-payload: keeping existing ${nodeDest} (${err})`)
}

writeFileSync(
  join(payload, launcherName),
  process.platform === 'win32' ? buildWinLauncher(nodeName) : buildPosixLauncher(nodeName),
  'utf8',
)
if (process.platform !== 'win32') chmodSync(join(payload, launcherName), 0o755)
writeOrigin()

const versioned = probeVersion(process.execPath, payloadBin)
if (versioned.status !== 0) {
  const tail = `${versioned.stdout || ''}\n${versioned.stderr || ''}`.trim().slice(-1500)
  throw new Error(`stage-payload: flattened dsh --version failed (exit ${versioned.status})\n${tail}`)
}

console.log(`OK: payload ${launcherName} → ${(versioned.stdout || '').trim().split(/\r?\n/u)[0]}`)
