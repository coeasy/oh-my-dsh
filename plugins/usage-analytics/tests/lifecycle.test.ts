import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createService, type UsageAnalyticsContext } from '../src/index.ts'
import type { SafeObservedEvent } from '../src/normalizer.ts'

function mockCtx(): { ctx: UsageAnalyticsContext; events: Record<string, any[]> } {
  const events: Record<string, any[]> = {}
  const ctx: UsageAnalyticsContext = {
    on: (ev, fn) => {
      ;(events[ev] ??= []).push(fn)
    },
    emit: (ev, payload) => {
      ;(events[ev] ??= []).push(payload)
    },
  }
  return { ctx, events }
}

function rawEvent(over: Partial<SafeObservedEvent> = {}): SafeObservedEvent {
  return {
    session_id: over.session_id ?? 's1',
    logical_request_id: 'req_1',
    attempt_id: 'a1',
    provider_id: 'openai-compatible',
    model_id: 'gpt-x',
    status: 'completed',
    started_at: '2026-08-20T11:59:50.000Z',
    completed_at: '2026-08-20T12:00:00.000Z',
    ...over,
  }
}

describe('Usage Analytics Cordis lifecycle', () => {
  it('installed but disabled: does not collect', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {})
    assert.equal(service.getStatus().enabled, false)
    assert.equal(service.ingest(rawEvent()), false)
    assert.equal(service.getStatus().collected, 0)
  })

  it('enabled: collects events', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {})
    service.setEnabled(true)
    assert.equal(service.ingest(rawEvent()), true)
    assert.equal(service.getStatus().collected, 1)
    service.flush()
    const overview: any = service.queryOverview()
    assert.equal(overview.request_count, 1)
  })

  it('disabled: stops collecting but keeps data', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {})
    service.setEnabled(true)
    service.ingest(rawEvent({ logical_request_id: 'r1' }))
    service.setEnabled(false)
    assert.equal(service.ingest(rawEvent({ logical_request_id: 'r2' })), false)
    service.flush()
    const overview: any = service.queryOverview()
    assert.equal(overview.request_count, 1)
  })

  it('dedupes repeated events in plugin', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {})
    service.setEnabled(true)
    assert.equal(service.ingest(rawEvent()), true)
    assert.equal(service.ingest(rawEvent()), false)
    service.flush()
    const overview: any = service.queryOverview()
    assert.equal(overview.request_count, 1)
  })

  it('maps tokens from provider usage via declarative mapping', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {
      providerMapping: {
        id: 'openai',
        match: {},
        usage: {
          input_tokens: ['$.prompt_tokens'],
          output_tokens: ['$.completion_tokens'],
          cache_read_tokens: ['$.prompt_tokens_details.cached_tokens'],
        },
        streaming: { strategy: 'final_usage_preferred' },
      },
    })
    service.setEnabled(true)
    service.ingest(
      rawEvent({
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 30 },
        },
      }),
    )
    service.flush()
    const providers = service.queryProviders() as any[]
    assert.equal(providers[0].input_tokens_exact, 100)
    assert.equal(providers[0].output_tokens_exact, 50)
    const cache: any = service.queryCache()
    assert.equal(cache.cache_read_tokens_exact, 30)
  })

  it('subscribes to harness session events when enabled with a seam', async () => {
    const { ctx } = mockCtx()
    const handlers: Array<(ev: any) => void> = []
    const fakeSession = { id: 'sess_1', on: () => {} }
    const service = await createService(ctx, {
      harness: {
        getSession: () => fakeSession,
        subscribeSession: (_s, on) => {
          handlers.push(on)
          return () => {
            handlers.splice(handlers.indexOf(on), 1)
          }
        },
      },
    })
    // disabled: subscribing but not collecting until enabled
    assert.equal(service.getStatus().enabled, false)
    service.setEnabled(true)
    assert.equal(handlers.length, 1)
    // feed a real-shaped assistant/message event
    handlers[0]({
      type: 'assistant/message',
      turn: 1,
      step: 0,
      message: {},
      usage: { inputTokens: 700, outputTokens: 90, cacheReadTokens: 200 },
    })
    service.flush()
    const overview: any = service.queryOverview()
    assert.equal(overview.request_count, 1)
    assert.equal(overview.input_tokens_exact, 700)
    // disable stops observer
    service.setEnabled(false)
    assert.equal(handlers.length, 0)
  })

  it('registers engine HTTP routes when a webServer seam is provided', async () => {
    const { ctx } = mockCtx()
    const registered: string[] = []
    const fakeWebServer = {
      register: (opts: { path: string }) => {
        registered.push(opts.path)
        return () => {}
      },
    }
    const service = await createService(ctx, { engine: { webServer: fakeWebServer } })
    service.setEnabled(true)
    service.ingest(rawEvent({ usage: { input_tokens: 5 } }))
    service.flush()
    assert.ok(registered.includes('/usage-analytics/api/overview'))
    assert.ok(registered.includes('/usage-analytics/api/providers'))
    assert.ok(registered.includes('/usage-analytics/api/cache'))
    assert.ok(registered.includes('/usage-analytics/api/events'))
  })

  it('emits status_changed on enable', async () => {
    const { ctx, events } = mockCtx()
    const service = await createService(ctx, {})
    service.setEnabled(true)
    const payload = events['usage.plugin.status_changed']
    assert.ok(payload && payload.length > 0)
    assert.equal(payload[0].enabled, true)
  })

  it('cost estimation is off by default and marked unknown', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {
      providerMapping: {
        id: 'openai',
        match: {},
        usage: { input_tokens: ['$.prompt_tokens'], output_tokens: ['$.completion_tokens'] },
        streaming: { strategy: 'final_usage_preferred' },
      },
    })
    service.setEnabled(true)
    service.ingest(rawEvent({ usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } }))
    service.flush()
    const overview: any = service.queryOverview()
    assert.equal(overview.estimated_cost_value, 0)
    assert.equal(overview.has_estimated, false)
  })

  it('cost estimation is opt-in and marks cost as estimated', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {
      costEnabled: true,
      priceTable: {
        id: 'test',
        version: '1',
        currency: 'USD',
        models: {},
        default: { input_per_mtok: 0.5, output_per_mtok: 1.5 },
      },
      providerMapping: {
        id: 'openai',
        match: {},
        usage: { input_tokens: ['$.prompt_tokens'], output_tokens: ['$.completion_tokens'] },
        streaming: { strategy: 'final_usage_preferred' },
      },
    })
    service.setEnabled(true)
    service.ingest(rawEvent({ usage: { prompt_tokens: 1_000_000, completion_tokens: 2_000_000 } }))
    service.flush()
    const overview: any = service.queryOverview()
    assert.equal(overview.has_estimated, true)
    assert.ok(Math.abs(overview.estimated_cost_value - 3.5) < 1e-6)
    const settings = service.getSettings()
    assert.equal(settings.costEnabled, true)
  })

  it('session stats track the most recent active session', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {})
    service.setEnabled(true)
    assert.equal(service.querySessionStats(), null)
    service.ingest(rawEvent({ logical_request_id: 'r1', usage: { input_tokens: 100 } }))
    service.ingest(rawEvent({ logical_request_id: 'r2', usage: { input_tokens: 50 } }))
    service.flush()
    const stats: any = service.querySessionStats()
    assert.equal(stats.session_id, 's1')
    assert.equal(stats.request_count, 2)
    assert.equal(stats.cost_enabled, false)
  })

  it('session stats reflect the cost capability switch', async () => {
    const { ctx } = mockCtx()
    const service = await createService(ctx, {
      costEnabled: true,
      priceTable: {
        id: 'test',
        version: '1',
        currency: 'USD',
        models: {},
        default: { input_per_mtok: 0.5, output_per_mtok: 1.5 },
      },
      providerMapping: {
        id: 'openai',
        match: {},
        usage: { input_tokens: ['$.prompt_tokens'], output_tokens: ['$.completion_tokens'] },
        streaming: { strategy: 'final_usage_preferred' },
      },
    })
    service.setEnabled(true)
    service.ingest(rawEvent({ usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } }))
    service.flush()
    const stats: any = service.querySessionStats()
    assert.equal(stats.cost_enabled, true)
    assert.ok(Math.abs(stats.cost_value - 2.0) < 1e-6)
  })

  it('persists to disk when dbPath is set and reloads on restart', async () => {
    const os = await import('node:os')
    const path = await import('node:path')
    const fs = await import('node:fs')
    const dbPath = path.join(os.tmpdir(), `dsh-usage-test-${Date.now()}.db`)
    const svc1 = await createService(mockCtx().ctx, { dbPath })
    svc1.setEnabled(true)
    svc1.ingest(rawEvent({ logical_request_id: 'r1' }))
    svc1.ingest(rawEvent({ logical_request_id: 'r2' }))
    svc1.flush()
    // Simulate a restart: fresh apply on the same dbPath must reload persisted data.
    const svc2 = await createService(mockCtx().ctx, { dbPath })
    const overview: any = svc2.queryOverview()
    assert.equal(overview.request_count, 2)
    fs.rmSync(dbPath, { force: true })
    try {
      fs.rmSync(`${dbPath}.tmp`, { force: true })
    } catch {
      // tmp may not exist
    }
  })
})
