import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { waitForReady } from '../src/spawn-host.ts'

describe('waitForReady', () => {
  it('prefers the ready file over stdout', async () => {
    const ready = await waitForReady({
      readyFile: 'ready.json',
      stdoutBuffer: { text: 'dsh web: http://127.0.0.1:1111\n' },
      timeoutMs: 200,
      readFile: () => '{"url":"http://127.0.0.1:2222","port":2222,"host":"127.0.0.1","pid":1}',
    })
    assert.equal(ready.url, 'http://127.0.0.1:2222')
    assert.equal(ready.port, 2222)
  })

  it('falls back to stdout when the ready file is late', async () => {
    const ready = await waitForReady({
      readyFile: 'missing.json',
      stdoutBuffer: { text: 'dsh web: http://127.0.0.1:3088\n' },
      timeoutMs: 200,
      readFile: () => {
        throw new Error('ENOENT')
      },
    })
    assert.equal(ready.port, 3088)
  })

  it('fails fast when the child is already dead', async () => {
    await assert.rejects(
      () =>
        waitForReady({
          readyFile: 'missing.json',
          stdoutBuffer: { text: 'command not found: dsh\n' },
          timeoutMs: 5_000,
          readFile: () => {
            throw new Error('ENOENT')
          },
          isDead: () => ({ dead: true, detail: 'exit 1' }),
        }),
      /exited before ready: exit 1[\s\S]*command not found/,
    )
  })
})
