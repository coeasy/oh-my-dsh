import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  bundledRuntimeNodePath,
  QUIT_BUDGET_MS,
  stoppingSnapshot,
  enginePidFile,
  readEnginePid,
  writeEnginePid,
  clearEnginePid,
} from '../src/quit-session.ts'

describe('quit session', () => {
  it('force-exits within a short budget', () => {
    assert.equal(QUIT_BUDGET_MS, 2000)
  })

  it('points at the bundled runtime node image', () => {
    assert.equal(
      bundledRuntimeNodePath('C:\\app\\resources', 'win32').replace(/\\/g, '/'),
      'C:/app/resources/runtime/node.exe',
    )
    assert.equal(bundledRuntimeNodePath('/app/resources', 'linux'), '/app/resources/runtime/node')
  })

  it('marks the snapshot as stopping', () => {
    assert.equal(stoppingSnapshot('zh', 'D:\\ws').phase, 'stopping')
    assert.match(stoppingSnapshot('zh').message, /退出/)
  })

  it('round-trips an engine pid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-engine-pid-'))
    try {
      assert.equal(readEnginePid(dir), 0)
      writeEnginePid(dir, 4242)
      assert.equal(readEnginePid(dir), 4242)
      assert.match(enginePidFile(dir).replace(/\\/g, '/'), /engine\.pid$/)
      clearEnginePid(dir)
      assert.equal(readEnginePid(dir), 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
