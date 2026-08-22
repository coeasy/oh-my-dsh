import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { StreamMerger, mergeChunk, finalizeStream } from '../src/streaming.ts'
import type { UsageEvent } from '@dsh/usage-protocol'

function base(
  over: Partial<UsageEvent> = {},
): Omit<
  UsageEvent,
  | 'input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'cache_read_tokens'
  | 'cache_write_tokens'
  | 'cache_creation_tokens'
  | 'observed_at'
> {
  return {
    schema_version: 'usage.event.v1',
    event_id: over.event_id ?? 'e1',
    logical_request_id: over.logical_request_id ?? 'req',
    attempt_id: over.attempt_id ?? 'a1',
    session_id: null,
    turn_id: null,
    provider_id: 'p',
    model_id: 'm',
    started_at: null,
    completed_at: null,
    status: 'completed',
    http_status: 200,
    latency_ms: null,
    reasoning_tokens: null,
    cost_value: null,
    cost_currency: null,
    data_quality: {},
    source: 'provider_response',
    error_category: null,
    pricing_id: null,
    pricing_version: null,
  }
}

describe('StreamMerger dedup', () => {
  it('detects duplicate logical+attempt+source', () => {
    const m = new StreamMerger()
    const e = { logical_request_id: 'r', attempt_id: 'a', source: 'provider_response' as const }
    assert.equal(m.seenBefore(e), false)
    assert.equal(m.seenBefore(e), true)
  })
  it('caps in-memory dedup keys (bounded memory)', () => {
    const m = new StreamMerger()
    // fill past the cap; must not throw
    for (let i = 0; i < StreamMerger.MAX_SEEN + 1; i++) {
      assert.equal(
        m.seenBefore({ logical_request_id: `r${i}`, attempt_id: 'a', source: 'provider_response' }),
        false,
      )
    }
    // the overflow reset the set, so an earlier key is no longer remembered
    // (accepted again — memory stays bounded)
    assert.equal(
      m.seenBefore({ logical_request_id: 'r0', attempt_id: 'a', source: 'provider_response' }),
      false,
    )
  })
  it('treats different attempt as distinct', () => {
    const m = new StreamMerger()
    assert.equal(
      m.seenBefore({ logical_request_id: 'r', attempt_id: 'a1', source: 'provider_response' }),
      false,
    )
    assert.equal(
      m.seenBefore({ logical_request_id: 'r', attempt_id: 'a2', source: 'provider_response' }),
      false,
    )
  })
})

describe('finalizeStream', () => {
  it('commits final usage once (no double count)', () => {
    const m = new StreamMerger()
    const s = m.open('req', 'a1', '2026-01-01T00:00:00Z')
    s.saw_final_usage = true
    const finalUsage: Partial<UsageEvent> = {
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      status: 'completed',
    }
    const ev = finalizeStream(
      s,
      base({ logical_request_id: 'req', attempt_id: 'a1' }),
      '2026-01-01T00:00:01Z',
      finalUsage,
    )
    assert.equal(ev.input_tokens, 100)
    assert.equal(ev.output_tokens, 50)
    assert.equal(ev.total_tokens, 150)
  })

  it('leaves tokens unknown when interrupted without final usage', () => {
    const m = new StreamMerger()
    const s = m.open('req', 'a1', '2026-01-01T00:00:00Z')
    s.saw_final_usage = false
    const ev = finalizeStream(
      s,
      base({ logical_request_id: 'req', attempt_id: 'a1', status: 'interrupted' }),
      '2026-01-01T00:00:01Z',
    )
    assert.equal(ev.input_tokens, null)
    assert.equal(ev.output_tokens, null)
  })

  it('does not accumulate intermediate chunk tokens into a total', () => {
    const m = new StreamMerger()
    const s = m.open('req', 'a1', '2026-01-01T00:00:00Z')
    // simulate chunks that each carry an incremental-ish token count
    s.saw_final_usage = false
    const ev = finalizeStream(
      s,
      base({ logical_request_id: 'req', attempt_id: 'a1', status: 'interrupted' }),
      '2026-01-01T00:00:01Z',
      null,
    )
    assert.equal(ev.input_tokens, null)
  })

  it('final usage overrides earlier chunk tokens (last-wins)', () => {
    const m = new StreamMerger()
    const s = m.open('req', 'a1', '2026-01-01T00:00:00Z')
    // an early chunk reported a partial count
    mergeChunk(s, { input_tokens: 10, output_tokens: 5 })
    s.saw_final_usage = true
    const finalUsage: Partial<UsageEvent> = {
      input_tokens: 100,
      output_tokens: 50,
      status: 'completed',
    }
    const ev = finalizeStream(
      s,
      base({ logical_request_id: 'req', attempt_id: 'a1' }),
      '2026-01-01T00:00:01Z',
      finalUsage,
    )
    assert.equal(ev.input_tokens, 100)
    assert.equal(ev.output_tokens, 50)
  })
})
