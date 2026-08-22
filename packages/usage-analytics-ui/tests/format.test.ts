import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatToken, formatCost, formatPercent, qualityBadge } from '../src/format.ts'

describe('format helpers', () => {
  it('formats known tokens with separators', () => {
    assert.equal(formatToken(1234567), '1,234,567')
  })
  it('renders unknown as em-dash, not 0', () => {
    assert.equal(formatToken(null), '—')
    assert.equal(formatToken(undefined), '—')
  })
  it('formats cost with currency', () => {
    assert.equal(formatCost(1.5, 'USD'), '$1.5000')
    assert.equal(formatCost(1.5, 'CNY'), '¥1.5000')
    assert.equal(formatCost(null, 'USD'), '—')
  })
  it('formats percent and unknown percent', () => {
    assert.equal(formatPercent(0.8), '80.0%')
    assert.equal(formatPercent(null), '—')
  })
  it('maps quality to distinct badges', () => {
    assert.equal(qualityBadge('exact').label, 'exact')
    assert.equal(qualityBadge('unknown').label, 'unknown')
    assert.equal(qualityBadge('estimated').className, 'q-estimated')
  })
})
