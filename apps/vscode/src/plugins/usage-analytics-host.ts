/**
 * VS Code extension-host handler for Usage Analytics requests.
 *
 * The webview renderer (apps/vscode/src/plugins/usage-analytics-bridge.ts) sends
 * `usage-analytics:request` messages; this module resolves them against a
 * pluggable service (in-process) or the engine HTTP client, and posts
 * `usage-analytics:response` back. Kept free of a hard `vscode` import so it is
 * unit-testable under node:test; the extension wires it with its own API.
 */

export interface VsCodeUsageRequestMessage {
  channel: 'usage-analytics:request'
  requestId: string
  payload?: {
    view?: string
    limit?: number
    offset?: number
    days?: number
    session_id?: string
    turn_id?: string
    format?: string
  }
}

export interface VsCodeUsageHostOptions {
  resolveService: () => {
    queryOverview(): unknown
    queryProviders(): unknown
    queryCache(): unknown
    queryTrend(days: number): unknown
    queryModels(): unknown
    querySession(sessionId: string): unknown
    queryTurn(sessionId: string, turnId: string): unknown
    queryEvents(limit: number, offset: number): unknown
    exportUsage(format: 'json' | 'csv'): string
  } | null
  postMessage: (message: { channel: 'usage-analytics:response'; requestId: string; data: unknown }) => void
}

/** Handle one request message and produce a response payload. */
export function handleUsageRequest(
  msg: VsCodeUsageRequestMessage,
  opts: VsCodeUsageHostOptions,
): { ok: boolean; data?: unknown; error?: string } {
  const svc = opts.resolveService()
  if (!svc) return { ok: false, error: 'Usage Analytics plugin is not loaded/enabled' }
  const p = msg.payload ?? {}
  try {
    switch (p.view ?? 'overview') {
      case 'providers':
        return { ok: true, data: svc.queryProviders() }
      case 'cache':
        return { ok: true, data: svc.queryCache() }
      case 'events':
        return { ok: true, data: svc.queryEvents(p.limit ?? 50, p.offset ?? 0) }
      case 'trend':
        return { ok: true, data: svc.queryTrend(p.days ?? 30) }
      case 'models':
        return { ok: true, data: svc.queryModels() }
      case 'session':
        return {
          ok: true,
          data: p.turn_id
            ? svc.queryTurn(p.session_id ?? '', String(p.turn_id))
            : svc.querySession(p.session_id ?? ''),
        }
      case 'export':
        return { ok: true, data: svc.exportUsage(p.format === 'csv' ? 'csv' : 'json') }
      case 'overview':
      default:
        return { ok: true, data: svc.queryOverview() }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Build a message listener bound to a specific webview channel. */
export function createUsageRequestListener(opts: VsCodeUsageHostOptions): (event: unknown) => void {
  return (event: unknown) => {
    const msg = event as VsCodeUsageRequestMessage
    if (!msg || msg.channel !== 'usage-analytics:request' || !msg.requestId) return
    const result = handleUsageRequest(msg, opts)
    opts.postMessage({
      channel: 'usage-analytics:response',
      requestId: msg.requestId,
      data: result,
    })
  }
}
