import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { trayMenuLabels, trayTooltip } from '../src/status-tray.ts'
import type { RuntimeSnapshot } from '../src/contracts.ts'

function snapshot(phase: RuntimeSnapshot['phase']): RuntimeSnapshot {
  return { phase, message: '', logs: [] }
}

describe('status tray copy', () => {
  it('labels every runtime phase in Chinese', () => {
    assert.equal(trayTooltip(snapshot('idle'), 'zh'), 'my-dsh · 未运行')
    assert.equal(trayTooltip(snapshot('starting'), 'zh'), 'my-dsh · 正在启动')
    assert.equal(trayTooltip(snapshot('ready'), 'zh'), 'my-dsh · 运行中')
    assert.equal(trayTooltip(snapshot('stopping'), 'zh'), 'my-dsh · 正在退出')
    assert.equal(trayTooltip(snapshot('failed'), 'zh'), 'my-dsh · 启动失败')
  })

  it('exposes show, market, restart, and quit actions', () => {
    assert.deepEqual(trayMenuLabels('zh'), {
      show: '打开窗口',
      market: '插件市场',
      restart: '重启',
      quit: '退出',
    })
    assert.deepEqual(trayMenuLabels('en'), {
      show: 'Open Window',
      market: 'Marketplace',
      restart: 'Restart',
      quit: 'Quit',
    })
  })
})
