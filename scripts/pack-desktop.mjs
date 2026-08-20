/**
 * Pack a third-party desktop installer with a link-free bundled engine.
 * Flattens the DSH clone into runtime/payload so archive tools will not
 * follow workspace cycles. Writes to apps/desktop/dist-release.
 * Packs the current OS only: Windows NSIS/portable/zip, macOS dmg/zip,
 * Linux AppImage/zip. Requires `pnpm compile:desktop` first.
 * Set DSH_PACK_SKIP_INSTALLER=1 to only check compile artifacts.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appResourcesDir } from './app-resources-dir.mjs'
import {
  defaultClientScenarios,
  electronBuilderArgs,
  parseClientScenarios,
} from './client-scenarios.mjs'
import { isRelocatablePosixLauncher, isRelocatableWinLauncher } from './engine-launcher.mjs'
import { findReparsePath } from './flatten-harness.mjs'
import { assertAlignedVersions } from './product-version.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = join(root, 'apps', 'desktop')
const outDir = join(appDir, 'dist-release')
// May be redirected to an isolated build dir when a previous output is locked.
let electronOutDir = outDir
const version = assertAlignedVersions(root)
const platform = process.platform
const required = [
  join(appDir, 'out', 'main.js'),
  join(appDir, 'out', 'preload.cjs'),
  join(appDir, 'out', 'embedded-client.js'),
  join(appDir, 'splash.html'),
  join(appDir, 'package.json'),
  join(appDir, 'runtime.json'),
  join(appDir, 'electron-builder.yml'),
]

for (const file of required) {
  if (!existsSync(file)) {
    throw new Error(`pack:desktop missing ${file} — run pnpm compile:desktop`)
  }
}

if (process.env.DSH_PACK_SKIP_INSTALLER === '1') {
  console.log(
    'OK: Electron compile artifacts present; installer skipped (DSH_PACK_SKIP_INSTALLER=1)',
  )
  process.exit(0)
}

const payload = spawnSync(process.execPath, [join(root, 'scripts', 'stage-payload.mjs')], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 1_800_000,
  stdio: 'inherit',
  env: process.env,
})
if (payload.status !== 0) {
  throw new Error(`pack:desktop: stage-payload failed (exit ${payload.status})`)
}

const payloadRoot = join(root, 'runtime', 'payload')
const launcherName = platform === 'win32' ? 'dsh.cmd' : 'dsh'
const launcher = join(payloadRoot, launcherName)
const harness = join(payloadRoot, 'harness')
if (!existsSync(launcher) || !existsSync(join(harness, 'apps', 'cli', 'lib', 'bin.js'))) {
  throw new Error(`pack:desktop missing flattened engine ${launcher}`)
}
const reparse = findReparsePath(harness)
if (reparse) {
  throw new Error(`pack:desktop: payload still has a reparse point: ${reparse}`)
}

const proved = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'prove-relocatable.mjs'), payloadRoot],
  {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    stdio: 'inherit',
  },
)
if (proved.status !== 0) {
  throw new Error(`pack:desktop: payload engine is not relocatable (exit ${proved.status})`)
}

function desktopScenarioIds() {
  const raw = (process.env.DSH_ELECTRON_TARGETS || '').trim()
  const ids = parseClientScenarios(raw, platform).filter((id) => id !== 'vscode')
  return ids.length > 0 ? ids : defaultClientScenarios(platform).filter((id) => id !== 'vscode')
}

function unpackedAppOutDir() {
  if (platform === 'win32') return join(electronOutDir, 'win-unpacked')
  if (platform === 'linux') return join(electronOutDir, 'linux-unpacked')
  const macDirs = existsSync(electronOutDir)
    ? readdirSync(electronOutDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^mac(?:-|$)/u.test(entry.name))
        .map((entry) => join(electronOutDir, entry.name))
    : []
  for (const macDir of macDirs) {
    const app = readdirSync(macDir).find((name) => name.endsWith('.app'))
    if (app) return join(macDir, app, 'Contents')
  }
  throw new Error(`pack:desktop missing mac .app in ${macDirs.join(', ') || electronOutDir}`)
}

// Best-effort cleanup of leftover build dirs from interrupted runs. These are
// only our own intermediate dirs (a renamed unpack or an isolated build), never
// user files, so they are safe to remove.
function cleanLeftovers(excludeDir) {
  if (platform === 'darwin' || !existsSync(outDir)) return
  for (const entry of readdirSync(outDir)) {
    if (!/\.stale-/u.test(entry) && !/^build-\d+/u.test(entry)) continue
    const target = join(outDir, entry)
    // Never remove the current build target (when it is an isolated build-<ts>
    // dir) — that would delete the artifacts we just produced.
    if (excludeDir !== undefined && target === excludeDir) continue
    try {
      rmSync(target, { recursive: true, force: true })
      console.log(`pack:desktop: removed leftover ${entry}`)
    } catch (error) {
      console.warn(`pack:desktop: could not remove leftover ${entry}: ${String(error.code)}`)
    }
  }
}
// Pre-build sweep: clear any leftovers from previous runs.
cleanLeftovers()

// Redirect electron-builder to an isolated output dir when a previous
// win-unpacked is held open by another process (e.g. a file watcher), so a
// locked leftover cannot block the whole build.
let unpackedOut =
  platform === 'win32'
    ? join(electronOutDir, 'win-unpacked')
    : join(electronOutDir, 'linux-unpacked')
if (platform !== 'darwin' && existsSync(unpackedOut)) {
  const stale = `${unpackedOut}.stale-${Date.now()}`
  try {
    renameSync(unpackedOut, stale)
    console.log(`pack:desktop: renamed previous unpack to ${stale}`)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'EPERM' && code !== 'EACCES') throw error
    electronOutDir = join(outDir, `build-${Date.now()}`)
    unpackedOut =
      platform === 'win32'
        ? join(electronOutDir, 'win-unpacked')
        : join(electronOutDir, 'linux-unpacked')
    console.warn(
      `pack:desktop: ${stale} is locked (${code}); building into isolated ${electronOutDir}`,
    )
  }
}

const targets = desktopScenarioIds()
const builderArgs = electronBuilderArgs(targets, platform)
if (builderArgs.length === 0) {
  throw new Error(
    `pack:desktop: no electron-builder targets for ${platform} (${targets.join(',')})`,
  )
}
console.log(`pack:desktop: ${platform} ${builderArgs.join(' ')}`)
const packed = spawnSync(
  'pnpm',
  [
    'exec',
    'electron-builder',
    ...builderArgs,
    `-c.directories.output=${electronOutDir.replace(/\\/g, '/')}`,
    '--publish',
    'never',
  ],
  {
    cwd: appDir,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    timeout: 3_600_000,
    stdio: 'inherit',
  },
)

if (packed.status !== 0) {
  throw new Error(`electron-builder ${builderArgs.join(' ')} failed (exit ${packed.status})`)
}

const electronPlatformName = platform === 'darwin' ? 'darwin' : platform
const unpackedRuntime = join(appResourcesDir(unpackedAppOutDir(), electronPlatformName), 'runtime')
const unpackedLauncher = join(unpackedRuntime, launcherName)
if (!existsSync(unpackedLauncher)) {
  throw new Error(`pack:desktop missing unpacked launcher ${unpackedLauncher}`)
}
const launcherText = readFileSync(unpackedLauncher, 'utf8')
if (platform === 'win32' && !isRelocatableWinLauncher(launcherText)) {
  throw new Error(`pack:desktop unpacked launcher is not relocatable: ${unpackedLauncher}`)
}
if (platform !== 'win32' && !isRelocatablePosixLauncher(launcherText)) {
  throw new Error(`pack:desktop unpacked launcher is not relocatable: ${unpackedLauncher}`)
}
const unpackedReparse = findReparsePath(join(unpackedRuntime, 'harness'))
if (unpackedReparse) {
  throw new Error(`pack:desktop: unpacked harness still has a reparse point: ${unpackedReparse}`)
}
const unpacked = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'prove-relocatable.mjs'), unpackedRuntime],
  {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    stdio: 'inherit',
  },
)
if (unpacked.status !== 0) {
  throw new Error(`pack:desktop: unpacked runtime is not relocatable (exit ${unpacked.status})`)
}

const listed = existsSync(electronOutDir) ? readdirSync(electronOutDir) : []
function hasArtifact(predicate) {
  return listed.some((name) => predicate(name))
}

if (targets.includes('nsis') && !existsSync(join(electronOutDir, `my-dsh-Setup-${version}.exe`))) {
  throw new Error(`pack:desktop missing my-dsh-Setup-${version}.exe in ${electronOutDir}`)
}
if (
  targets.includes('portable') &&
  !existsSync(join(electronOutDir, `my-dsh-${version}-portable.exe`))
) {
  throw new Error(`pack:desktop missing my-dsh-${version}-portable.exe in ${electronOutDir}`)
}
if (targets.includes('zip')) {
  const zipName =
    platform === 'win32'
      ? `my-dsh-${version}-win.zip`
      : platform === 'darwin'
        ? `my-dsh-${version}-mac.zip`
        : `my-dsh-${version}-linux.zip`
  if (!hasArtifact((name) => name === zipName || name === `my-dsh-${version}-win.zip`)) {
    throw new Error(`pack:desktop missing ${zipName} in ${electronOutDir}`)
  }
}
if (
  targets.includes('dmg') &&
  !hasArtifact((name) => name.endsWith('.dmg') && name.includes(version))
) {
  throw new Error(`pack:desktop missing dmg for ${version} in ${electronOutDir}`)
}
if (
  targets.includes('appimage') &&
  !hasArtifact((name) => name.endsWith('.AppImage') && name.includes(version))
) {
  throw new Error(`pack:desktop missing AppImage for ${version} in ${electronOutDir}`)
}

const sums = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'checksum-release.mjs'), electronOutDir, version],
  {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    stdio: 'inherit',
  },
)
if (sums.status !== 0) {
  throw new Error(`pack:desktop: checksum-release failed (exit ${sums.status})`)
}
if (targets.includes('nsis'))
  console.log(`OK: NSIS installer ${join(electronOutDir, `my-dsh-Setup-${version}.exe`)}`)
if (targets.includes('portable')) {
  console.log(`OK: portable exe ${join(electronOutDir, `my-dsh-${version}-portable.exe`)}`)
}
if (targets.includes('zip')) console.log(`OK: zip in ${electronOutDir}`)
if (targets.includes('dmg')) console.log(`OK: dmg in ${electronOutDir}`)
if (targets.includes('appimage')) console.log(`OK: AppImage in ${electronOutDir}`)

// Post-build sweep: this run may have renamed a locked previous unpack to
// .stale-<ts> (or built into a fresh build-<ts>); clear those leftovers now
// so a successful pack leaves no debris behind.
cleanLeftovers(electronOutDir)
