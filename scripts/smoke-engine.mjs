/**
 * Boot a real `dsh web` through launchHost, then stop it.
 * Prefers runtime/stage (installer engine). If that is missing, wraps the
 * read-only DSH clone's built CLI so the Host path can be proven before packing.
 */
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchHost } from '../packages/client-runtime/src/spawn-host.ts'
import { defaultEngineRoot } from './engine-root.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stageLauncher = join(root, 'runtime', 'stage', process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
const cloneBin = join(defaultEngineRoot(root), 'apps', 'cli', 'lib', 'bin.js')
const pluginPath = join(root, 'plugins', 'embedded-client', 'out', 'index.js')

if (!existsSync(pluginPath)) {
  throw new Error(`smoke-engine: missing ${pluginPath} — run pnpm compile:plugin`)
}

const wrapDir = mkdtempSync(join(tmpdir(), 'dsh-engine-wrap-'))
let command = stageLauncher
let source = 'runtime/stage'

if (!existsSync(command)) {
  if (!existsSync(cloneBin)) {
    rmSync(wrapDir, { recursive: true, force: true })
    throw new Error(
      'smoke-engine: no staged runtime and no built DSH clone CLI. Run pnpm stage:runtime or build the clone.',
    )
  }
  source = 'clone wrapper'
  if (process.platform === 'win32') {
    command = join(wrapDir, 'dsh.cmd')
    writeFileSync(command, `@echo off\r\n"${process.execPath}" "${cloneBin}" %*\r\n`, 'utf8')
  } else {
    command = join(wrapDir, 'dsh')
    writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${cloneBin}" "$@"\n`, 'utf8')
    chmodSync(command, 0o755)
  }
}

const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-home-'))
const workspaceCwd = mkdtempSync(join(tmpdir(), 'dsh-smoke-ws-'))
console.log(`smoke-engine: ${source}\n  launcher ${command}`)

try {
  const host = await launchHost({
    workspaceCwd,
    mode: 'bundled',
    dshCommand: command,
    pluginPath,
    readyTimeoutMs: 180_000,
    env: {
      ...process.env,
      DSH_RUNTIME: 'bundled',
      DSH_HOME: home,
    },
  })
  console.log(`OK: dsh web ready at ${host.url} (pid ${host.pid})`)
  await host.stop()
  console.log('OK: host stopped')
  process.exit(0)
} finally {
  try {
    rmSync(wrapDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}
