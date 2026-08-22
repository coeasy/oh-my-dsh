import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BUILTIN_MAPPINGS, DEFAULT_PRICE_TABLE } from '../src/builtin.ts'
import { estimateCost, validatePriceTable } from '@dsh/usage-analytics-core'

describe('builtin provider templates', () => {
  it('exposes all four builtin templates keyed by id', () => {
    for (const id of [
      'openai-compatible',
      'deepseek',
      'anthropic-compatible',
      'gemini-compatible',
    ]) {
      assert.ok(BUILTIN_MAPPINGS[id], `missing ${id}`)
      assert.equal(BUILTIN_MAPPINGS[id].id, id)
      assert.ok(BUILTIN_MAPPINGS[id].usage, `${id} must declare usage field paths`)
      assert.ok(BUILTIN_MAPPINGS[id].streaming, `${id} must declare a streaming strategy`)
    }
  })

  it('declares JSONPath extraction paths only', () => {
    for (const t of Object.values(BUILTIN_MAPPINGS)) {
      for (const paths of Object.values(t.usage)) {
        assert.ok(
          Array.isArray(paths) && paths.length > 0,
          'each usage field must be a non-empty path list',
        )
        for (const p of paths as string[]) {
          assert.ok(p.startsWith('$.'), `path must be a restricted JSONPath: ${p}`)
        }
      }
    }
  })

  it('deepseek template maps cache read/write tokens', () => {
    const d = BUILTIN_MAPPINGS.deepseek
    assert.ok((d.usage.cache_read_tokens ?? []).some((p) => p.includes('prompt_cache_hit_tokens')))
    assert.ok(
      (d.usage.cache_write_tokens ?? []).some((p) => p.includes('prompt_cache_miss_tokens')),
    )
  })

  it('default price table is structurally valid', () => {
    assert.equal(validatePriceTable(DEFAULT_PRICE_TABLE).length, 0)
    assert.equal(DEFAULT_PRICE_TABLE.currency, 'USD')
    assert.ok(DEFAULT_PRICE_TABLE.default, 'default price entry must exist')
  })

  it('default price table produces a cost estimate', () => {
    const cost = estimateCost(DEFAULT_PRICE_TABLE, 'any-model', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: null,
      cache_write_tokens: null,
    })
    assert.ok(Math.abs(cost.value - 2.0) < 1e-6)
    assert.equal(cost.currency, 'USD')
  })

  it('unknown tokens are skipped in pricing', () => {
    const cost = estimateCost(DEFAULT_PRICE_TABLE, 'any-model', {
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: 5_000_000,
      cache_write_tokens: null,
    })
    assert.equal(cost.value, 0)
    assert.equal(cost.components.input, false)
  })
})
