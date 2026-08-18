import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildPosixLauncher,
  buildWinLauncher,
  isRelocatablePosixLauncher,
  isRelocatableWinLauncher,
} from '../../../scripts/engine-launcher.mjs'

describe('engine launcher', () => {
  it('is relocatable: %~dp0 plus harness bin, no drive path', () => {
    const text = buildWinLauncher()
    assert.equal(isRelocatableWinLauncher(text), true)
    assert.match(text, /%~dp0node\.exe/)
    assert.match(text, /%~dp0harness\\apps\\cli\\lib\\bin\.js/)
  })

  it('rejects a clone-absolute wrapper', () => {
    const text =
      '@echo off\r\n"%~dp0node.exe" "D:\\workspace\\deepseek_hre\\docs\\competitive-analysis\\deepseek-harness\\apps\\cli\\lib\\bin.js" %*\r\n'
    assert.equal(isRelocatableWinLauncher(text), false)
  })

  it('posix launcher stays relative to $DIR', () => {
    const text = buildPosixLauncher()
    assert.equal(isRelocatablePosixLauncher(text), true)
    assert.match(text, /\$DIR\/node/)
    assert.match(text, /\$DIR\/harness\/apps\/cli\/lib\/bin\.js/)
  })
})
