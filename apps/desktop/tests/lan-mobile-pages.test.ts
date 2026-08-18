import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  renderDesktopPairingPage,
  renderMobilePage,
  renderPairingWaitPage,
} from '../src/mobile/lan-mobile-pages.ts'

describe('LAN mobile page', () => {
  it('emits parseable browser JavaScript', () => {
    const html = renderMobilePage({ locale: 'zh' })
    assert.match(html, /apple-mobile-web-app-capable/)
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!)
    assert.ok(scripts.length > 0)
    for (const script of scripts) assert.doesNotThrow(() => new Function(script))
  })

  it('uses DSH styling on pairing surfaces', () => {
    const desktop = renderDesktopPairingPage({
      qrSvg: '<svg></svg>',
      pairingUrl: 'http://192.168.1.2/pair?token=test',
      expiresAt: Date.now() + 60_000,
      locale: 'en',
      connected: false,
    })
    const phone = renderPairingWaitPage('pairing-id', 'en')
    for (const html of [desktop, phone]) {
      assert.match(html, /--brand:#4d6bfe/)
      for (const script of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (match) => match[1]!,
      )) {
        assert.doesNotThrow(() => new Function(script))
      }
    }
    assert.match(desktop, /Connect your phone/)
    assert.match(phone, /Approve this phone/)
  })

  it('localizes pairing surfaces', () => {
    const desktop = renderDesktopPairingPage({
      qrSvg: '<svg></svg>',
      pairingUrl: 'http://192.168.1.2/pair?token=test',
      expiresAt: Date.now() + 60_000,
      locale: 'zh',
      connected: false,
    })
    assert.match(desktop, /连接你的手机/)
    assert.match(renderPairingWaitPage('pairing-id', 'zh'), /请在 DSH Desktop 中确认连接请求/)
  })
})
