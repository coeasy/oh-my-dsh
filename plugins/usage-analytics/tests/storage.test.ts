import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import initSqlJs from 'sql.js'
import { SqliteUsageStorage } from '../src/storage.ts'
import { UsagePipeline } from '../src/pipeline.ts'
import type { UsageEvent } from '@dsh/usage-protocol'
import { defaultQuality, SCHEMA_VERSION } from '@dsh/usage-protocol'

let SQL: any = null

function makeEvent(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    schema_version: SCHEMA_VERSION,
    event_id: over.event_id ?? 'evt_1',
    logical_request_id: over.logical_request_id ?? 'req_1',
    attempt_id: over.attempt_id ?? 'a1',
    session_id: over.session_id ?? 's1',
    turn_id: null,
    provider_id: over.provider_id ?? 'openai-compatible',
    model_id: over.model_id ?? 'gpt-x',
    observed_at: over.observed_at ?? '2026-08-20T12:00:00.000Z',
    started_at: '2026-08-20T11:59:50.000Z',
    completed_at: '2026-08-20T12:00:00.000Z',
    status: over.status ?? 'completed',
    http_status: 200,
    latency_ms: 10000,
    input_tokens: over.input_tokens ?? 1000,
    output_tokens: over.output_tokens ?? 500,
    reasoning_tokens: null,
    total_tokens: 1500,
    cache_read_tokens: over.cache_read_tokens ?? null,
    cache_write_tokens: null,
    cache_creation_tokens: null,
    cost_value: null,
    cost_currency: null,
    data_quality: over.data_quality ?? defaultQuality(),
    source: 'provider_response',
    error_category: null,
    pricing_id: null,
    pricing_version: null,
    ...(over as any),
  }
}

async function newStorage() {
  if (!SQL) SQL = await initSqlJs()
  const s = new SqliteUsageStorage(new SQL.Database())
  s.runMigrations()
  return s
}

describe('SqliteUsageStorage', () => {
  it('inserts and counts events', async () => {
    const s = await newStorage()
    const r = s.insertEvent(makeEvent())
    assert.equal(r.inserted, true)
    assert.equal(s.getEventCount(), 1)
  })

  it('rejects duplicates by event_id', async () => {
    const s = await newStorage()
    s.insertEvent(makeEvent({ event_id: 'evt_x' }))
    const r = s.insertEvent(makeEvent({ event_id: 'evt_x' }))
    assert.equal(r.inserted, false)
    assert.equal(r.reason, 'duplicate')
    assert.equal(s.getEventCount(), 1)
  })

  it('never coerces unknown tokens to 0', async () => {
    const s = await newStorage()
    s.insertEvent(makeEvent({ input_tokens: null, output_tokens: null }))
    const overview: any = s.getOverview()
    // input_tokens null should not add to exact count
    assert.equal(overview.input_tokens_exact, 0)
  })

  it('aggregates cache counts correctly', async () => {
    const s = await newStorage()
    const dq = defaultQuality()
    ;(dq as any).cache_read_tokens = 'exact'
    s.insertEvent(makeEvent({ event_id: 'e1', cache_read_tokens: 80, data_quality: dq }))
    s.insertEvent(makeEvent({ event_id: 'e2', cache_read_tokens: null, cache_write_tokens: null }))
    s.insertEvent(
      makeEvent({
        event_id: 'e3',
        cache_read_tokens: null,
        cache_creation_tokens: 20,
        data_quality: dq,
      }),
    )
    const cache: any = s.getCacheAnalysis()
    assert.equal(cache.cache_read_requests, 1)
    assert.equal(cache.cache_creation_requests, 1)
    assert.equal(cache.cache_status_unknown_count, 1)
    assert.equal(cache.hit_rate, 0.8)
  })

  it('daily aggregate persists per provider/model', async () => {
    const s = await newStorage()
    s.insertEvent(
      makeEvent({ event_id: 'e1', provider_id: 'p1', input_tokens: 100, output_tokens: 10 }),
    )
    s.insertEvent(
      makeEvent({ event_id: 'e2', provider_id: 'p1', input_tokens: 200, output_tokens: 20 }),
    )
    const providers = s.getProviderBreakdown() as any[]
    const p1 = providers.find((p) => p.provider_id === 'p1')
    assert.equal(p1.request_count, 2)
    assert.equal(p1.input_tokens_exact, 300)
  })

  it('clearEvents removes detail rows', async () => {
    const s = await newStorage()
    s.insertEvent(makeEvent())
    assert.equal(s.getEventCount(), 1)
    const n = s.clearEvents()
    assert.equal(n, 1)
    assert.equal(s.getEventCount(), 0)
  })

  it('retention clears only old rows', async () => {
    const s = await newStorage()
    s.insertEvent(makeEvent({ event_id: 'old', observed_at: '2020-01-01T00:00:00.000Z' }))
    s.insertEvent(makeEvent({ event_id: 'new', observed_at: '2026-08-20T00:00:00.000Z' }))
    const removed = s.clearEvents(181 * 24 * 60 * 60 * 1000)
    assert.equal(removed, 1)
    assert.equal(s.getEventCount(), 1)
  })
})

describe('UsagePipeline', () => {
  it('drops duplicates', async () => {
    const s = await newStorage()
    const p = new UsagePipeline(s)
    assert.equal(p.accept(makeEvent({ event_id: 'a' })), true)
    assert.equal(
      p.accept(makeEvent({ event_id: 'b', logical_request_id: 'req_1', attempt_id: 'a1' })),
      false,
    )
    assert.equal(p.stats.duplicates, 1)
  })

  it('drops when queue is full without throwing', async () => {
    const s = await newStorage()
    const p = new UsagePipeline(s, { queueLimit: 2 })
    assert.equal(p.accept(makeEvent({ event_id: '1' })), true)
    assert.equal(
      p.accept(makeEvent({ event_id: '2', logical_request_id: 'r2', attempt_id: 'a2' })),
      true,
    )
    assert.equal(
      p.accept(makeEvent({ event_id: '3', logical_request_id: 'r3', attempt_id: 'a3' })),
      false,
    )
    assert.equal(p.stats.dropped, 1)
  })

  it('flush writes to storage', async () => {
    const s = await newStorage()
    const p = new UsagePipeline(s)
    p.accept(makeEvent())
    p.flush()
    assert.equal(s.getEventCount(), 1)
  })
})
