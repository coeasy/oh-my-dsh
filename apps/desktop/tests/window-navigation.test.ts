import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAbortedNavigationError, shouldLoadHarnessUrl } from '../src/window-navigation.ts'

describe('Harness window activation', () => {
  it('preserves the current page when the existing Harness instance is focused again', () => {
    assert.equal(
      shouldLoadHarnessUrl('http://127.0.0.1:43127/settings/models', 'http://127.0.0.1:43127'),
      false,
    )
  })

  it('loads the page for a new window or a restarted Harness instance', () => {
    assert.equal(shouldLoadHarnessUrl('about:blank', 'http://127.0.0.1:43127'), true)
    assert.equal(
      shouldLoadHarnessUrl('http://127.0.0.1:43127/settings', 'http://127.0.0.1:43128'),
      true,
    )
  })

  it('recognizes Electron navigation cancellation without hiding other load failures', () => {
    assert.equal(isAbortedNavigationError({ code: 'ERR_ABORTED', errno: -3 }), true)
    assert.equal(
      isAbortedNavigationError(new Error("ERR_ABORTED (-3) loading 'http://127.0.0.1:43127/'")),
      true,
    )
    assert.equal(isAbortedNavigationError({ code: 'ERR_CONNECTION_REFUSED', errno: -102 }), false)
  })
})
