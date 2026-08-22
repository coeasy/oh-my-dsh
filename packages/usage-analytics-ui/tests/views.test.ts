import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  renderOverview,
  renderCache,
  renderProviders,
  renderSessions,
  renderTrend,
  renderModels,
} from '../src/views.ts'

describe('renderOverview', () => {
  it('renders unknown cache as em-dash not zero', () => {
    const html = renderOverview(
      {
        request_count: 5,
        success_count: 4,
        error_count: 1,
        unknown_status_count: 0,
        input_tokens_exact: 100,
        output_tokens_exact: 50,
        cache_read_requests: 0,
        cache_status_unknown_count: 5,
        cache_read_tokens_exact: null as unknown as number,
        estimated_cost_value: null,
        error_rate: 0.2,
        latency_p50: null,
        latency_p95: 300,
      },
      false,
    )
    assert.ok(html.includes('—'), 'unknown P50 should render as em-dash')
    assert.ok(html.includes('provider did not report'))
    // cost card must NOT appear when disabled
    assert.ok(!html.includes('Est. cost'))
  })

  it('includes cost card only when enabled', () => {
    const html = renderOverview(
      {
        request_count: 1,
        success_count: 1,
        error_count: 0,
        unknown_status_count: 0,
        input_tokens_exact: 10,
        output_tokens_exact: 0,
        cache_read_requests: 0,
        cache_status_unknown_count: 0,
        cache_read_tokens_exact: 0,
        estimated_cost_value: 0.5,
        error_rate: 0,
        latency_p50: 1,
        latency_p95: 2,
      },
      true,
    )
    assert.ok(html.includes('Est. cost'))
    assert.ok(html.includes('estimated, local only'))
  })
})

describe('renderCache', () => {
  it('shows unknown hit rate when no known data (not a miss)', () => {
    const html = renderCache({
      total_requests: 3,
      cache_read_requests: 0,
      cache_write_requests: 0,
      cache_creation_requests: 0,
      cache_status_unknown_count: 3,
      cache_read_tokens_exact: 0,
      cache_write_tokens_exact: 0,
      cache_creation_tokens_exact: 0,
      hit_rate: null,
    })
    assert.ok(html.includes('unknown'))
    assert.ok(!html.includes('0.0%'), 'must not display a fake miss rate')
  })
  it('shows hit rate when known', () => {
    const html = renderCache({
      total_requests: 2,
      cache_read_requests: 1,
      cache_write_requests: 1,
      cache_creation_requests: 0,
      cache_status_unknown_count: 0,
      cache_read_tokens_exact: 80,
      cache_write_tokens_exact: 20,
      cache_creation_tokens_exact: 0,
      hit_rate: 0.8,
    })
    assert.ok(html.includes('80.0%'))
  })
})

describe('renderTrend / renderModels', () => {
  it('renders trend points', () => {
    const html = renderTrend([
      {
        date: '2026-08-20',
        request_count: 3,
        input_tokens_exact: 100,
        output_tokens_exact: 50,
        cache_read_requests: 1,
        error_count: 0,
        estimated_cost_value: null,
      },
    ])
    assert.ok(html.includes('2026-08-20'))
    assert.ok(html.includes('Daily trend'))
  })
  it('renders model rows and escapes ids', () => {
    const html = renderModels([
      { model_id: '<m>', request_count: 1, input_tokens_exact: 1, output_tokens_exact: 0 },
    ])
    assert.ok(html.includes('&lt;m&gt;'))
    assert.ok(!html.includes('<m>'))
  })
  it('renders empty states without error', () => {
    assert.ok(renderTrend([]).includes('No data'))
    assert.ok(renderModels([]).includes('No data'))
  })
})

describe('renderProviders / renderSessions', () => {
  it('renders empty states without error', () => {
    assert.ok(renderProviders([], false).includes('No data'))
    assert.ok(renderSessions([]).includes('No events'))
  })
  it('escapes provider ids', () => {
    const html = renderProviders(
      [
        {
          provider_id: '<b>x</b>',
          request_count: 1,
          success_count: 1,
          error_count: 0,
          error_rate: 0,
          input_tokens_exact: 1,
          output_tokens_exact: 0,
          cache_read_requests: 0,
          estimated_cost_value: null,
        },
      ],
      false,
    )
    assert.ok(!html.includes('<b>x</b>'))
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'))
  })
})
