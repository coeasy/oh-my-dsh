/**
 * Build the fetched DeepSeek Harness clone in place. Does not edit kernel
 * sources: only pnpm install + documented build scripts.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultEngineRoot } from './engine-root.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = defaultEngineRoot(root)
const pkg = join(dest, 'package.json')
if (!existsSync(pkg)) {
  throw new Error(`build-engine: missing ${pkg} — run pnpm fetch:engine first`)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: dest,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: 'inherit',
    timeout: 3_600_000,
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`build-engine: ${command} ${args.join(' ')} failed (exit ${result.status})`)
  }
}

run('pnpm', ['install', '--frozen-lockfile'])
run('pnpm', ['run', 'build'])
const web = spawnSync('pnpm', ['run', 'build:web'], {
  cwd: dest,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  windowsHide: true,
  stdio: 'inherit',
  timeout: 1_800_000,
  env: process.env,
})
if (web.status !== 0) {
  const alt = spawnSync('pnpm', ['--filter', '@deepseek-ai/dsh-web', 'run', 'build'], {
    cwd: dest,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: 'inherit',
    timeout: 1_800_000,
    env: process.env,
  })
  if (alt.status !== 0) {
    throw new Error(`build-engine: web build failed (exit ${web.status})`)
  }
}

const bin = join(dest, 'apps', 'cli', 'lib', 'bin.js')
const html = join(dest, 'apps', 'web', 'dist', 'index.html')
if (!existsSync(bin)) throw new Error(`build-engine: missing ${bin}`)
if (!existsSync(html)) throw new Error(`build-engine: missing ${html}`)
console.log(`OK: engine built at ${dest}`)
