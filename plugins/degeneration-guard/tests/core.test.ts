import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DegenerationGuardCore } from '../src/core.ts'
import { EscalationLadder } from '../src/escalation.ts'
import { TurnLimiter } from '../src/turn-limit.ts'

describe('escalation ladder', () => {
  it('first repetition with autoRetry → retry', () => {
    const l = new EscalationLadder({ autoRetry: true, canAbort: () => true })
    const d = l.signalRepetition('thinking', 'loop')
    assert.equal(d.result.action, 'retry')
    assert.equal(d.advanced, true)
  })

  it('second repetition in same episode → pause', () => {
    const l = new EscalationLadder({ autoRetry: true, canAbort: () => true })
    l.signalRepetition('thinking', 'loop')
    const d = l.signalRepetition('thinking', 'loop')
    assert.equal(d.result.action, 'pause')
    assert.equal(l.isPaused(), true)
  })

  it('progress resets the retry budget', () => {
    const l = new EscalationLadder({ autoRetry: true, canAbort: () => true })
    l.signalRepetition('thinking', 'loop')
    l.reset(true) // real progress → retry budget restored
    const d = l.signalRepetition('thinking', 'loop')
    assert.equal(d.result.action, 'retry')
  })

  it('without abort capability and autoRetry off → pause on first hit', () => {
    const l = new EscalationLadder({ autoRetry: false, canAbort: () => false })
    const d = l.signalRepetition('thinking', 'loop')
    assert.equal(d.result.action, 'pause')
  })

  it('resume clears pause and budget', () => {
    const l = new EscalationLadder({ autoRetry: true, canAbort: () => true })
    l.signalRepetition('thinking', 'a')
    l.signalRepetition('thinking', 'b') // pause
    assert.equal(l.isPaused(), true)
    l.resume()
    assert.equal(l.isPaused(), false)
    const d = l.signalRepetition('thinking', 'c')
    assert.equal(d.result.action, 'retry')
  })

  it('signals after pause are no-ops until resume', () => {
    const l = new EscalationLadder({ autoRetry: true, canAbort: () => true })
    l.signalRepetition('thinking', 'a')
    l.signalRepetition('thinking', 'b') // pause
    const d = l.signalRepetition('thinking', 'c')
    assert.equal(d.result.action, 'none')
    assert.equal(d.advanced, false)
  })

  it('hard stop always pauses', () => {
    const l = new EscalationLadder({ autoRetry: true, canAbort: () => true })
    const d = l.signalHardStop('tool', 'too many repeats')
    assert.equal(d.result.action, 'pause')
  })

  it('notify never pauses', () => {
    const l = new EscalationLadder({ autoRetry: true, canAbort: () => true })
    const d = l.notify('turn limit', 'reminder text')
    assert.equal(d.result.action, 'notify')
    assert.equal(l.isPaused(), false)
  })
})

describe('turn limiter', () => {
  it('notifies at the cap, then throttles', () => {
    const t = new TurnLimiter({ maxTurns: 5, remindEvery: 3 })
    for (let i = 1; i <= 5; i++) assert.equal(t.noteStep('s1').action, 'none')
    const r1 = t.noteStep('s1') // 6 → remind
    assert.equal(r1.action, 'notify')
    assert.equal(t.noteStep('s1').action, 'none') // 7
    assert.equal(t.noteStep('s1').action, 'none') // 8
    const r9 = t.noteStep('s1') // 9 → remind (6+3)
    assert.equal(r9.action, 'notify')
  })

  it('per-session counters are independent', () => {
    const t = new TurnLimiter({ maxTurns: 2 })
    t.noteStep('a')
    assert.equal(t.getTurns('a'), 1)
    assert.equal(t.getTurns('b'), 0)
  })

  it('reset clears a session', () => {
    const t = new TurnLimiter({ maxTurns: 1 })
    t.noteStep('s')
    t.reset('s')
    assert.equal(t.getTurns('s'), 0)
  })
})

describe('guard core integration', () => {
  const block = '我需要再检查一下配置项是否已经生效并且确认没有副作用 '
  const loopText = `${block}${block}${block}${block}`

  it('feeds a thinking loop → retry then pause', () => {
    const core = new DegenerationGuardCore({
      config: { stream: { minPatternSize: 8, maxPatternSize: 64, minCount: 3 } },
      canAbort: () => true,
    })
    // First detection hit → retry.
    let result = { action: 'none' as string }
    for (let i = 0; i < 200 && result.action !== 'retry'; i++) {
      result = core.feed('thinking', loopText.slice(0, 40))
    }
    assert.equal(result.action, 'retry')
    assert.equal(core.stats.retries, 1)

    // Second hit in same episode → pause.
    result = { action: 'none' as string }
    for (let i = 0; i < 200 && result.action !== 'pause'; i++) {
      result = core.feed('thinking', loopText.slice(0, 40))
    }
    assert.equal(result.action, 'pause')
    assert.equal(core.isPaused(), true)
  })

  it('mode off disables detection entirely', () => {
    const core = new DegenerationGuardCore({
      config: { stream: { minPatternSize: 8, maxPatternSize: 64, minCount: 3 } },
    })
    core.setMode('off')
    for (let i = 0; i < 40; i++) core.feed('thinking', loopText.slice(0, 40))
    // feed returns none (not enabled) — but feed itself returns none by design.
    assert.equal(core.stats.thinkingHits, 0)
  })

  it('P0-5: switching strict applies a REAL preset diff (knobs change)', () => {
    const core = new DegenerationGuardCore()
    const standard = core.config
    // Sanity: defaults match the standard preset.
    assert.equal(standard.stream.minCount, 3)
    assert.equal(standard.stream.minPatternSize, 24)
    assert.equal(standard.stream.maxThinkingChars, 65536)
    assert.equal(standard.tool.hardStop, 12)
    assert.equal(standard.maxTurnsPerSession, 30)

    core.setMode('strict')
    const strict = core.config
    assert.equal(strict.mode, 'strict')
    // Every knob must differ from standard — this is the regression guard.
    assert.equal(strict.stream.minCount, 2)
    assert.equal(strict.stream.minPatternSize, 16)
    assert.equal(strict.stream.maxThinkingChars, 32768)
    assert.equal(strict.stream.maxResponseChars, 131072)
    assert.equal(strict.tool.hardStop, 8)
    assert.equal(strict.maxTurnsPerSession, 20)

    // Switching back to standard restores the balanced preset.
    core.setMode('standard')
    const back = core.config
    assert.equal(back.mode, 'standard')
    assert.equal(back.stream.minCount, 3)
    assert.equal(back.stream.maxThinkingChars, 65536)
    assert.equal(back.tool.hardStop, 12)
  })

  it('P0-5: off keeps last parameters and only flips the mode flag', () => {
    const core = new DegenerationGuardCore()
    core.setMode('strict')
    const strictCfg = core.config
    core.setMode('off')
    assert.equal(core.config.mode, 'off')
    // Parameters are retained, only detection is disabled.
    assert.equal(core.config.stream.minCount, strictCfg.stream.minCount)
    assert.equal(core.config.stream.maxThinkingChars, strictCfg.stream.maxThinkingChars)
    assert.equal(core.isEnabled(), false)
  })

  it('thinking segment length backstop pauses', () => {
    const core = new DegenerationGuardCore({
      config: { stream: { maxThinkingChars: 100 } },
    })
    const r = core.feed('thinking', 'x'.repeat(120))
    assert.equal(r.action, 'pause')
    assert.equal(r.family, 'length')
  })

  it('response length backstop pauses', () => {
    const core = new DegenerationGuardCore({
      config: { stream: { maxResponseChars: 100 } },
    })
    const r = core.feed('text', 'x'.repeat(120))
    assert.equal(r.action, 'pause')
    assert.equal(r.family, 'length')
  })

  it('tool repeat hard stop pauses via the ladder', () => {
    const core = new DegenerationGuardCore({
      config: {
        tool: { hardStop: 5, thresholds: [3], include: [], exclude: [], argumentsPreviewChars: 50 },
      },
    })
    let r = { action: 'none' as string }
    for (let i = 0; i < 6 && r.action !== 'pause'; i++) {
      r = core.feedToolCall('edit', { file: 'a.ts' })
    }
    assert.equal(r.action, 'pause')
    assert.equal(core.stats.toolRepeatPauses, 1)
  })

  it('turn limit notifies through noteStep', () => {
    const core = new DegenerationGuardCore({ config: { maxTurnsPerSession: 3 } })
    for (let i = 0; i < 3; i++) assert.equal(core.noteStep('s1').action, 'none')
    const r = core.noteStep('s1')
    assert.equal(r.action, 'notify')
    assert.ok(r.reminder)
  })

  it('resetAll clears buffers and resumes retry budget', () => {
    const core = new DegenerationGuardCore({
      config: { stream: { minPatternSize: 8, maxPatternSize: 64, minCount: 3 } },
      canAbort: () => true,
    })
    for (let i = 0; i < 40; i++) {
      const r = core.feed('thinking', loopText.slice(0, 40))
      if (r.action === 'retry') break
    }
    core.resetAll()
    let r = { action: 'none' as string }
    for (let i = 0; i < 200 && r.action !== 'retry'; i++)
      r = core.feed('thinking', loopText.slice(0, 40))
    assert.equal(r.action, 'retry') // retry budget was restored by resetAll
  })

  it('updateConfig rebuilds detectors with new knobs', () => {
    const core = new DegenerationGuardCore({ config: { stream: { maxThinkingChars: 100000 } } })
    core.updateConfig({ stream: { maxThinkingChars: 50 } })
    const r = core.feed('thinking', 'y'.repeat(60))
    assert.equal(r.action, 'pause')
    assert.equal(core.config.stream.maxThinkingChars, 50)
  })

  it('resetSession clears only one session turn state', () => {
    const core = new DegenerationGuardCore({ config: { maxTurnsPerSession: 2 } })
    core.noteStep('a')
    core.noteStep('a')
    core.noteStep('b')
    assert.equal(core.turnCount('a'), 2)
    assert.equal(core.turnCount('b'), 1)
    core.resetSession('a')
    assert.equal(core.turnCount('a'), 0)
    assert.equal(core.turnCount('b'), 1)
  })

  it('tool remind and turn notify carry their own family', () => {
    const core = new DegenerationGuardCore({
      config: {
        tool: { hardStop: 9, thresholds: [3], include: [], exclude: [], argumentsPreviewChars: 50 },
        maxTurnsPerSession: 1,
      },
    })
    core.feedToolCall('edit', { f: 'a.ts' })
    core.feedToolCall('edit', { f: 'a.ts' })
    const r = core.feedToolCall('edit', { f: 'a.ts' })
    assert.equal(r.action, 'notify')
    assert.equal(r.family, 'tool')
    core.noteStep('s')
    const t = core.noteStep('s')
    assert.equal(t.action, 'notify')
    assert.equal(t.family, 'turn')
  })

  it('throttled cycle check still detects a loop (no missed detections)', () => {
    const block = '这是一个需要检查的函数返回值是否正确 '
    const core = new DegenerationGuardCore({
      config: { stream: { minPatternSize: 8, maxPatternSize: 64, minCount: 3 } },
      canAbort: () => true,
    })
    let r = { action: 'none' as string }
    // Feed in small deltas so the throttle must accumulate across many feeds.
    for (let i = 0; i < 400 && r.action !== 'retry'; i++)
      r = core.feed('thinking', block.slice(0, 8))
    assert.equal(r.action, 'retry')
  })
})
