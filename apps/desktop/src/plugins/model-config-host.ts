/**
 * Desktop main-process host for the Model Config plugin.
 *
 * Reaches the plugin's engine-side loopback HTTP API
 * (`GET /model-config/api/call?method=..&args=..`) so the renderer bridge
 * (`window.dshDesktop.modelConfig`) can drive every service method across the
 * process boundary. Mirrors usage-analytics-host.ts; the HTTP client is set once
 * the engine reports ready with its loopback URL.
 */

export interface ModelConfigHttpClientOptions {
  harnessUrl: string
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
}

let httpClient: ModelConfigHttpClientOptions | null = null

export function setModelConfigHttpClient(opts: ModelConfigHttpClientOptions): void {
  httpClient = opts
}

export function clearModelConfigHttpClient(): void {
  httpClient = null
}

/** RPC-style request matching the preload bridge contract. */
export interface ModelConfigBridgeRequest {
  kind: 'call'
  method: string
  args?: unknown[]
}

export async function dispatchModelConfigAction(
  request: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const req = (request ?? {}) as Partial<ModelConfigBridgeRequest>
  if (req.kind !== 'call') {
    return { ok: false, error: `unknown model-config action: ${String(req.kind)}` }
  }
  if (!httpClient) {
    return { ok: false, error: 'Model Config host not wired (plugin not loaded/enabled?)' }
  }
  try {
    const base = new URL('/model-config/api', httpClient.harnessUrl).href.replace(/\/$/, '')
    const q = new URLSearchParams()
    q.set('method', req.method ?? '')
    q.set('args', JSON.stringify(req.args ?? []))
    const res = await httpClient.fetchImpl(`${base}/call?${q.toString()}`, {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`model-config HTTP ${res.status}`)
    const json = (await res.json()) as { ok?: boolean; data?: unknown; error?: string }
    if (json.ok === false) throw new Error(json.error ?? 'model-config request failed')
    return { ok: true, data: json.data }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
