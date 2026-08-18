import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { panelHtml, WEBVIEW_CSP } from '../src/panel.ts'

describe('vscode webview panel', () => {
  it('embeds loopback iframe with frame-src CSP', () => {
    const html = panelHtml('http://127.0.0.1:4123')
    assert.match(html, /frame-src http:\/\/127\.0\.0\.1:\*/)
    assert.match(html, /iframe src="http:\/\/127\.0\.0\.1:4123"/)
    assert.equal(WEBVIEW_CSP.includes('frame-src http://127.0.0.1:*'), true)
  })

  it('refuses non-loopback URLs before writing HTML', () => {
    assert.throws(() => panelHtml('http://192.168.1.8:80'), /non-loopback/)
    assert.throws(() => panelHtml('http://localhost:4123'), /non-loopback/)
    assert.throws(() => panelHtml('https://127.0.0.1:4123'), /non-loopback/)
  })
})
