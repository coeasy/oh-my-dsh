import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertLauncherUsable,
  buildWinDevLauncher,
  quotedWinPaths,
  resolveDirectSpawn,
} from '../src/launcher-check.ts'

describe('launcher usability', () => {
  it('rejects a cmd wrapper whose absolute bin.js is missing', () => {
    const command = 'C:\\app\\dsh.cmd'
    const stale =
      '@echo off\r\n"C:\\node.exe" "D:\\workspace\\deepseek_hre\\docs\\competitive-analysis\\deepseek-harness\\apps\\cli\\lib\\bin.js" %*\r\n'
    assert.match(
      quotedWinPaths(stale).join('\n'),
      /deepseek_hre\\docs\\competitive-analysis\\deepseek-harness/,
    )
    assert.throws(
      () =>
        assertLauncherUsable(command, {
          exists: (path) => path === command,
          read: () => stale,
        }),
      /stale engine launcher|missing .*bin\.js/,
    )
  })

  it('accepts a wrapper whose node and bin exist', () => {
    const command = 'D:\\ws\\runtime\\dev\\dsh.cmd'
    const node = 'D:\\ws\\node.exe'
    const bin = 'D:\\ws\\deepseek-harness\\apps\\cli\\lib\\bin.js'
    const text = buildWinDevLauncher(node, bin)
    assert.equal(
      assertLauncherUsable(command, {
        exists: (path) => path === command || path === node || path === bin,
        read: () => text,
      }),
      command,
    )
  })

  it('resolves a relocatable wrapper to node plus bin.js', () => {
    const command = 'C:\\app\\resources\\runtime\\dsh.cmd'
    const node = 'C:\\app\\resources\\runtime\\node.exe'
    const bin = 'C:\\app\\resources\\runtime\\harness\\apps\\cli\\lib\\bin.js'
    const io = {
      exists: (path: string) => path === command || path === node || path === bin,
      read: () => '',
    }
    assert.deepEqual(resolveDirectSpawn(command, io, 'win32'), { exec: node, prefixArgs: [bin] })
  })

  it('resolves a quoted absolute dev launcher without a shell', () => {
    const command = 'D:\\ws\\runtime\\dev\\dsh.cmd'
    const node = 'D:\\ws\\node.exe'
    const bin = 'D:\\ws\\deepseek-harness\\apps\\cli\\lib\\bin.js'
    const io = {
      exists: (path: string) => path === command || path === node || path === bin,
      read: () => buildWinDevLauncher(node, bin),
    }
    assert.deepEqual(resolveDirectSpawn(command, io, 'win32'), { exec: node, prefixArgs: [bin] })
  })

  it('resolves a quoted .mjs entry without a shell', () => {
    const command = 'D:\\ws\\runtime\\dev\\dsh.cmd'
    const node = 'D:\\ws\\node.exe'
    const bin = 'D:\\ws\\scripts\\fake-dsh.mjs'
    const io = {
      exists: (path: string) => path === command || path === node || path === bin,
      read: () => buildWinDevLauncher(node, bin),
    }
    assert.deepEqual(resolveDirectSpawn(command, io, 'win32'), { exec: node, prefixArgs: [bin] })
  })

  it('leaves PATH names on the shell', () => {
    assert.equal(
      resolveDirectSpawn('dsh', { exists: () => false, read: () => '' }, 'win32'),
      undefined,
    )
  })

  it('resolves a posix relocatable wrapper to node plus bin.js', () => {
    const command = '/app/resources/runtime/dsh'
    const node = '/app/resources/runtime/node'
    const bin = '/app/resources/runtime/harness/apps/cli/lib/bin.js'
    const io = {
      exists: (path: string) => path === command || path === node || path === bin,
      read: () => '',
    }
    assert.deepEqual(resolveDirectSpawn(command, io, 'linux'), { exec: node, prefixArgs: [bin] })
  })

  it('skips PATH names that are not absolute files', () => {
    assert.equal(assertLauncherUsable('dsh', { exists: () => false, read: () => '' }), 'dsh')
  })
})
