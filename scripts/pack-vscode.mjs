/**
 * Pack the VS Code / Cursor VSIX. Requires `pnpm compile:vscode` first.
 */
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertAlignedVersions } from './product-version.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = assertAlignedVersions(root)
const extDir = join(root, 'apps', 'vscode')
const required = [
  join(extDir, 'out', 'extension.js'),
  join(extDir, 'out', 'embedded-client.js'),
  join(extDir, 'package.json'),
  join(extDir, 'LICENSE'),
]

for (const file of required) {
  if (!existsSync(file)) {
    throw new Error(`pack:vscode missing ${file} — run pnpm compile:vscode`)
  }
}

const vsce = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vsce', 'package', '--no-dependencies', '--allow-missing-repository'],
  {
    cwd: extDir,
    encoding: 'utf8',
    // pnpm.cmd is a Windows command shim and must be launched through the
    // shell on Windows; direct spawn otherwise exits with status === null.
    shell: process.platform === 'win32',
    windowsHide: true,
    timeout: 120_000,
  },
)

if (vsce.status !== 0) {
  const tail = `${vsce.stdout || ''}\n${vsce.stderr || ''}`.trim().slice(-2000)
  throw new Error(`vsce package failed (exit ${vsce.status})\n${tail}`)
}

const vsix = readdirSync(extDir).filter((name) => name.endsWith('.vsix'))
if (vsix.length === 0) {
  throw new Error('vsce reported success but no .vsix was written under apps/vscode')
}
if (!vsix.some((name) => name.includes(version))) {
  throw new Error(`pack:vscode expected a ${version} VSIX, got ${vsix.join(', ')}`)
}

console.log((vsce.stdout || '').trim() || `OK: ${vsix.join(', ')}`)
