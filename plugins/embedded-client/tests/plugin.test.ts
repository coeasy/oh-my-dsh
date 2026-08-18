import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { apply, buildReadyPayload, writeReadyFile } from '../src/index.ts'

describe('embedded-client plugin', () => {
  it('builds a loopback ready payload', () => {
    const payload = buildReadyPayload(
      { webServer: { host: '127.0.0.1', port: 4555 } },
      { workspaceCwd: 'D:\\ws' },
    )
    assert.equal(payload.url, 'http://127.0.0.1:4555')
    assert.equal(payload.port, 4555)
    assert.equal(payload.workspaceCwd, 'D:\\ws')
  })

  it('fails loud on a non-loopback bind', () => {
    assert.throws(
      () => buildReadyPayload({ webServer: { host: '0.0.0.0', port: 8080 } }),
      /non-loopback/,
    )
  })

  it('fails loud when the port is unbound', () => {
    assert.throws(
      () => buildReadyPayload({ webServer: { host: '127.0.0.1', port: 0 } }),
      /not bound/,
    )
  })

  it('fails loud without a ready path', () => {
    const ctx = {
      webServer: { host: '127.0.0.1', port: 9 },
      on() {},
    }
    delete process.env.DSH_READY_FILE
    assert.throws(() => apply(ctx, {}), /DSH_READY_FILE/)
  })

  it('writes ready files only under tmpdir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-ready-'))
    const file = join(dir, 'ready.json')
    writeReadyFile(file, buildReadyPayload({ webServer: { host: '127.0.0.1', port: 9 } }))
    const body = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(body.url, 'http://127.0.0.1:9')
    rmSync(dir, { recursive: true, force: true })
    assert.throws(() => writeReadyFile('ready.json', body), /must be absolute/)
    assert.throws(
      () => writeReadyFile(join(tmpdir(), '..', 'Windows', 'dsh-ready.json'), body),
      /escapes tmpdir/,
    )
  })

  it('does not import vscode or electron', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const safe = readFileSync(new URL('../src/safe-path.ts', import.meta.url), 'utf8')
    for (const text of [src, safe]) {
      assert.doesNotMatch(text, /from ['"]vscode['"]/)
      assert.doesNotMatch(text, /from ['"]electron['"]/)
      assert.doesNotMatch(text, /from ['"]@dsh\/client-runtime['"]/)
    }
  })
})
