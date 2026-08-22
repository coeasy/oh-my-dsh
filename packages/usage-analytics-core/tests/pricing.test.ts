import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { estimateCost, validatePriceTable, type PriceTable } from '../src/pricing.ts'

const table: PriceTable = {
  id: 'test',
  version: 'v1',
  currency: 'USD',
  models: {
    'm-x': { input_per_mtok: 1, output_per_mtok: 2, cache_read_per_mtok: 0.1 },
  },
  default: { input_per_mtok: 0.5, output_per_mtok: 1 },
}

describe('estimateCost', () => {
  it('prices known tokens only', () => {
    const r = estimateCost(table, 'm-x', {
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cache_read_tokens: 1_000_000,
      cache_write_tokens: null,
    })
    assert.equal(r.value, 1 + 1 + 0.1)
    assert.equal(r.currency, 'USD')
    assert.deepEqual(r.components, { input: true, output: true, cache_read: true, cache_write: false })
  })

  it('falls back to default pricing for unknown model', () => {
    const r = estimateCost(table, 'unknown-model', {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_tokens: null,
      cache_write_tokens: null,
    })
    assert.equal(r.value, 0.5)
  })

  it('skips unknown tokens (does not treat as 0 cost misleadingly)', () => {
    const r = estimateCost(table, 'm-x', {
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
    })
    assert.equal(r.value, 0)
    assert.equal(r.components.input, false)
  })

  it('returns 0 cost when no price configured', () => {
    const t: PriceTable = { id: 'x', version: 'v1', currency: 'USD', models: {} }
    const r = estimateCost(t, 'm', {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_tokens: null,
      cache_write_tokens: null,
    })
    assert.equal(r.value, 0)
  })
})

describe('validatePriceTable', () => {
  it('accepts valid table', () => {
    assert.deepEqual(validatePriceTable(table), [])
  })
  it('rejects missing currency', () => {
    assert.ok(validatePriceTable({ id: 'x', version: 'v1', models: {} }).length > 0)
  })
  it('rejects executable fields', () => {
    const problems = validatePriceTable({ id: 'x', version: 'v1', currency: 'USD', models: {}, fn: 'evil' })
    assert.ok(problems.some((p) => p.includes('executable')))
  })
})
