/**
 * One-shot delivery gate: unit+integration tests, layer audit, compile.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const steps = ['hygiene', 'typecheck', 'lint', 'format:check', 'test', 'verify:web-profile', 'audit:layers', 'compile']

for (const script of steps) {
  const result = spawnSync('pnpm', ['run', script], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('OK: pnpm verify (hygiene + test + audit:layers + compile)')
