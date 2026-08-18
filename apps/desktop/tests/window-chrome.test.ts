import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  desktopChromeOptions,
  FILL_VIEWPORT_CSS,
  HARNESS_WINDOW_TITLE,
  TITLE_BAR_OVERLAY_HEIGHT,
} from '../src/window-chrome.ts'

describe('desktop window chrome', () => {
  it('keeps DeepSeek Harness as the window identity without a title-text bar', () => {
    const chrome = desktopChromeOptions(true)
    assert.equal(chrome.title, HARNESS_WINDOW_TITLE)
    assert.equal(chrome.title, 'DeepSeek Harness')
    assert.equal(chrome.autoHideMenuBar, true)
    assert.equal(chrome.titleBarStyle, 'hidden')
    assert.equal(chrome.titleBarOverlay.height, TITLE_BAR_OVERLAY_HEIGHT)
    assert.match(FILL_VIEWPORT_CSS, /height: 100%/)
  })

  it('matches light and dark caption colors to the shell', () => {
    assert.equal(desktopChromeOptions(false).backgroundColor, '#f8f8f6')
    assert.equal(desktopChromeOptions(true).backgroundColor, '#141416')
  })
})
