import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { guardPageHtml } from '../src/plugins/degeneration-guard-ui-page.ts'
import { modelConfigPageHtml } from '../src/plugins/model-config-ui-page.ts'

describe('model-config UI host page', () => {
  it('generates a mountable page with CSP', () => {
    const html = modelConfigPageHtml('/assets/model-config/bundle.js')
    assert.ok(html.includes('model-config-root'))
    assert.ok(html.includes('Content-Security-Policy'))
    assert.ok(html.includes('__MODEL_CONFIG_HOST_BRIDGE__'))
    assert.ok(html.includes('__MODEL_CONFIG_MOUNT__'))
    assert.ok(html.includes('/assets/model-config/bundle.js'))
  })

  it('escapes bundle path quotes', () => {
    const html = modelConfigPageHtml('/x"y.js')
    assert.ok(!html.includes('/x"y.js'))
    assert.ok(html.includes('&quot;'))
  })

  it('rejects an invalid nonce', () => {
    assert.throws(() => modelConfigPageHtml('/a.js', 'bad'))
  })
})

describe('degeneration-guard UI host page', () => {
  it('generates a mountable page with CSP', () => {
    const html = guardPageHtml('/assets/guard/bundle.js')
    assert.ok(html.includes('guard-root'))
    assert.ok(html.includes('Content-Security-Policy'))
    assert.ok(html.includes('__GUARD_HOST_BRIDGE__'))
    assert.ok(html.includes('__GUARD_MOUNT__'))
    assert.ok(html.includes('/assets/guard/bundle.js'))
  })

  it('escapes bundle path quotes', () => {
    const html = guardPageHtml('/x"y.js')
    assert.ok(!html.includes('/x"y.js'))
    assert.ok(html.includes('&quot;'))
  })

  it('rejects an invalid nonce', () => {
    assert.throws(() => guardPageHtml('/a.js', 'bad'))
  })
})
