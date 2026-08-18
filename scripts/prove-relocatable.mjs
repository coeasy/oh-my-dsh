/**
 * Fail loud unless runtime/stage is a relocatable engine (relative launcher,
 * relative workspace link, dsh --version).
 */
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRelocatablePosixLauncher, isRelocatableWinLauncher } from './engine-launcher.mjs'
import { HARNESS_BIN, HARNESS_BOOT, harnessComplete } from './copy-harness.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stageArg = process.argv[2]
const stage = stageArg ? (isAbsolute(stageArg) ? stageArg : resolve(process.cwd(), stageArg)) : join(root, 'runtime', 'stage')
const launcherName = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
const launcher = join(stage, launcherName)
const harness = join(stage, 'harness')
const stagedBin = join(harness, HARNESS_BIN)
const bootPkg = join(harness, HARNESS_BOOT)

if (!existsSync(launcher) || !harnessComplete(harness)) {
  throw new Error(`prove-relocatable: incomplete engine at ${stage}`)
}

const text = readFileSync(launcher, 'utf8')
if (process.platform === 'win32') {
  if (!isRelocatableWinLauncher(text)) {
    throw new Error(`prove-relocatable: ${launcher} is not a relocatable launcher`)
  }
} else if (!isRelocatablePosixLauncher(text)) {
  throw new Error(`prove-relocatable: ${launcher} is not a relocatable launcher`)
}

if (lstatSync(bootPkg).isSymbolicLink()) {
  const target = readlinkSync(bootPkg)
  if (/[A-Za-z]:[\\/]/u.test(String(target))) {
    throw new Error(`prove-relocatable: workspace link is drive-absolute: ${target}`)
  }
}

const versioned = spawnSync(process.execPath, [stagedBin, '--version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30_000,
  cwd: dirname(stagedBin),
})
if (versioned.status !== 0) {
  const tail = `${versioned.stdout || ''}\n${versioned.stderr || ''}`.trim().slice(-1500)
  throw new Error(`prove-relocatable: dsh --version failed\n${tail}`)
}

const line = (versioned.stdout || '').trim().split(/\r?\n/u)[0]
console.log(`OK: relocatable ${launcher} → ${line}`)
