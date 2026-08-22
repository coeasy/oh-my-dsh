import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  dispatchUsageAnalyticsAction,
  clearUsageAnalyticsHttpClient,
  setUsageAnalyticsHttpClient,
  setUsageAnalyticsResolver,
} from '../src/plugins/usage-analytics-host.ts'

function mockHttp(
  url: string,
  handler: (path: string) => { ok: boolean; data?: unknown; error?: string },
) {
  setUsageAnalyticsHttpClient({
    harnessUrl: url,
    fetchImpl: async (u) => {
      const path = new URL(u).pathname + new URL(u).search
      const res = handler(path)
      return {
        ok: true,
        status: 200,
        json: async () => res,
      } as unknown as Response
    },
  })
}

describe('dispatchUsageAnalyticsAction over HTTP client', () => {
  beforeEach(() => {
    clearUsageAnalyticsHttpClient()
    setUsageAnalyticsResolver(() => null)
  })

  it('queries overview through the engine HTTP API', async () => {
    let called = ''
    mockHttp('http://127.0.0.1:1234', (path) => {
      called = path
      return { ok: true, data: { request_count: 7 } }
    })
    const result = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'overview' },
    })
    assert.equal(result.ok, true)
    assert.deepEqual((result.data as any).request_count, 7)
    assert.ok(called.includes('/usage-analytics/api/overview'))
  })

  it('routes providers/cache/events to their endpoints', async () => {
    const seen: string[] = []
    mockHttp('http://127.0.0.1:1', (path) => {
      seen.push(path)
      return { ok: true, data: {} }
    })
    await dispatchUsageAnalyticsAction({ kind: 'query', payload: { view: 'providers' } })
    await dispatchUsageAnalyticsAction({ kind: 'query', payload: { view: 'cache' } })
    await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'events', limit: 25, offset: 5 },
    })
    assert.ok(seen.some((p) => p.includes('/usage-analytics/api/providers')))
    assert.ok(seen.some((p) => p.includes('/usage-analytics/api/cache')))
    assert.ok(seen.some((p) => p.includes('/usage-analytics/api/events?limit=25&offset=5')))
  })

  it('routes trend/models/session/export to their endpoints', async () => {
    const seen: string[] = []
    mockHttp('http://127.0.0.1:1', (path) => {
      seen.push(path)
      return { ok: true, data: {} }
    })
    await dispatchUsageAnalyticsAction({ kind: 'query', payload: { view: 'trend', days: 14 } })
    await dispatchUsageAnalyticsAction({ kind: 'query', payload: { view: 'models' } })
    await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'session', session_id: 'abc', turn_id: '2' },
    })
    await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'export', format: 'csv' },
    })
    assert.ok(seen.some((p) => p.includes('/usage-analytics/api/trend?days=14')))
    assert.ok(seen.some((p) => p.includes('/usage-analytics/api/models')))
    assert.ok(seen.some((p) => p.includes('/usage-analytics/api/session?session_id=abc&turn_id=2')))
    assert.ok(seen.some((p) => p.includes('/usage-analytics/api/export?format=csv')))
  })

  it('routes session-stats to its endpoint', async () => {
    let seen = ''
    mockHttp('http://127.0.0.1:1', (path) => {
      seen = path
      return { ok: true, data: { session_id: 's1', turn_count: 2 } }
    })
    const result = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'session-stats' },
    })
    assert.ok(seen.includes('/usage-analytics/api/session-stats'))
    assert.equal((result.data as any).turn_count, 2)
  })

  it('in-process resolver serves all views', async () => {
    setUsageAnalyticsResolver(() => ({
      getStatus: () => ({ enabled: true }),
      queryOverview: () => ({ request_count: 3 }),
      queryProviders: () => [],
      queryCache: () => ({}),
      queryEvents: () => [],
      queryTrend: (days) => [{ date: 'x', days }],
      queryModels: () => ['m'],
      querySession: (s) => [{ session: s }],
      queryTurn: (s, t) => [{ session: s, turn: t }],
      querySessionStats: () => ({ session_id: 's1', turn_count: 4 }),
      exportUsage: (fmt) => `fmt:${fmt}`,
    }))
    const trend = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'trend', days: 5 },
    })
    assert.deepEqual((trend.data as any)[0].days, 5)
    const models = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'models' },
    })
    assert.deepEqual(models.data, ['m'])
    const sess = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'session', session_id: 's1' },
    })
    assert.deepEqual(sess.data, [{ session: 's1' }])
    const turn = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'session', session_id: 's1', turn_id: 't1' },
    })
    assert.deepEqual(turn.data, [{ session: 's1', turn: 't1' }])
    const exportRes = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'export', format: 'json' },
    })
    assert.equal(exportRes.data, 'fmt:json')
    const stats = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'session-stats' },
    })
    assert.equal((stats.data as any).turn_count, 4)
  })

  it('status falls back to in-process resolver when no HTTP client', async () => {
    setUsageAnalyticsResolver(() => ({
      getStatus: () => ({ enabled: true, collected: 5 }),
      queryOverview: () => ({}),
      queryProviders: () => [],
      queryCache: () => ({}),
      queryEvents: () => [],
      queryTrend: () => [],
      queryModels: () => [],
      querySession: () => [],
      queryTurn: () => [],
      querySessionStats: () => null,
      exportUsage: () => '',
    }))
    const result = await dispatchUsageAnalyticsAction({ kind: 'status' })
    assert.equal(result.ok, true)
    assert.equal((result.data as any).collected, 5)
  })

  it('falls back to in-process resolver when no HTTP client', async () => {
    setUsageAnalyticsResolver(() => ({
      getStatus: () => ({ enabled: true }),
      queryOverview: () => ({ request_count: 3 }),
      queryProviders: () => [],
      queryCache: () => ({}),
      queryEvents: () => [],
      queryTrend: () => [],
      queryModels: () => [],
      querySession: () => [],
      queryTurn: () => [],
      querySessionStats: () => null,
      exportUsage: () => '',
    }))
    const result = await dispatchUsageAnalyticsAction({
      kind: 'query',
      payload: { view: 'overview' },
    })
    assert.equal((result.data as any).request_count, 3)
  })
})
