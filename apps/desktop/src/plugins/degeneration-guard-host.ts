/**
 * Desktop main-process host for the Degeneration Guard plugin.
 *
 * Reaches the plugin's engine-side loopback HTTP API
 * (`GET /degeneration-guard/api/call?method=..&args=..`) so the renderer bridge
 * (`window.dshDesktop.degenerationGuard`) can drive every service method across
 * the process boundary. Mirrors usage-analytics-host.ts; the HTTP client is set
 * once the engine reports ready with its loopback URL.
 */

export interface DegenerationGuardHttpClientOptions {
  harnessUrl: string
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
}

let httpClient: DegenerationGuardHttpClientOptions | null = null

export function setDegenerationGuardHttpClient(opts: DegenerationGuardHttpClientOptions): void {
  httpClient = opts
}

export function clearDegenerationGuardHttpClient(): void {
  httpClient = null
}

/** RPC-style request matching the preload bridge contract. */
export interface DegenerationGuardBridgeRequest {
  kind: 'call'
  method: string
  args?: unknown[]
}

export async function dispatchDegenerationGuardAction(
  request: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const req = (request ?? {}) as Partial<DegenerationGuardBridgeRequest>
  if (req.kind !== 'call') {
    return { ok: false, error: `unknown degeneration-guard action: ${String(req.kind)}` }
  }
  if (!httpClient) {
    return { ok: false, error: 'Degeneration Guard host not wired (plugin not loaded/enabled?)' }
  }
  try {
    const base = new URL('/degeneration-guard/api', httpClient.harnessUrl).href.replace(/\/$/, '')
    const q = new URLSearchParams()
    q.set('method', req.method ?? '')
    q.set('args', JSON.stringify(req.args ?? []))
    const res = await httpClient.fetchImpl(`${base}/call?${q.toString()}`, {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`degeneration-guard HTTP ${res.status}`)
    const json = (await res.json()) as { ok?: boolean; data?: unknown; error?: string }
    if (json.ok === false) throw new Error(json.error ?? 'degeneration-guard request failed')
    return { ok: true, data: json.data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
