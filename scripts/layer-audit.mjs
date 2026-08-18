/**
 * Layer audit: Cordis plugin and client-runtime must not import vscode/electron.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  join(root, 'plugins', 'embedded-client', 'src', 'index.ts'),
  join(root, 'plugins', 'embedded-client', 'src', 'safe-path.ts'),
  join(root, 'packages', 'client-runtime', 'src', 'index.ts'),
  join(root, 'packages', 'client-runtime', 'src', 'spawn-host.ts'),
  join(root, 'packages', 'client-runtime', 'src', 'launcher-check.ts'),
  join(root, 'packages', 'client-runtime', 'src', 'download.ts'),
  join(root, 'packages', 'client-runtime', 'src', 'paths.ts'),
  join(root, 'packages', 'client-runtime', 'src', 'loopback.ts'),
  join(root, 'packages', 'client-runtime', 'src', 'patch.ts'),
  join(root, 'packages', 'client-runtime', 'src', 'shutdown.ts'),
  join(root, 'apps', 'desktop', 'src', 'launch-config.ts'),
  join(root, 'apps', 'desktop', 'src', 'status-tray.ts'),
  join(root, 'apps', 'desktop', 'src', 'quit-session.ts'),
  join(root, 'apps', 'desktop', 'src', 'window-chrome.ts'),
  join(root, 'apps', 'vscode', 'src', 'runtime-mode.ts'),
]

const forbidden = /from\s+['"](?:vscode|electron)['"]/
let failed = 0
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (forbidden.test(text)) {
    console.error(`FAIL: ${file} imports vscode or electron`)
    failed += 1
  }
}

const plugin = readFileSync(files[0], 'utf8')
if (/from\s+['"]@dsh\/client-runtime['"]/.test(plugin)) {
  console.error('FAIL: plugin imports @dsh/client-runtime (cycle)')
  failed += 1
}

if (failed) process.exit(1)
console.log(`OK: ${files.length} files have no vscode/electron imports`)
