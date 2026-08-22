/**
 * Desktop Host Bridge adapter for the shared Usage Analytics UI.
 *
 * Lives in the preload world: implements the UIBridge contract by forwarding
 * requests over the Electron `usage-analytics:action` IPC channel. The main
 * process resolves the request against the Usage Analytics plugin service
 * (registered once the Cordis engine runtime is reachable — see
 * plugins/usage-analytics/src/index.ts). This file never imports `electron`
 * from the renderer directly; it consumes the preload-exposed bridge.
 */

import type { UIBridge } from '@dsh/usage-analytics-ui'
import type { QueryRequest } from '@dsh/usage-protocol'

/** Minimal surface the desktop preload must expose. */
export interface DesktopUsageAnalyticsHost {
  action(request: { kind: string; payload?: unknown }): Promise<unknown>
}

export interface DesktopUsageBridgeOptions {
  host: DesktopUsageAnalyticsHost
}

export function createDesktopUsageBridge(opts: DesktopUsageBridgeOptions): UIBridge {
  const { host } = opts
  return {
    query: async (req: QueryRequest) => {
      const data = await host.action({ kind: 'query', payload: req })
      return { data }
    },
    subscribe: (topic, cb) => {
      // Desktop subscribes via the preload event bridge when available; here we
      // expose the topic so the host can push updates. Returns a no-op unless
      // the preload wires push events into `window`.
      const w = globalThis as unknown as {
        addEventListener?: (t: string, fn: (e: Event & { detail?: unknown }) => void) => void
        removeEventListener?: (t: string, fn: (e: Event & { detail?: unknown }) => void) => void
      }
      const handler = (e: Event & { detail?: unknown }) => {
        if ((e as unknown as { type?: string }).type === `usage:${topic}`) cb(e.detail)
      }
      w.addEventListener?.(`usage:${topic}`, handler)
      return () => w.removeEventListener?.(`usage:${topic}`, handler)
    },
    getCapabilities: () => ({ costEstimation: false, exportFormats: ['json', 'csv'] }),
    openRoute: () => {
      // no-op: desktop uses in-window nav
    },
  }
}
