import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import {
  shutdownLadder,
  killProcessTree,
  killExecutable,
  sameExecutablePath,
  engineStopPlan,
} from '../src/shutdown.ts'
import type { ChildLike } from '../src/types.ts'

class FakeChild extends EventEmitter implements ChildLike {
  pid = 42
  killed = false
  exitCode: number | null = null
  signals: string[] = []
  stdinEnded = false
  stdin = {
    end: () => {
      this.stdinEnded = true
    },
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM')
    if (signal === 'SIGKILL' || signal === 'SIGTERM') {
      this.killed = signal === 'SIGKILL'
      this.exitCode = 0
      this.emit('exit', 0, signal ?? null)
    }
    return true
  }
}

describe('shutdownLadder', () => {
  it('stops after stdin EOF if the child exits', async () => {
    const child = new FakeChild()
    const wait = async () => {
      child.exitCode = 0
      child.emit('exit', 0, null)
    }
    await shutdownLadder(child, { eofGraceMs: 20, termGraceMs: 20, wait })
    assert.equal(child.stdinEnded, true)
    assert.deepEqual(child.signals, [])
  })

  it('escalates EOF → SIGTERM → SIGKILL', async () => {
    const child = new FakeChild()
    child.kill = (signal?: NodeJS.Signals) => {
      child.signals.push(signal ?? 'SIGTERM')
      if (signal === 'SIGKILL') {
        child.killed = true
        child.exitCode = 1
        child.emit('exit', 1, 'SIGKILL')
      }
      return true
    }
    await shutdownLadder(child, {
      eofGraceMs: 5,
      termGraceMs: 5,
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    })
    assert.equal(child.stdinEnded, true)
    assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  })

  it('killProcessTree ignores non-positive pids', () => {
    killProcessTree(0)
    killProcessTree(-1)
  })

  it('killExecutable never targets the current process image', () => {
    killExecutable('')
    killExecutable('node.exe')
    killExecutable(process.execPath)
    assert.equal(sameExecutablePath(process.execPath, process.execPath), true)
    assert.equal(sameExecutablePath('C:\\App\\node.exe', 'c:/app/node.exe'), true)
  })

  it('tree-kills on Windows before any stdin wait', () => {
    assert.equal(engineStopPlan('win32'), 'tree-kill')
    assert.equal(engineStopPlan('linux'), 'ladder-then-tree')
    assert.equal(engineStopPlan('darwin'), 'ladder-then-tree')
  })

  it('does not shell out to PowerShell on Windows', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const text = readFileSync(fileURLToPath(new URL('../src/shutdown.ts', import.meta.url)), 'utf8')
    assert.doesNotMatch(text, /powershell\.exe/i)
  })
})
