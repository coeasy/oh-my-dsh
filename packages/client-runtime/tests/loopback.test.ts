import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertLoopbackUrl, isLoopbackHttpUrl } from '../src/loopback.ts'

describe('loopback', () => {
  it('accepts http://127.0.0.1 with an explicit port', () => {
    assert.equal(assertLoopbackUrl('http://127.0.0.1:4123'), 'http://127.0.0.1:4123')
    assert.equal(isLoopbackHttpUrl('http://127.0.0.1:4123'), true)
  })

  it('rejects localhost, https, IPv6, and missing port', () => {
    assert.throws(() => assertLoopbackUrl('http://localhost:4123'), /non-loopback/)
    assert.throws(() => assertLoopbackUrl('https://127.0.0.1:4123'), /non-http/)
    assert.throws(() => assertLoopbackUrl('http://[::1]:4123'), /non-loopback/)
    assert.throws(() => assertLoopbackUrl('http://127.0.0.1'), /without port/)
    assert.throws(() => assertLoopbackUrl('http://0.0.0.0:80'), /non-loopback/)
    assert.equal(isLoopbackHttpUrl('http://example.com:80'), false)
  })
})
