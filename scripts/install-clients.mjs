/**
 * Install packed clients on this machine after a successful build.
 * Installs the newest apps/vscode/*.vsix into Cursor and/or VS Code when those
 * CLIs are on PATH. Prints desktop installer paths; does not silently run NSIS.
 *
 *   pnpm install:clients
 *   DSH_INSTALL_DESKTOP=1 pnpm install:clients   # also launch the NSIS setup
 */
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vscodeDir = join(root, 'apps', 'vscode')
const desktopDir = join(root, 'apps', 'desktop', 'dist-release')

function which(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(probe, [command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  })
  if (result.status !== 0) return ''
  const first = String(result.stdout || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
  return first || ''
}

function newest(dir, predicate) {
  if (!existsSync(dir)) return ''
  const names = readdirSync(dir).filter(predicate).sort()
  return names.length > 0 ? join(dir, names.at(-1)) : ''
}

const vsix = newest(vscodeDir, (name) => name.endsWith('.vsix'))
const hosts = ['cursor', 'code'].filter((name) => which(name))
let failed = false

if (!vsix) {
  console.warn('install-clients: no VSIX under apps/vscode — run pnpm pack:vscode or tools\\build-clients.cmd first')
} else if (hosts.length === 0) {
  console.warn(`install-clients: VSIX ready at ${vsix}`)
  console.warn('install-clients: neither `cursor` nor `code` is on PATH; install the VSIX from the editor UI')
} else {
  for (const host of hosts) {
    console.log(`install-clients: ${host} --install-extension ${vsix}`)
    const installed = spawnSync(host, ['--install-extension', vsix, '--force'], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: 'inherit',
      timeout: 120_000,
    })
    if (installed.status !== 0) {
      console.error(`install-clients: ${host} failed (exit ${installed.status})`)
      failed = true
    }
  }
}

const setup = newest(desktopDir, (name) => /^my-dsh-Setup-.*\.exe$/u.test(name))
const portable = newest(desktopDir, (name) => /portable\.exe$/u.test(name))
const zip = newest(desktopDir, (name) => name.endsWith('.zip'))
const dmg = newest(desktopDir, (name) => name.endsWith('.dmg'))
const appimage = newest(desktopDir, (name) => name.endsWith('.AppImage'))
if (setup || portable || zip || dmg || appimage) {
  console.log('install-clients: desktop artifacts')
  if (setup) console.log(`  NSIS     ${setup}`)
  if (portable) console.log(`  portable ${portable}`)
  if (zip) console.log(`  zip      ${zip}`)
  if (dmg) console.log(`  dmg      ${dmg}`)
  if (appimage) console.log(`  AppImage ${appimage}`)
}

if (setup && process.env.DSH_INSTALL_DESKTOP === '1') {
  console.log(`install-clients: launching ${setup}`)
  const launched = spawnSync(setup, [], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
    timeout: 600_000,
  })
  if (launched.status !== 0) {
    console.error(`install-clients: NSIS exited ${launched.status}`)
    failed = true
  }
} else if (setup) {
  console.log('install-clients: to run NSIS now, set DSH_INSTALL_DESKTOP=1')
}

if (!vsix && !setup && !portable && !zip && !dmg && !appimage) {
  throw new Error('install-clients: no packed artifacts found. Run ./tools/build-clients.sh or tools\\build-clients.cmd first.')
}

if (failed) process.exit(1)
console.log('OK: install-clients')
