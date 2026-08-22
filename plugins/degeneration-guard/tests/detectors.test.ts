import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RollingBuffer, normalizeText } from '../src/buffer.ts'
import { canonicalizeArgs, ToolChain } from '../src/tool-chain.ts'
import { detectCycle, hasCycle } from '../src/ngram.ts'

const OPTS = { minPatternSize: 8, maxPatternSize: 64, minCount: 3 }

describe('rolling buffer', () => {
  it('normalizes whitespace', () => {
    assert.equal(normalizeText('a  b\n\n c'), 'a b c')
  })

  it('keeps a bounded tail', () => {
    const b = new RollingBuffer(10)
    b.append('abcdefghijklmnop')
    assert.equal(b.length, 10)
    assert.equal(b.content, 'ghijklmnop')
  })

  it('resets to empty', () => {
    const b = new RollingBuffer(10)
    b.append('abc')
    b.reset()
    assert.equal(b.content, '')
  })
})

describe('n-gram cycle detection', () => {
  it('detects a clear cycle', () => {
    const block = '我需要再检查一次这个函数的返回值是否正确 '
    const text = `先做第一件事。${block}${block}${block}${block}`
    assert.equal(hasCycle(text, OPTS), true)
    const r = detectCycle(text, OPTS)
    assert.equal(r.hit, true)
    assert.ok(r.period >= 8)
  })

  it('does not fire on short repetition below minPatternSize', () => {
    const text = 'abababababababababab' // period 2, below min 8
    assert.equal(hasCycle(text, OPTS), false)
  })

  it('does not fire when the repeat count is below minCount', () => {
    const block = '这是重复的短语内容 '
    const text = `开始。${block}${block}` // only 2 copies → 1 repeat, need 3
    assert.equal(hasCycle(text, OPTS), false)
  })

  it('fires with exactly minCount repeats', () => {
    const block = '这是重复的短语内容 '
    const text = `开始。${block}${block}${block}${block}` // 4 copies → 3 repeats
    assert.equal(hasCycle(text, OPTS), true)
  })

  it('ignores repeated blocks interleaved with different text', () => {
    const block = '重复的内容在这里 '
    const text = `${block}different ${block}different ${block}different ${block}`
    assert.equal(hasCycle(text, OPTS), false)
  })

  it('is robust to whitespace differences between copies', () => {
    // Copies differ only in whitespace characters that normalize to the same
    // single space, so every block normalizes to an identical string.
    const c1 = '检查结果，\n发现需要修正。'
    const c2 = '检查结果，\t发现需要修正。'
    const c3 = '检查结果，\r\n发现需要修正。'
    const text = `${c1}${c2}${c3}${c1}${c2}${c3}${c1}`
    assert.equal(hasCycle(text, OPTS), true)
  })

  it('throws on invalid options', () => {
    assert.throws(() =>
      detectCycle('x'.repeat(100), { minPatternSize: 5, maxPatternSize: 3, minCount: 2 }),
    )
    assert.throws(() =>
      detectCycle('x'.repeat(100), { minPatternSize: 2, maxPatternSize: 4, minCount: 0 }),
    )
  })
})

describe('tool chain', () => {
  const chain = () =>
    new ToolChain({
      thresholds: [3, 5],
      hardStop: 7,
      include: [],
      exclude: [],
      argumentsPreviewChars: 50,
    })

  it('canonicalizes args independent of key order', () => {
    assert.equal(
      canonicalizeArgs({ b: 1, a: { y: 2, x: 1 } }),
      canonicalizeArgs({ a: { x: 1, y: 2 }, b: 1 }),
    )
  })

  it('counts consecutive identical calls and reminds at thresholds', () => {
    const c = chain()
    assert.equal(c.record('grep', { q: 'foo' }).action, 'none')
    assert.equal(c.record('grep', { q: 'foo' }).action, 'none')
    const r3 = c.record('grep', { q: 'foo' })
    assert.equal(r3.action, 'remind')
    assert.equal(r3.threshold, 3)
    c.record('grep', { q: 'foo' })
    const r5 = c.record('grep', { q: 'foo' })
    assert.equal(r5.action, 'remind')
    assert.equal(r5.threshold, 5)
  })

  it('resets the chain when the call differs', () => {
    const c = chain()
    c.record('grep', { q: 'foo' })
    c.record('grep', { q: 'foo' })
    c.record('grep', { q: 'foo' }) // remind
    c.record('grep', { q: 'bar' }) // differs → reset
    assert.equal(c.record('grep', { q: 'bar' }).action, 'none')
  })

  it('excluded tools are transparent to the chain', () => {
    const c = new ToolChain({
      thresholds: [3],
      hardStop: 7,
      include: [],
      exclude: ['todo_write'],
      argumentsPreviewChars: 50,
    })
    c.record('grep', { q: 'foo' })
    c.record('grep', { q: 'foo' })
    c.record('todo_write', { task: 'x' }) // transparent, neither count nor reset
    assert.equal(c.record('grep', { q: 'foo' }).action, 'remind')
  })

  it('hard stop pauses at the configured count', () => {
    const c = chain()
    for (let i = 0; i < 7; i++) c.record('edit', { file: 'a.ts' })
    const r = c.record('edit', { file: 'a.ts' })
    assert.equal(r.action, 'pause')
    assert.equal(r.count, 8)
  })

  it('denied calls still count (hammering a denied call is a loop)', () => {
    const c = chain()
    c.record('rm', { path: '/x' }, true)
    c.record('rm', { path: '/x' }, true)
    const r = c.record('rm', { path: '/x' }, true)
    assert.equal(r.action, 'remind')
  })

  it('include patterns restrict tracking', () => {
    const c = new ToolChain({
      thresholds: [3],
      hardStop: 7,
      include: ['mcp_*'],
      exclude: [],
      argumentsPreviewChars: 50,
    })
    c.record('grep', { q: 'foo' })
    c.record('grep', { q: 'foo' })
    c.record('grep', { q: 'foo' })
    // grep not tracked → no reminder
    assert.equal(c.record('grep', { q: 'foo' }).action, 'none')
  })
})
