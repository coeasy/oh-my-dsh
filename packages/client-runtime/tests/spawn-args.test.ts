import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildWebArgs, normalizeDshCommand, quoteWinArg, spawnArgv } from '../src/spawn-args.ts'

describe('spawn-args', () => {
  it('quotes Windows args that contain spaces', () => {
    assert.equal(
      quoteWinArg('C:\\Program Files\\dsh\\cordis.patch.yml'),
      '"C:\\Program Files\\dsh\\cordis.patch.yml"',
    )
    assert.equal(quoteWinArg('--port'), '--port')
    assert.deepEqual(spawnArgv(['web', '--patch', 'D:\\My Patches\\a.yml'], 'win32'), [
      'web',
      '--patch',
      '"D:\\My Patches\\a.yml"',
    ])
    assert.deepEqual(spawnArgv(['web', '--port', '0'], 'linux'), ['web', '--port', '0'])
  })

  it('maps bare dsh to dsh.cmd on Windows only', () => {
    assert.equal(normalizeDshCommand('dsh', 'win32'), 'dsh.cmd')
    assert.equal(normalizeDshCommand('C:\\tools\\dsh', 'win32'), 'C:\\tools\\dsh.cmd')
    assert.equal(normalizeDshCommand('C:\\tools\\dsh.cmd', 'win32'), 'C:\\tools\\dsh.cmd')
    assert.equal(normalizeDshCommand('dsh', 'linux'), 'dsh')
  })

  it('quotes Windows commands that contain spaces', () => {
    assert.equal(
      quoteWinArg(normalizeDshCommand('C:\\Program Files\\dsh', 'win32')),
      '"C:\\Program Files\\dsh.cmd"',
    )
  })

  it('locks web to loopback port 0 plus the embedded-client patch', () => {
    const args = buildWebArgs('D:\\ws\\plugins\\embedded-client\\cordis.patch.yml')
    assert.deepEqual(args.slice(0, 3), [
      'web',
      '--patch',
      'D:\\ws\\plugins\\embedded-client\\cordis.patch.yml',
    ])
    assert.deepEqual(args.slice(3, 7), ['--host', '127.0.0.1', '--port', '0'])
  })
})
