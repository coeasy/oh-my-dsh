/**
 * Pack the VS Code / Cursor VSIX. Requires `pnpm compile:vscode` first.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs'
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

// Keep the command name identical across platforms. On Windows `pnpm` is a
// cmd shim, so shell execution is required; using `pnpm.cmd` here can make
// spawnSync return status=null without a useful diagnostic.
for (const name of readdirSync(extDir).filter((name) => name.endsWith('.vsix'))) {
  rmSync(join(extDir, name), { force: true })
}

const vsce = spawnSync(
  'pnpm',
  ['exec', 'vsce', 'package', '--no-dependencies', '--allow-missing-repository'],
  {
    cwd: extDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    timeout: 120_000,
  },
)

if (vsce.error || vsce.status !== 0) {
  const tail = `${vsce.stdout || ''}\n${vsce.stderr || ''}`.trim().slice(-2000)
  throw new Error(
    `vsce package failed (exit ${vsce.status ?? 'null'})${vsce.error ? `: ${vsce.error.message}` : ''}\n${tail}`,
  )
}

const vsix = readdirSync(extDir).filter((name) => name.endsWith('.vsix'))
if (vsix.length === 0) {
  throw new Error('vsce reported success but no .vsix was written under apps/vscode')
}
if (!vsix.some((name) => name.includes(version))) {
  throw new Error(`pack:vscode expected a ${version} VSIX, got ${vsix.join(', ')}`)
}

console.log((vsce.stdout || '').trim() || `OK: ${vsix.join(', ')}`)
