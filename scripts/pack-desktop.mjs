/**
 * Pack a third-party desktop installer with a link-free bundled engine.
 * Flattens the DSH clone into runtime/payload so archive tools will not
 * follow workspace cycles. Writes to apps/desktop/dist-release.
 * Packs the current OS only: Windows NSIS/portable/zip, macOS dmg/zip,
 * Linux AppImage/zip. Requires `pnpm compile:desktop` first.
 * Set DSH_PACK_SKIP_INSTALLER=1 to only check compile artifacts.
 */
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appResourcesDir } from './app-resources-dir.mjs'
import { defaultClientScenarios, electronBuilderArgs, parseClientScenarios } from './client-scenarios.mjs'
import { isRelocatablePosixLauncher, isRelocatableWinLauncher } from './engine-launcher.mjs'
import { findReparsePath } from './flatten-harness.mjs'
import { assertAlignedVersions } from './product-version.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = join(root, 'apps', 'desktop')
const outDir = join(appDir, 'dist-release')
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
  console.log('OK: Electron compile artifacts present; installer skipped (DSH_PACK_SKIP_INSTALLER=1)')
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

const proved = spawnSync(process.execPath, [join(root, 'scripts', 'prove-relocatable.mjs'), payloadRoot], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 60_000,
  stdio: 'inherit',
})
if (proved.status !== 0) {
  throw new Error(`pack:desktop: payload engine is not relocatable (exit ${proved.status})`)
}

function desktopScenarioIds() {
  const raw = (process.env.DSH_ELECTRON_TARGETS || '').trim()
  const ids = parseClientScenarios(raw, platform).filter((id) => id !== 'vscode')
  return ids.length > 0 ? ids : defaultClientScenarios(platform).filter((id) => id !== 'vscode')
}

function unpackedAppOutDir() {
  if (platform === 'win32') return join(outDir, 'win-unpacked')
  if (platform === 'linux') return join(outDir, 'linux-unpacked')
  const macDir = join(outDir, 'mac')
  const app = existsSync(macDir) ? readdirSync(macDir).find((name) => name.endsWith('.app')) : ''
  if (!app) throw new Error(`pack:desktop missing mac .app in ${macDir}`)
  return join(macDir, app, 'Contents')
}

const unpackedOut = platform === 'win32' ? join(outDir, 'win-unpacked') : join(outDir, 'linux-unpacked')
if (platform !== 'darwin' && existsSync(unpackedOut)) {
  const stale = `${unpackedOut}.stale-${Date.now()}`
  try {
    renameSync(unpackedOut, stale)
    console.log(`pack:desktop: renamed previous unpack to ${stale}`)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'EPERM' && code !== 'EACCES') throw error
    throw new Error(
      `pack:desktop: ${unpackedOut} is locked (${code}). Close the previous pack output, then retry.`,
      { cause: error },
    )
  }
}

const targets = desktopScenarioIds()
const builderArgs = electronBuilderArgs(targets, platform)
if (builderArgs.length === 0) {
  throw new Error(`pack:desktop: no electron-builder targets for ${platform} (${targets.join(',')})`)
}
console.log(`pack:desktop: ${platform} ${builderArgs.join(' ')}`)
const packed = spawnSync(
  'pnpm',
  ['exec', 'electron-builder', ...builderArgs, '-c.directories.output=dist-release', '--publish', 'never'],
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
const unpacked = spawnSync(process.execPath, [join(root, 'scripts', 'prove-relocatable.mjs'), unpackedRuntime], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 60_000,
  stdio: 'inherit',
})
if (unpacked.status !== 0) {
  throw new Error(`pack:desktop: unpacked runtime is not relocatable (exit ${unpacked.status})`)
}

const listed = existsSync(outDir) ? readdirSync(outDir) : []
function hasArtifact(predicate) {
  return listed.some((name) => predicate(name))
}

if (targets.includes('nsis') && !existsSync(join(outDir, `my-dsh-Setup-${version}.exe`))) {
  throw new Error(`pack:desktop missing my-dsh-Setup-${version}.exe in ${outDir}`)
}
if (targets.includes('portable') && !existsSync(join(outDir, `my-dsh-${version}-portable.exe`))) {
  throw new Error(`pack:desktop missing my-dsh-${version}-portable.exe in ${outDir}`)
}
if (targets.includes('zip')) {
  const zipName =
    platform === 'win32'
      ? `my-dsh-${version}-win.zip`
      : platform === 'darwin'
        ? `my-dsh-${version}-mac.zip`
        : `my-dsh-${version}-linux.zip`
  if (!hasArtifact((name) => name === zipName || name === `my-dsh-${version}-win.zip`)) {
    throw new Error(`pack:desktop missing ${zipName} in ${outDir}`)
  }
}
if (targets.includes('dmg') && !hasArtifact((name) => name.endsWith('.dmg') && name.includes(version))) {
  throw new Error(`pack:desktop missing dmg for ${version} in ${outDir}`)
}
if (targets.includes('appimage') && !hasArtifact((name) => name.endsWith('.AppImage') && name.includes(version))) {
  throw new Error(`pack:desktop missing AppImage for ${version} in ${outDir}`)
}

const sums = spawnSync(process.execPath, [join(root, 'scripts', 'checksum-release.mjs'), outDir, version], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 120_000,
  stdio: 'inherit',
})
if (sums.status !== 0) {
  throw new Error(`pack:desktop: checksum-release failed (exit ${sums.status})`)
}
if (targets.includes('nsis')) console.log(`OK: NSIS installer ${join(outDir, `my-dsh-Setup-${version}.exe`)}`)
if (targets.includes('portable')) {
  console.log(`OK: portable exe ${join(outDir, `my-dsh-${version}-portable.exe`)}`)
}
if (targets.includes('zip')) console.log(`OK: zip in ${outDir}`)
if (targets.includes('dmg')) console.log(`OK: dmg in ${outDir}`)
if (targets.includes('appimage')) console.log(`OK: AppImage in ${outDir}`)
