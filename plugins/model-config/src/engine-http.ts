/**
 * Engine-side HTTP API for the Model Config plugin.
 *
 * Registers a loopback GET route on the engine's `webServer` (mirroring the
 * usage-analytics / plugin-marketplace pattern) so the desktop main process can
 * drive the service across the process boundary via `fetch(host.url + path)`.
 * The engine binds to 127.0.0.1 only (loopback), matching the plan's security
 * boundary. One generic dispatcher keeps every service method addressable
 * without a hand-written route per method.
 *
 * Routes:
 *   GET /model-config/api/call?method=<name>&args=<json array>
 *
 * Duck-typed against the Cordis webServer service (no hard import).
 */

/** Service surface the HTTP layer dispatches onto (structural match). */
export type ModelConfigServiceLike = Record<string, unknown>

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

export function registerModelConfigHttpApi(
  webServer: WebServerLike,
  getService: () => unknown,
): void {
  webServer.register({
    kind: 'exact',
    path: '/model-config/api/call',
    handler: (req, res) => {
      if (req.method && req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      try {
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams
        const method = q.get('method') ?? ''
        let args: unknown[] = []
        const raw = q.get('args')
        if (raw) {
          const parsed: unknown = JSON.parse(raw)
          if (Array.isArray(parsed)) args = parsed
        }
        const svc = getService() as ModelConfigServiceLike | null
        if (!svc) {
          sendJson(res, 503, { ok: false, error: 'Model Config plugin is not loaded/enabled' })
          return
        }
        const fn = svc[method]
        if (typeof fn !== 'function') {
          sendJson(res, 400, { ok: false, error: `unknown model-config method: ${method}` })
          return
        }
        Promise.resolve((fn as (...a: unknown[]) => unknown).apply(svc, args)).then(
          (data) => sendJson(res, 200, { ok: true, data }),
          (error) =>
            sendJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
        )
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })
}
