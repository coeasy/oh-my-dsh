/**
 * Engine-side HTTP API for the Usage Analytics plugin.
 *
 * Registers loopback HTTP routes on the engine's `webServer` (mirroring the
 * plugin-marketplace pattern) so the desktop main process can query plugin data
 * across the process boundary via `fetch(host.url + path)`. The engine binds to
 * 127.0.0.1 only (loopback), matching the plan's security boundary.
 *
 * Routes:
 *   GET /usage-analytics/api/status
 *   GET /usage-analytics/api/overview
 *   GET /usage-analytics/api/providers
 *   GET /usage-analytics/api/cache
 *   GET /usage-analytics/api/events?limit=&offset=
 *
 * Duck-typed against the Cordis webServer service (no hard import).
 */

/** Minimal service surface the HTTP layer needs (matches desktop resolver). */
export interface UsageAnalyticsServiceLike {
  getStatus(): unknown
  queryOverview(): unknown
  queryProviders(): unknown
  queryCache(): unknown
  queryTrend(days: number): unknown
  queryModels(): unknown
  querySession(sessionId: string): unknown
  queryTurn(sessionId: string, turnId: string): unknown
  querySessionStats(): unknown
  queryEvents(limit: number, offset: number): unknown
  exportUsage(format: 'json' | 'csv'): string
}

/** Duck-typed webServer route registration object from Cordis. */
export interface WebServerLike {
  register(opts: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (
      request: { method?: string; url?: string },
      response: {
        writeHead(status: number, headers?: Record<string, string>): void
        end(body?: string): void
      },
    ) => void
  }): unknown
}

export function sendJson(
  response: {
    writeHead(status: number, headers?: Record<string, string>): void
    end(body?: string): void
  },
  status: number,
  body: unknown,
): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(text)
}

function readQuery(urlString: string | undefined): URLSearchParams {
  return new URL(urlString ?? '/', 'http://localhost').searchParams
}

export function registerUsageHttpApi(
  webServer: WebServerLike,
  getService: () => UsageAnalyticsServiceLike | null,
): Array<() => void> {
  const disposers: Array<() => void> = []

  const route = (
    path: string,
    run: (
      req: { method?: string; url?: string },
      res: { writeHead(s: number, h?: Record<string, string>): void; end(b?: string): void },
    ) => void,
  ): void => {
    webServer.register({
      kind: 'exact',
      path,
      handler: (req, res) => {
        if (req.method && req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        try {
          const svc = getService()
          if (!svc) {
            sendJson(res, 503, { ok: false, error: 'Usage Analytics plugin not loaded/enabled' })
            return
          }
          run(req, res)
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    })
    disposers.push(() => {})
  }

  route('/usage-analytics/api/status', (_req, res) => {
    sendJson(res, 200, getService()!.getStatus())
  })
  route('/usage-analytics/api/overview', (_req, res) => {
    sendJson(res, 200, { ok: true, data: getService()!.queryOverview() })
  })
  route('/usage-analytics/api/providers', (_req, res) => {
    sendJson(res, 200, { ok: true, data: getService()!.queryProviders() })
  })
  route('/usage-analytics/api/cache', (_req, res) => {
    sendJson(res, 200, { ok: true, data: getService()!.queryCache() })
  })
  route('/usage-analytics/api/events', (req, res) => {
    const q = readQuery(req.url)
    const limit = Number(q.get('limit') ?? 50)
    const offset = Number(q.get('offset') ?? 0)
    sendJson(res, 200, { ok: true, data: getService()!.queryEvents(limit, offset) })
  })
  route('/usage-analytics/api/trend', (req, res) => {
    const q = readQuery(req.url)
    const days = Number(q.get('days') ?? 30)
    sendJson(res, 200, { ok: true, data: getService()!.queryTrend(days) })
  })
  route('/usage-analytics/api/models', (_req, res) => {
    sendJson(res, 200, { ok: true, data: getService()!.queryModels() })
  })
  route('/usage-analytics/api/session-stats', (_req, res) => {
    sendJson(res, 200, { ok: true, data: getService()!.querySessionStats() })
  })
  route('/usage-analytics/api/session', (req, res) => {
    const q = readQuery(req.url)
    const sessionId = q.get('session_id') ?? ''
    const turnId = q.get('turn_id')
    sendJson(res, 200, {
      ok: true,
      data: turnId
        ? getService()!.queryTurn(sessionId, turnId)
        : getService()!.querySession(sessionId),
    })
  })
  route('/usage-analytics/api/export', (req, res) => {
    const q = readQuery(req.url)
    const format = (q.get('format') === 'csv' ? 'csv' : 'json') as 'json' | 'csv'
    const body = getService()!.exportUsage(format)
    res.writeHead(200, { 'content-type': format === 'csv' ? 'text/csv' : 'application/json' })
    res.end(body)
  })

  return disposers
}
