import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import initSqlJs from 'sql.js'
import { SqliteUsageStorage } from '../src/storage.ts'
import type { UsageEvent } from '@dsh/usage-protocol'
import { defaultQuality, SCHEMA_VERSION, type DataQuality } from '@dsh/usage-protocol'

let SQL: any = null

/** Simulate a normalizer-produced event: every observed token field is exact. */
function exactQuality(): DataQuality {
  const q = defaultQuality()
  for (const f of Object.keys(q) as (keyof DataQuality)[]) q[f] = 'exact'
  return q
}

function ev(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    schema_version: SCHEMA_VERSION,
    event_id: over.event_id ?? 'e',
    logical_request_id: 'r',
    attempt_id: 'a',
    session_id: over.session_id ?? 's1',
    turn_id: over.turn_id ?? '1',
    provider_id: over.provider_id ?? 'p',
    model_id: over.model_id ?? 'm1',
    observed_at: over.observed_at ?? '2026-08-20T12:00:00.000Z',
    started_at: null,
    completed_at: null,
    status: over.status ?? 'completed',
    http_status: 200,
    latency_ms: over.latency_ms ?? null,
    input_tokens: over.input_tokens ?? null,
    output_tokens: over.output_tokens ?? null,
    reasoning_tokens: null,
    total_tokens: null,
    cache_read_tokens: over.cache_read_tokens ?? null,
    cache_write_tokens: null,
    cache_creation_tokens: null,
    cost_value: (over as any).cost_value ?? null,
    cost_currency: (over as any).cost_currency ?? null,
    data_quality: over.data_quality ?? exactQuality(),
    source: 'provider_response',
    error_category: null,
    pricing_id: null,
    pricing_version: null,
  }
}

async function newStorage() {
  if (!SQL) SQL = await initSqlJs()
  const s = new SqliteUsageStorage(new SQL.Database())
  s.runMigrations()
  return s
}

describe('UsageStorage query extensions', () => {
  it('computes latency percentiles in overview', async () => {
    const s = await newStorage()
    for (let i = 0; i < 10; i++) {
      s.insertEvent(ev({ event_id: `e${i}`, latency_ms: 100 + i * 10 }))
    }
    const o: any = s.getOverview()
    assert.equal(o.latency_p50, 140)
    assert.equal(o.latency_p95, 180)
  })

  it('returns daily trend from aggregates', async () => {
    const s = await newStorage()
    s.insertEvent(
      ev({
        event_id: 'a',
        observed_at: '2026-08-20T00:00:00Z',
        input_tokens: 100,
        output_tokens: 10,
      }),
    )
    s.insertEvent(
      ev({
        event_id: 'b',
        observed_at: '2026-08-21T00:00:00Z',
        input_tokens: 200,
        output_tokens: 20,
      }),
    )
    const trend: any = s.getDailyTrend(30)
    assert.equal(trend.length, 2)
    assert.equal(trend[0].date, '2026-08-20')
    assert.equal(trend[0].input_tokens_exact, 100)
  })

  it('returns model breakdown', async () => {
    const s = await newStorage()
    s.insertEvent(ev({ event_id: 'a', model_id: 'm1', input_tokens: 10 }))
    s.insertEvent(ev({ event_id: 'b', model_id: 'm2', input_tokens: 20 }))
    const models: any = s.getModelBreakdown()
    assert.equal(models.length, 2)
  })

  it('returns session and turn usage', async () => {
    const s = await newStorage()
    s.insertEvent(ev({ event_id: 'a', session_id: 'S', turn_id: '1', input_tokens: 5 }))
    s.insertEvent(ev({ event_id: 'b', session_id: 'S', turn_id: '2', input_tokens: 7 }))
    const sess: any = s.getSessionUsage('S')
    assert.equal(sess.length, 2)
    const turn: any = s.getTurnUsage('S', '1')
    assert.equal(turn.length, 1)
  })

  it('exports JSON and CSV', async () => {
    const s = await newStorage()
    s.insertEvent(ev({ event_id: 'a', provider_id: 'deepseek', input_tokens: 5 }))
    const json = s.exportUsage('json')
    assert.ok(json.includes('deepseek'))
    const csv = s.exportUsage('csv')
    assert.ok(csv.startsWith('"observed_at"'))
    assert.ok(csv.includes('deepseek'))
  })

  it('marks unknown in overview', async () => {
    const s = await newStorage()
    s.insertEvent(ev({ event_id: 'a', input_tokens: null })) // unknown tokens
    const o: any = s.getOverview()
    assert.equal(o.has_unknown, true)
  })

  it('computes session stats: cumulative + last request', async () => {
    const s = await newStorage()
    s.insertEvent(
      ev({
        event_id: 'a',
        session_id: 'S',
        turn_id: '1',
        model_id: 'm1',
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 40,
        observed_at: '2026-08-20T10:00:00Z',
      }),
    )
    s.insertEvent(
      ev({
        event_id: 'b',
        session_id: 'S',
        turn_id: '2',
        model_id: 'm2',
        input_tokens: 200,
        output_tokens: 30,
        cache_read_tokens: 0,
        observed_at: '2026-08-21T10:00:00Z',
      }),
    )
    const st: any = s.getSessionStats('S')
    assert.equal(st.session_id, 'S')
    assert.equal(st.request_count, 2)
    assert.equal(st.turn_count, 2)
    assert.equal(st.input_tokens_exact, 300)
    assert.equal(st.output_tokens_exact, 50)
    assert.equal(st.cache_read_tokens_exact, 40)
    // hit rate = cache read / input = 40/300
    assert.ok(Math.abs(st.cache_hit_rate - 40 / 300) < 1e-9)
    // last request = the most recent event
    assert.equal(st.last_input_tokens, 200)
    assert.equal(st.last_output_tokens, 30)
    assert.equal(st.last_cache_read_tokens, 0)
    assert.equal(st.model_id, 'm2')
  })

  it('keeps session stats unknown when tokens are missing', async () => {
    const s = await newStorage()
    s.insertEvent(ev({ event_id: 'a', session_id: 'S', turn_id: '1', input_tokens: null }))
    const st: any = s.getSessionStats('S')
    assert.equal(st.request_count, 1)
    assert.equal(st.input_tokens_exact, null)
    assert.equal(st.cache_hit_rate, null)
  })

  it('overview error rate reflects errors, not successes', async () => {
    const s = await newStorage()
    s.insertEvent(ev({ event_id: 'ok', status: 'completed' }))
    s.insertEvent(ev({ event_id: 'err', status: 'error' }))
    s.insertEvent(ev({ event_id: 'err2', status: 'error' }))
    const o: any = s.getOverview()
    assert.equal(o.request_count, 3)
    assert.equal(o.error_count, 2)
    assert.ok(Math.abs(o.error_rate - 2 / 3) < 1e-9)
  })

  it('retention purges daily aggregates along with raw events', async () => {
    const s = await newStorage()
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString()
    s.insertEvent(ev({ event_id: 'old', observed_at: old, input_tokens: 10 }))
    s.insertEvent(ev({ event_id: 'new', observed_at: new Date().toISOString(), input_tokens: 20 }))
    const before: any = s.getDailyTrend(365)
    assert.equal(before.length, 2)
    s.clearEvents(30 * 24 * 3600 * 1000)
    const after: any = s.getDailyTrend(365)
    assert.equal(after.length, 1)
    assert.equal(after[0].input_tokens_exact, 20)
  })
})
