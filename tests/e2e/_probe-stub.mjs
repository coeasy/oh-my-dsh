/** Quick probe: wrapper→stub→ready contract via launchHost (no Electron). */
import { mkdtempSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchHost } from '../../packages/client-runtime/src/spawn-host.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const stubEngine = join(root, 'tests', 'e2e', 'desktop-stub-engine.mjs')
const dir = mkdtempSync(join(tmpdir(), 'stub-probe-'))
const workspace = join(dir, 'ws')
mkdirSync(workspace, { recursive: true })
const exe = join(dir, 'dsh.cmd')
writeFileSync(
  exe,
  `@echo off\r\n"${process.execPath}" "${stubEngine}" %*\r\n`,
  'utf8',
)
console.log('exe:', exe)
try {
  const host = await launchHost({
    workspaceCwd: workspace,
    mode: 'local',
    dshCommand: exe,
    readyTimeoutMs: 15_000,
    env: { ...process.env, DSH_RUNTIME: 'local' },
    pluginPath: join(root, 'plugins', 'embedded-client', 'out', 'index.js'),
    onProgress: (stage, detail) => console.log('  stage:', stage, detail ?? ''),
  })
  console.log('READY url =', host.url, 'port =', host.port, 'pid =', host.pid)
  await host.stop()
  console.log('STOPPED OK')
  process.exit(0)
} catch (error) {
  console.error('FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
}