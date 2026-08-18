import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canGrantWindowPermission, isTrustedAppUrl } from '../src/security-policy.ts'

describe('navigation trust boundary', () => {
  it('only trusts the launcher and loopback HTTP pages', () => {
    assert.equal(isTrustedAppUrl('file:///app/index.html'), true)
    assert.equal(isTrustedAppUrl('http://127.0.0.1:43127'), true)
    assert.equal(isTrustedAppUrl('http://localhost:43127'), true)
    assert.equal(isTrustedAppUrl('https://127.0.0.1:43127'), false)
    assert.equal(isTrustedAppUrl('http://example.com'), false)
    assert.equal(isTrustedAppUrl('javascript:alert(1)'), false)
  })

  it('only grants clipboard writes from the trusted main frame', () => {
    assert.equal(
      canGrantWindowPermission('clipboard-sanitized-write', 'http://127.0.0.1:43127/session', true),
      true,
    )
    assert.equal(
      canGrantWindowPermission('clipboard-sanitized-write', 'http://localhost:43127/session', true),
      true,
    )
    assert.equal(
      canGrantWindowPermission('clipboard-read', 'http://127.0.0.1:43127/session', true),
      false,
    )
    assert.equal(
      canGrantWindowPermission(
        'clipboard-sanitized-write',
        'http://127.0.0.1:43127/session',
        false,
      ),
      false,
    )
    assert.equal(
      canGrantWindowPermission('clipboard-sanitized-write', 'https://example.com/session', true),
      false,
    )
    assert.equal(
      canGrantWindowPermission('clipboard-sanitized-write', 'file:///tmp/app.html', true),
      false,
    )
  })
})
