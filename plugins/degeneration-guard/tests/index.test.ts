import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createService, type DegenerationGuardService } from '../src/index.ts'
import { defaultManifest, validateManifest } from '../src/manifest.ts'
import type { GuardContext, GuardEvent } from '../src/types.ts'

function mockCtx(): { ctx: GuardContext; events: GuardEvent[] } {
  const events: GuardEvent[] = []
  const ctx: GuardContext = {
    on: () => undefined,
    emit: (_ev, payload) => {
      events.push(payload as GuardEvent)
    },
  }
  return { ctx, events }
}

describe('degeneration-guard service', () => {
  it('installs ready with standard mode', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    assert.equal(svc.getStatus().ready, true)
    assert.equal(svc.getStatus().mode, 'standard')
  })

  it('setMode toggles behavior and updates status', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    svc.setMode('strict')
    assert.equal(svc.getStatus().mode, 'strict')
    svc.setMode('off')
    assert.equal(svc.getStatus().mode, 'off')
  })

  it('P0-5: setMode(strict) applies the strict preset through the service', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    svc.setMode('strict')
    const cfg = svc.getConfig()
    assert.equal(cfg.mode, 'strict')
    assert.equal(cfg.stream.minCount, 2)
    assert.equal(cfg.stream.minPatternSize, 16)
    assert.equal(cfg.stream.maxThinkingChars, 32768)
    assert.equal(cfg.tool.hardStop, 8)
    assert.equal(cfg.maxTurnsPerSession, 20)
  })

  it('emits auto_retry event and injects reminder via seam', async () => {
    const { ctx, events } = mockCtx()
    let injected = ''
    const svc = await createService(ctx, {
      host: {
        reminder: { inject: (t) => (injected = t) },
        interrupt: { canAbort: () => true, abort: async () => {} },
      },
      config: { stream: { minPatternSize: 8, maxPatternSize: 64, minCount: 3 } },
    })
    const block = '我需要再检查一下配置项是否已经生效并且确认没有副作用 '
    const loop = `${block}${block}${block}${block}`
    let r = { action: 'none' as string }
    for (let i = 0; i < 300 && r.action !== 'retry'; i++)
      r = svc.feed('thinking', loop.slice(0, 40))
    assert.equal(r.action, 'retry')
    assert.ok(injected.length > 0)
    assert.ok(events.some((e) => e.kind === 'auto_retry'))
  })

  it('tool pause emits tool_repeat_pause and marks status paused', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {
      config: {
        tool: { hardStop: 4, thresholds: [3], include: [], exclude: [], argumentsPreviewChars: 50 },
      },
    })
    for (let i = 0; i < 4; i++) svc.feedToolCall('write', { path: 'x' })
    assert.equal(svc.isPaused(), true)
    const status = svc.getStatus()
    assert.equal(status.active.paused, true)
    assert.ok(status.stats.toolRepeatPauses >= 1)
  })

  it('resume clears pause', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {
      config: {
        tool: { hardStop: 2, thresholds: [3], include: [], exclude: [], argumentsPreviewChars: 50 },
      },
    })
    svc.feedToolCall('write', { p: 1 })
    svc.feedToolCall('write', { p: 1 })
    assert.equal(svc.isPaused(), true)
    svc.resume()
    assert.equal(svc.isPaused(), false)
  })

  it('interruptNow returns false without the seam', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    assert.equal(await svc.interruptNow('test'), false)
  })

  it('interruptNow aborts via the seam', async () => {
    const { ctx } = mockCtx()
    let aborted = ''
    const svc = await createService(ctx, {
      host: {
        interrupt: {
          canAbort: () => true,
          abort: async (r) => {
            aborted = r
          },
        },
      },
    })
    assert.equal(await svc.interruptNow('loop'), true)
    assert.equal(aborted, 'loop')
  })

  it('forceMode applies at startup', async () => {
    const { ctx } = mockCtx()
    const svc: DegenerationGuardService = await createService(ctx, { forceMode: 'off' })
    assert.equal(svc.getStatus().mode, 'off')
  })

  it('turn limit notifies through the service and emits event', async () => {
    const { ctx, events } = mockCtx()
    const svc = await createService(ctx, { config: { maxTurnsPerSession: 2 } })
    svc.noteStep('s')
    svc.noteStep('s')
    const r = svc.noteStep('s')
    assert.equal(r.action, 'notify')
    assert.ok(events.some((e) => e.kind === 'turn_limit_reminder'))
  })

  it('resetSession(id) releases one session while others keep their count', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, { config: { maxTurnsPerSession: 5 } })
    svc.noteStep('a')
    svc.noteStep('a')
    svc.noteStep('b')
    assert.equal(svc.turnCount('a'), 2)
    svc.resetSession('a')
    assert.equal(svc.turnCount('a'), 0)
    assert.equal(svc.turnCount('b'), 1)
    // Omitting the id clears everything.
    svc.noteStep('b')
    svc.resetSession()
    assert.equal(svc.turnCount('b'), 0)
  })
})

describe('degeneration-guard manifest', () => {
  it('default manifest validates', () => {
    assert.deepEqual(validateManifest(defaultManifest()), [])
  })

  it('rejects forbidden permissions', () => {
    const m = defaultManifest()
    m.permissions = ['credential.read']
    assert.ok(validateManifest(m).some((p) => p.includes('forbidden')))
  })

  it('rejects unknown permissions', () => {
    const m = defaultManifest()
    m.permissions = ['model.switch']
    assert.ok(validateManifest(m).some((p) => p.includes('unknown')))
  })

  it('rejects a bad target', () => {
    const m = defaultManifest()
    m.targets = ['ios' as 'desktop']
    assert.ok(validateManifest(m).some((p) => p.includes('target')))
  })
})
