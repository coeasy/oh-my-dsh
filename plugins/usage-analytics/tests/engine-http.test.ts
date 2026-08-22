import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { registerUsageHttpApi, type WebServerLike } from '../src/engine-http.ts'

interface FakeResponse {
  status: number
  headers: Record<string, string>
  body: string
}

function fakeWebServer(): {
  server: WebServerLike
  routes: Map<string, (req: any, res: FakeResponse) => void>
} {
  const routes = new Map<string, (req: any, res: FakeResponse) => void>()
  const server: WebServerLike = {
    register: (opts) => {
      routes.set(opts.path, (req: any, res: FakeResponse) => {
        const response = {
          writeHead: (status: number, headers?: Record<string, string>) => {
            res.status = status
            res.headers = headers ?? {}
          },
          end: (body?: string) => {
            res.body = body ?? ''
          },
        }
        opts.handler(req, response)
      })
    },
  }
  return { server, routes }
}

describe('registerUsageHttpApi', () => {
  it('registers all routes', () => {
    const { server, routes } = fakeWebServer()
    registerUsageHttpApi(server, () => ({
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
    for (const p of [
      '/usage-analytics/api/status',
      '/usage-analytics/api/overview',
      '/usage-analytics/api/providers',
      '/usage-analytics/api/cache',
      '/usage-analytics/api/events',
    ]) {
      assert.ok(routes.has(p), `missing ${p}`)
    }
  })

  it('serves overview data', () => {
    const { server, routes } = fakeWebServer()
    registerUsageHttpApi(server, () => ({
      getStatus: () => ({ enabled: true }),
      queryOverview: () => ({ request_count: 42 }),
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
    const res: FakeResponse = { status: 0, headers: {}, body: '' }
    routes.get('/usage-analytics/api/overview')!(
      { method: 'GET', url: '/usage-analytics/api/overview' },
      res,
    )
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), { ok: true, data: { request_count: 42 } })
  })

  it('returns 503 when service not loaded', () => {
    const { server, routes } = fakeWebServer()
    registerUsageHttpApi(server, () => null)
    const res: FakeResponse = { status: 0, headers: {}, body: '' }
    routes.get('/usage-analytics/api/overview')!(
      { method: 'GET', url: '/usage-analytics/api/overview' },
      res,
    )
    assert.equal(res.status, 503)
    assert.deepEqual(JSON.parse(res.body), {
      ok: false,
      error: 'Usage Analytics plugin not loaded/enabled',
    })
  })

  it('rejects non-GET', () => {
    const { server, routes } = fakeWebServer()
    registerUsageHttpApi(server, () => ({
      getStatus: () => ({}),
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
    const res: FakeResponse = { status: 0, headers: {}, body: '' }
    routes.get('/usage-analytics/api/overview')!(
      { method: 'POST', url: '/usage-analytics/api/overview' },
      res,
    )
    assert.equal(res.status, 405)
  })

  it('passes limit/offset to events', () => {
    const { server, routes } = fakeWebServer()
    let seen: [number, number] | null = null
    registerUsageHttpApi(server, () => ({
      getStatus: () => ({}),
      queryOverview: () => ({}),
      queryProviders: () => [],
      queryCache: () => ({}),
      queryEvents: (limit, offset) => {
        seen = [limit, offset]
        return []
      },
      queryTrend: () => [],
      queryModels: () => [],
      querySession: () => [],
      queryTurn: () => [],
      querySessionStats: () => null,
      exportUsage: () => '',
    }))
    const res: FakeResponse = { status: 0, headers: {}, body: '' }
    routes.get('/usage-analytics/api/events')!(
      { method: 'GET', url: '/usage-analytics/api/events?limit=25&offset=10' },
      res,
    )
    assert.deepEqual(seen, [25, 10])
  })

  it('registers upgraded query routes (trend/models/session/export)', () => {
    const { server, routes } = fakeWebServer()
    registerUsageHttpApi(server, () => ({
      getStatus: () => ({}),
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
    for (const p of [
      '/usage-analytics/api/trend',
      '/usage-analytics/api/models',
      '/usage-analytics/api/session',
      '/usage-analytics/api/export',
    ]) {
      assert.ok(routes.has(p), `missing ${p}`)
    }
  })

  it('serves trend with days parameter', () => {
    const { server, routes } = fakeWebServer()
    let days: number | null = null
    registerUsageHttpApi(server, () => ({
      getStatus: () => ({}),
      queryOverview: () => ({}),
      queryProviders: () => [],
      queryCache: () => ({}),
      queryEvents: () => [],
      queryTrend: (d) => {
        days = d
        return [{ date: '2026-08-20', request_count: 1 }]
      },
      queryModels: () => [],
      querySession: () => [],
      queryTurn: () => [],
      querySessionStats: () => null,
      exportUsage: () => '',
    }))
    const res: FakeResponse = { status: 0, headers: {}, body: '' }
    routes.get('/usage-analytics/api/trend')!(
      { method: 'GET', url: '/usage-analytics/api/trend?days=7' },
      res,
    )
    assert.equal(days, 7)
    assert.equal(res.status, 200)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.data[0].date, '2026-08-20')
  })

  it('serves session vs turn based on turn_id', () => {
    const { server, routes } = fakeWebServer()
    const calls: string[] = []
    registerUsageHttpApi(server, () => ({
      getStatus: () => ({}),
      queryOverview: () => ({}),
      queryProviders: () => [],
      queryCache: () => ({}),
      queryEvents: () => [],
      queryTrend: () => [],
      queryModels: () => [],
      querySession: (s) => {
        calls.push(`session:${s}`)
        return ['s']
      },
      queryTurn: (s, t) => {
        calls.push(`turn:${s}/${t}`)
        return ['t']
      },
      querySessionStats: () => null,
      exportUsage: () => '',
    }))
    const res: FakeResponse = { status: 0, headers: {}, body: '' }
    routes.get('/usage-analytics/api/session')!(
      { method: 'GET', url: '/usage-analytics/api/session?session_id=abc' },
      res,
    )
    routes.get('/usage-analytics/api/session')!(
      { method: 'GET', url: '/usage-analytics/api/session?session_id=abc&turn_id=2' },
      res,
    )
    assert.deepEqual(calls, ['session:abc', 'turn:abc/2'])
  })

  it('serves export with correct content type', () => {
    const { server, routes } = fakeWebServer()
    registerUsageHttpApi(server, () => ({
      getStatus: () => ({}),
      queryOverview: () => ({}),
      queryProviders: () => [],
      queryCache: () => ({}),
      queryEvents: () => [],
      queryTrend: () => [],
      queryModels: () => [],
      querySession: () => [],
      queryTurn: () => [],
      querySessionStats: () => null,
      exportUsage: (fmt) => (fmt === 'csv' ? 'a,b' : '[{}]'),
    }))
    const res: FakeResponse = { status: 0, headers: {}, body: '' }
    routes.get('/usage-analytics/api/export')!(
      { method: 'GET', url: '/usage-analytics/api/export?format=csv' },
      res,
    )
    assert.equal(res.status, 200)
    assert.equal((res.headers['content-type'] as string).startsWith('text/csv'), true)
    assert.equal(res.body, 'a,b')
  })

  it('serves session-stats route', () => {
    const { server, routes } = fakeWebServer()
    registerUsageHttpApi(server, () => ({
      getStatus: () => ({}),
      queryOverview: () => ({}),
      queryProviders: () => [],
      queryCache: () => ({}),
      queryEvents: () => [],
      queryTrend: () => [],
      queryModels: () => [],
      querySession: () => [],
      queryTurn: () => [],
      querySessionStats: () => ({ session_id: 's1', turn_count: 3, cost_enabled: false }),
      exportUsage: () => '',
    }))
    const res: FakeResponse = { status: 0, headers: {}, body: '' }
    routes.get('/usage-analytics/api/session-stats')!(
      { method: 'GET', url: '/usage-analytics/api/session-stats' },
      res,
    )
    assert.equal(res.status, 200)
    const parsed = JSON.parse(res.body)
    assert.equal(parsed.data.session_id, 's1')
    assert.equal(parsed.data.turn_count, 3)
  })
})
