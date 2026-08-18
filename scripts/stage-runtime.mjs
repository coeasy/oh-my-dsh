/**
 * Copy a relocatable DSH engine tree + portable Node into runtime/stage.
 * Reads the DSH clone (does not edit it). Workspace packages are relative
 * SYMLINKD entries; robocopy /SL copies those links instead of following them.
 *
 * Layout:
 *   runtime/stage/node.exe
 *   runtime/stage/dsh.cmd          → %~dp0node.exe %~dp0harness\apps\cli\lib\bin.js
 *   runtime/stage/harness\         → clone copy (relative SYMLINKD intact)
 *
 * Set DSH_ENGINE_ROOT to override the clone. Set DSH_STAGE_FORCE=1 to recopy.
 * Set DSH_STAGE_MATERIALIZE=1 to replace SYMLINKD with real copies (optional).
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyHarnessFresh, harnessComplete, STAGE_EXCLUDE_DIRS } from './copy-harness.mjs'
import { buildPosixLauncher, buildWinLauncher, isRelocatableWinLauncher } from './engine-launcher.mjs'
import { materializeLinks } from './materialize-links.mjs'
import { defaultEngineRoot } from './engine-root.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const engineRoot = defaultEngineRoot(root)
const stage = join(root, 'runtime', 'stage')
const harness = join(stage, 'harness')
const launcherName = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
const cloneBin = join(engineRoot, 'apps', 'cli', 'lib', 'bin.js')
const stagedBin = join(harness, 'apps', 'cli', 'lib', 'bin.js')
const webHtml = join(engineRoot, 'apps', 'web', 'dist', 'index.html')
const bootPkg = join(harness, 'apps', 'cli', 'node_modules', '@deepseek-ai', 'dsh-app-boot')
const force = process.env.DSH_STAGE_FORCE === '1'

function stillHasWorkspaceLink() {
  if (!existsSync(bootPkg)) return true
  return lstatSync(bootPkg).isSymbolicLink()
}

function probeVersion(nodePath, scriptPath) {
  return spawnSync(nodePath, [scriptPath, '--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    cwd: dirname(scriptPath),
  })
}

function isComplete() {
  if (!existsSync(join(stage, launcherName))) return false
  if (!existsSync(join(stage, nodeName))) return false
  if (process.platform === 'win32') {
    const text = readFileSync(join(stage, launcherName), 'utf8')
    if (!isRelocatableWinLauncher(text)) return false
  }
  return harnessComplete(harness) && probeVersion(process.execPath, stagedBin).status === 0
}

function copyHarness() {
  copyHarnessFresh(engineRoot, harness, { force, extraXd: STAGE_EXCLUDE_DIRS })
}

if (!existsSync(cloneBin)) {
  throw new Error(
    `stage-runtime: missing ${cloneBin} — build the DSH clone first (do not edit it): pnpm build in ${engineRoot}`,
  )
}
if (!existsSync(webHtml)) {
  throw new Error(
    `stage-runtime: missing ${webHtml} — run pnpm run build:web in the DSH clone (read-only; do not edit sources)`,
  )
}

const cloneVersion = probeVersion(process.execPath, cloneBin)
if (cloneVersion.status !== 0) {
  const tail = `${cloneVersion.stdout || ''}\n${cloneVersion.stderr || ''}`.trim().slice(-1500)
  throw new Error(`stage-runtime: clone dsh --version failed\n${tail}`)
}

if (isComplete() && !force) {
  console.log(`OK: relocatable runtime already staged at ${stage}`)
  process.exit(0)
}

mkdirSync(stage, { recursive: true })
if (!existsSync(stagedBin) || force) {
  console.log(`Copying relocatable harness ${engineRoot} → ${harness}`)
  copyHarness()
} else {
  console.log(`Keeping existing harness copy at ${harness}`)
}

if (!existsSync(stagedBin)) {
  throw new Error(`stage-runtime: copy did not produce ${stagedBin}`)
}

const nodeDest = join(stage, nodeName)
if (!existsSync(nodeDest) || force) {
  try {
    copyFileSync(process.execPath, nodeDest)
  } catch (err) {
    if (!existsSync(nodeDest)) throw err
    console.warn(`stage-runtime: keeping existing ${nodeDest} (${err})`)
  }
}

writeFileSync(
  join(stage, launcherName),
  process.platform === 'win32' ? buildWinLauncher(nodeName) : buildPosixLauncher(nodeName),
  'utf8',
)
if (process.platform !== 'win32') chmodSync(join(stage, launcherName), 0o755)

if (process.env.DSH_STAGE_MATERIALIZE === '1' && stillHasWorkspaceLink()) {
  console.log('Materializing workspace SYMLINKD into real directories (cycle-safe)')
  const n = materializeLinks(harness)
  console.log(`materialize: replaced ${n} links`)
}

writeFileSync(
  join(stage, 'origin.json'),
  `${JSON.stringify(
    {
      relocatable: true,
      materialized: process.env.DSH_STAGE_MATERIALIZE === '1',
      relativeBin: 'harness/apps/cli/lib/bin.js',
    },
    null,
    2,
  )}\n`,
  'utf8',
)

const versioned = probeVersion(process.execPath, stagedBin)
if (versioned.status !== 0) {
  const tail = `${versioned.stdout || ''}\n${versioned.stderr || ''}`.trim().slice(-1500)
  throw new Error(`stage-runtime: staged harness dsh --version failed (exit ${versioned.status})\n${tail}`)
}

if (!existsSync(bootPkg)) {
  throw new Error(`stage-runtime: missing ${bootPkg} after copy`)
}

console.log(`OK: staged relocatable ${launcherName} → ${(versioned.stdout || '').trim().split(/\r?\n/u)[0]}`)
