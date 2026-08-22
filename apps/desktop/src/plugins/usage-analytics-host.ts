/**
 * Desktop main-process dispatch for Usage Analytics actions.
 *
 * Two sources for plugin data:
 *  1. In-process resolver (`setUsageAnalyticsResolver`) — used when the plugin
 *     service lives in the same process.
 *  2. Engine HTTP client (`setUsageAnalyticsHttpClient`) — the primary path:
 *     queries the engine's loopback `/usage-analytics/api/*` routes that the
 *     plugin registers (plugins/usage-analytics/src/engine-http.ts). Mirrors
 *     the plugin-marketplace broker pattern.
 */

export interface UsageAnalyticsQueryRequest {
  range?: string
  start?: string
  end?: string
  filters?: Record<string, unknown>
}

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

export type UsageAnalyticsResolver = () => UsageAnalyticsServiceLike | null

let resolver: UsageAnalyticsResolver | null = null

export function setUsageAnalyticsResolver(fn: UsageAnalyticsResolver): void {
  resolver = fn
}

export interface UsageAnalyticsHttpClientOptions {
  harnessUrl: string
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
}

let httpClient: UsageAnalyticsHttpClientOptions | null = null

export function setUsageAnalyticsHttpClient(opts: UsageAnalyticsHttpClientOptions): void {
  httpClient = opts
}

export function clearUsageAnalyticsHttpClient(): void {
  httpClient = null
}

async function httpGet(path: string): Promise<unknown> {
  if (!httpClient) throw new Error('usage-analytics HTTP client is not configured')
  const base = new URL('/usage-analytics/api', httpClient.harnessUrl).href.replace(/\/$/, '')
  const res = await httpClient.fetchImpl(`${base}${path}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`usage-analytics HTTP ${res.status}`)
  const json = (await res.json()) as { ok?: boolean; data?: unknown; error?: string }
  if (json.ok === false) throw new Error(json.error ?? 'usage-analytics request failed')
  return json.data
}

export async function dispatchUsageAnalyticsAction(request: {
  kind: string
  payload?: unknown
}): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (request.kind === 'status') {
    // HTTP client is the primary path; fall back to the in-process resolver when
    // it is not configured (same contract as the query path).
    if (httpClient) {
      try {
        return { ok: true, data: await httpGet('/status') }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    const svc = resolver?.()
    if (!svc) return { ok: false, error: 'Usage Analytics plugin is not loaded/enabled' }
    return { ok: true, data: svc.getStatus() }
  }
  const payload = (request.payload ?? {}) as UsageAnalyticsQueryRequest & {
    view?: string
    limit?: number
    offset?: number
    days?: number
    session_id?: string
    turn_id?: string
    format?: string
  }
  const view = payload.view ?? 'overview'
  // Preferred: engine HTTP client — fetch only the needed endpoint.
  if (httpClient) {
    try {
      const path =
        view === 'providers'
          ? '/providers'
          : view === 'cache'
            ? '/cache'
            : view === 'events'
              ? `/events?limit=${payload.limit ?? 50}&offset=${payload.offset ?? 0}`
              : view === 'trend'
                ? `/trend?days=${payload.days ?? 30}`
                : view === 'models'
                  ? '/models'
                  : view === 'session'
                    ? `/session?session_id=${encodeURIComponent(payload.session_id ?? '')}${payload.turn_id ? `&turn_id=${encodeURIComponent(String(payload.turn_id))}` : ''}`
                    : view === 'session-stats'
                      ? '/session-stats'
                      : view === 'export'
                        ? `/export?format=${payload.format === 'csv' ? 'csv' : 'json'}`
                        : view === 'settings'
                          ? '/status'
                          : '/overview'
      const data = await httpGet(path)
      return { ok: true, data }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  // Fallback: in-process resolver.
  const svc = resolver?.()
  if (!svc) return { ok: false, error: 'Usage Analytics plugin is not loaded/enabled' }
  return dispatchFromService(svc, request)
}

function dispatchFromService(
  svc: UsageAnalyticsServiceLike,
  request: { kind: string; payload?: unknown },
): { ok: boolean; data?: unknown; error?: string } {
  try {
    switch (request.kind) {
      case 'status':
        return { ok: true, data: svc.getStatus() }
      case 'query': {
        const payload = (request.payload ?? {}) as UsageAnalyticsQueryRequest & {
          view?: string
          limit?: number
          offset?: number
          days?: number
          session_id?: string
          turn_id?: string
          format?: string
        }
        const view = payload.view ?? 'overview'
        const data =
          view === 'providers'
            ? svc.queryProviders()
            : view === 'cache'
              ? svc.queryCache()
              : view === 'events'
                ? svc.queryEvents(payload.limit ?? 50, payload.offset ?? 0)
                : view === 'trend'
                  ? svc.queryTrend(payload.days ?? 30)
                  : view === 'models'
                    ? svc.queryModels()
                    : view === 'session'
                      ? payload.turn_id
                        ? svc.queryTurn(payload.session_id ?? '', String(payload.turn_id))
                        : svc.querySession(payload.session_id ?? '')
                      : view === 'session-stats'
                        ? svc.querySessionStats()
                        : view === 'export'
                          ? svc.exportUsage(payload.format === 'csv' ? 'csv' : 'json')
                          : view === 'settings'
                            ? svc.getStatus()
                            : svc.queryOverview()
        return { ok: true, data }
      }
      default:
        return { ok: false, error: `unknown usage-analytics action: ${request.kind}` }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
