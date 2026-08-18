import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseReadyFile, parseStdoutUrl, urlToPort } from '../src/parse.ts'

describe('parse', () => {
  it('parses a ready file payload', () => {
    const payload = parseReadyFile(
      '{"url":"http://127.0.0.1:4123","host":"127.0.0.1","port":4123,"pid":99}\n',
    )
    assert.equal(payload.url, 'http://127.0.0.1:4123')
    assert.equal(payload.port, 4123)
    assert.equal(payload.pid, 99)
  })

  it('rejects a ready file without url/port', () => {
    assert.throws(() => parseReadyFile('{"pid":1}'), /missing url\/port/)
  })

  it('rejects a ready file that is not 127.0.0.1', () => {
    assert.throws(
      () => parseReadyFile('{"url":"http://10.0.0.8:80","host":"10.0.0.8","port":80,"pid":1}'),
      /non-loopback/,
    )
  })

  it('extracts dsh web stdout URL', () => {
    const url = parseStdoutUrl('boot ok\ndsh web: http://127.0.0.1:3080\n')
    assert.equal(url, 'http://127.0.0.1:3080')
    assert.equal(urlToPort(url!), 3080)
  })

  it('ignores unrelated stdout', () => {
    assert.equal(parseStdoutUrl('listening on 0.0.0.0:80'), undefined)
  })
})
