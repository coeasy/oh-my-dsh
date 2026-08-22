import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateUsageEvent, SCHEMA_VERSION, type UsageEvent } from '../src/event.ts'
import { defaultQuality } from '../src/quality.ts'
import type { Quality } from '../src/quality.ts'

function validEvent(): UsageEvent {
  return {
    schema_version: SCHEMA_VERSION,
    event_id: 'evt_1',
    logical_request_id: 'req_1',
    attempt_id: 'attempt_1',
    session_id: 's1',
    turn_id: null,
    provider_id: 'openai-compatible',
    model_id: 'gpt-x',
    observed_at: '2026-08-20T12:00:00.000Z',
    started_at: '2026-08-20T11:59:50.000Z',
    completed_at: '2026-08-20T12:00:00.000Z',
    status: 'completed',
    http_status: 200,
    latency_ms: 10000,
    input_tokens: 1000,
    output_tokens: 500,
    reasoning_tokens: null,
    total_tokens: 1500,
    cache_read_tokens: 800,
    cache_write_tokens: 0,
    cache_creation_tokens: null,
    cost_value: null,
    cost_currency: null,
    data_quality: defaultQuality(),
    source: 'provider_response',
    error_category: null,
    pricing_id: null,
    pricing_version: null,
  }
}

describe('validateUsageEvent', () => {
  it('accepts a well-formed event', () => {
    assert.equal(validateUsageEvent(validEvent()), null)
  })

  it('accepts null token fields as unknown', () => {
    const e = validEvent()
    e.input_tokens = null
    assert.equal(validateUsageEvent(e), null)
  })

  it('rejects a forbidden sensitive field even when extra', () => {
    const e: any = validEvent()
    e.api_key = 'sk-secret'
    const problems = validateUsageEvent(e)
    assert.ok(problems && problems.some((p) => p.includes('forbidden')))
  })

  it('rejects prompt/response/authorization', () => {
    for (const key of ['prompt', 'response', 'authorization', 'cookie', 'raw_provider_json']) {
      const e: any = validEvent()
      e[key] = 'x'
      assert.ok(validateUsageEvent(e), `should reject ${key}`)
    }
  })

  it('rejects negative tokens', () => {
    const e = validEvent()
    e.input_tokens = -5
    assert.ok(validateUsageEvent(e))
  })

  it('rejects invalid status', () => {
    const e: any = validEvent()
    e.status = 'banana'
    assert.ok(validateUsageEvent(e))
  })

  it('rejects invalid quality marker', () => {
    const e: any = validEvent()
    e.data_quality = { input_tokens: 'not-a-quality' }
    assert.ok(validateUsageEvent(e))
  })

  it('rejects wrong schema version', () => {
    const e: any = validEvent()
    e.schema_version = 'usage.event.v9'
    assert.ok(validateUsageEvent(e))
  })

  it('defaultQuality marks everything unknown', () => {
    const q = defaultQuality()
    const values = new Set<Quality>(Object.values(q))
    assert.deepEqual([...values], ['unknown'])
  })
})
