import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyCacheEvent,
  addCacheEvent,
  accumulateCacheCounts,
  cacheHitRate,
} from '../src/cache-metrics.ts'

describe('classifyCacheEvent', () => {
  it('classifies read when read tokens > 0', () => {
    const c = classifyCacheEvent(8, null, null)
    assert.equal(c.read, true)
    assert.equal(c.unknown, false)
  })
  it('classifies write when write tokens > 0', () => {
    const c = classifyCacheEvent(null, 3, null)
    assert.equal(c.write, true)
    assert.equal(c.unknown, false)
  })
  it('classifies creation when creation tokens > 0', () => {
    const c = classifyCacheEvent(null, null, 2)
    assert.equal(c.creation, true)
  })
  it('treats all-null as unknown (not a miss)', () => {
    const c = classifyCacheEvent(null, null, null)
    assert.equal(c.unknown, true)
    assert.equal(c.read, false)
  })
  it('treats zero tokens as unknown, not read', () => {
    const c = classifyCacheEvent(0, null, null)
    assert.equal(c.read, false)
    assert.equal(c.unknown, true)
  })
})

describe('cacheHitRate', () => {
  it('computes over known data only', () => {
    assert.equal(cacheHitRate(80, 20, 0), 0.8)
  })
  it('returns null when nothing known (no misleading miss rate)', () => {
    assert.equal(cacheHitRate(null, null, null), null)
    assert.equal(cacheHitRate(0, 0, 0), null)
  })
})

describe('addCacheEvent accumulation', () => {
  it('tracks request counts across events', () => {
    const acc = accumulateCacheCounts()
    addCacheEvent(acc, 8, null, null)
    addCacheEvent(acc, null, null, null)
    addCacheEvent(acc, null, null, 2)
    assert.equal(acc.total_requests, 3)
    assert.equal(acc.cache_read_requests, 1)
    assert.equal(acc.cache_creation_requests, 1)
    assert.equal(acc.cache_status_unknown_count, 1)
  })
})
