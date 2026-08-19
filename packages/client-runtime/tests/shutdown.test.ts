import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { SpawnSyncReturns } from 'node:child_process'
import { describe, it } from 'node:test'
import {
  shutdownLadder,
  killProcessTree,
  killExecutable,
  killMatchingProcesses,
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
    // killExecutable must never scan via PowerShell (UI-thread block risk);
    // killMatchingProcesses may use it only as a wmic-missing fallback.
    const killExecutableSource = text.slice(
      text.indexOf('export function killExecutable'),
      text.indexOf('Strong reap'),
    )
    assert.doesNotMatch(killExecutableSource, /powershell/i)
  })
})

describe('killMatchingProcesses (Windows enumeration)', () => {
  type Call = { command: string; args: string[] }
  const ok = (stdout: string): SpawnSyncReturns<string> =>
    ({ status: 0, stdout, stderr: '', pid: 1, output: [stdout, ''], error: undefined }) as never
  const fail = (): SpawnSyncReturns<string> =>
    ({
      status: 1,
      stdout: '',
      stderr: 'not found',
      pid: 1,
      output: ['', ''],
      error: new Error('ENOENT'),
    }) as never

  function fakeRunner(responses: {
    wmic?: () => SpawnSyncReturns<string>
    powershell?: () => SpawnSyncReturns<string>
  }): { run: typeof import('node:child_process').spawnSync; calls: Call[] } {
    const calls: Call[] = []
    const run = ((command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] })
      if (command === 'wmic') return (responses.wmic ?? fail)()
      if (command === 'powershell') return (responses.powershell ?? fail)()
      return ok('')
    }) as never
    return { run, calls }
  }

  it('kills matching pids from wmic output and skips self', () => {
    const { run, calls } = fakeRunner({
      wmic: () =>
        ok(
          [
            'Node,CommandLine,ProcessId',
            'HOST,"node C:\\repo\\harness\\apps\\cli\\lib\\bin.js web --port 1",4321',
            `HOST,"node unrelated.js",${process.pid}`,
          ].join('\r\n'),
        ),
    })
    killMatchingProcesses(['apps/cli/lib/bin.js'], 'win32', 999, run)
    const kills = calls.filter((c) => c.command === 'taskkill')
    assert.equal(kills.length, 1)
    assert.deepEqual(kills[0].args, ['/pid', '4321', '/T', '/F'])
  })

  it('falls back to PowerShell when wmic is missing (Win11 24H2+)', () => {
    const { run, calls } = fakeRunner({
      wmic: () => fail(),
      powershell: () =>
        ok(
          ['4322\t"node" C:\\repo\\harness\\apps\\cli\\lib\\bin.js web', '5\tunrelated'].join(
            '\r\n',
          ),
        ),
    })
    killMatchingProcesses(['bin.js'], 'win32', 999, run)
    assert.equal(calls.filter((c) => c.command === 'wmic').length, 1)
    assert.equal(calls.filter((c) => c.command === 'powershell').length, 1)
    const kills = calls.filter((c) => c.command === 'taskkill')
    assert.equal(kills.length, 1)
    assert.deepEqual(kills[0].args, ['/pid', '4322', '/T', '/F'])
  })

  it('skips the self pid in the PowerShell fallback too', () => {
    const { run, calls } = fakeRunner({
      wmic: () => fail(),
      powershell: () => ok(`${process.pid}\tnode harness\\apps\\cli\\lib\\bin.js web`),
    })
    killMatchingProcesses(['bin.js'], 'win32', process.pid, run)
    assert.equal(calls.filter((c) => c.command === 'taskkill').length, 0)
  })
})
