import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { launchHost } from '../src/spawn-host.ts'

function writeFakeDshLauncher(): { command: string; dir: string } {
  const scriptPath = fileURLToPath(new URL('../../../scripts/fake-dsh.mjs', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fake-bin-'))
  if (process.platform === 'win32') {
    const command = join(dir, 'dsh.cmd')
    writeFileSync(command, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8')
    return { command, dir }
  }
  const command = join(dir, 'dsh')
  writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, 'utf8')
  chmodSync(command, 0o755)
  return { command, dir }
}

describe('launchHost integration (fake-dsh)', () => {
  it('reaches loopback ready and stops on stdin EOF', async () => {
    const { command, dir } = writeFakeDshLauncher()
    let host: Awaited<ReturnType<typeof launchHost>> | undefined
    try {
      host = await launchHost({
        workspaceCwd: tmpdir(),
        mode: 'local',
        dshCommand: command,
        readyTimeoutMs: 8_000,
        env: { ...process.env, DSH_RUNTIME: 'local' },
      })
      assert.equal(host.url, 'http://127.0.0.1:41234')
      assert.equal(host.port, 41234)
      assert.ok(host.pid > 0)
      assert.ok(host.execPath)
    } finally {
      await host?.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reaches ready in bundled mode from an absolute launcher', async () => {
    const { command, dir } = writeFakeDshLauncher()
    try {
      const host = await launchHost({
        workspaceCwd: tmpdir(),
        mode: 'bundled',
        dshCommand: command,
        readyTimeoutMs: 8_000,
        env: { ...process.env, DSH_RUNTIME: 'bundled' },
      })
      assert.equal(host.url, 'http://127.0.0.1:41234')
      await host.stop()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('appends child output to logPath', async () => {
    const { command, dir } = writeFakeDshLauncher()
    const logPath = join(dir, 'harness.log')
    try {
      const host = await launchHost({
        workspaceCwd: tmpdir(),
        mode: 'local',
        dshCommand: command,
        readyTimeoutMs: 8_000,
        logPath,
        env: { ...process.env, DSH_RUNTIME: 'local' },
      })
      const started = Date.now()
      while (Date.now() - started < 1_000) {
        if (existsSync(logPath) && readFileSync(logPath, 'utf8').trim()) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await host.stop()
      const text = readFileSync(logPath, 'utf8')
      assert.match(text, /\[stdout\]|\[stderr\]|ready|127\.0\.0\.1/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails fast when the launcher is missing', async () => {
    const { command, dir } = writeFakeDshLauncher()
    rmSync(command, { force: true })
    try {
      await assert.rejects(
        () =>
          launchHost({
            workspaceCwd: tmpdir(),
            mode: 'local',
            dshCommand: command,
            readyTimeoutMs: 4_000,
            env: { ...process.env, DSH_RUNTIME: 'local' },
          }),
        /launcher missing|exited before ready|ENOENT|not found|找不到/i,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports launch stage progress in order', async () => {
    const { command, dir } = writeFakeDshLauncher()
    const stages: string[] = []
    let host: Awaited<ReturnType<typeof launchHost>> | undefined
    try {
      host = await launchHost({
        workspaceCwd: tmpdir(),
        mode: 'local',
        dshCommand: command,
        readyTimeoutMs: 8_000,
        env: { ...process.env, DSH_RUNTIME: 'local' },
        onProgress: (stage) => {
          stages.push(stage)
        },
      })
      assert.deepEqual(stages, ['resolving', 'spawning', 'waiting-ready', 'ready'])
      assert.equal(host.url, 'http://127.0.0.1:41234')
    } finally {
      await host?.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
