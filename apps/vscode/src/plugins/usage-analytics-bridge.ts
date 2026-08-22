/**
 * VS Code Host Bridge adapter for the shared Usage Analytics UI.
 *
 * Renderer-side: wraps `acquireVsCodeApi()` messaging. The extension host side
 * listens for `usage-analytics:request` and resolves it against the plugin
 * service. The UI bundle itself stays platform-agnostic; only this adapter
 * differs between desktop and VS Code.
 */

import type { UIBridge } from '@dsh/usage-analytics-ui'
import type { QueryRequest } from '@dsh/usage-protocol'

/** Minimal vscode webview API surface (avoid hard import of 'vscode'). */
interface VsCodeApiLike {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

export interface VsCodeUsageBridgeOptions {
  acquire: () => VsCodeApiLike
}

export function createVsCodeUsageBridge(opts: VsCodeUsageBridgeOptions): UIBridge {
  const api = opts.acquire()
  const pending = new Map<string, (data: unknown) => void>()
  let seq = 0

  // Resolve responses pushed from the extension host.
  const w = globalThis as unknown as {
    addEventListener?: (t: string, fn: (e: unknown) => void) => void
    removeEventListener?: (t: string, fn: (e: unknown) => void) => void
  }
  w.addEventListener?.('message', (event) => {
    const data = (event as { data?: unknown }).data as
      | { channel?: string; requestId?: string; data?: unknown }
      | undefined
    if (!data || data.channel !== 'usage-analytics:response' || !data.requestId) return
    const resolve = pending.get(data.requestId)
    if (resolve) {
      pending.delete(data.requestId)
      resolve(data.data)
    }
  })

  return {
    query: (req: QueryRequest) => {
      const requestId = `ua_${++seq}`
      return new Promise((resolve) => {
        pending.set(requestId, (data) => resolve({ data }))
        api.postMessage({ channel: 'usage-analytics:request', requestId, payload: req })
      })
    },
    subscribe: (topic, cb) => {
      // Extension host pushes `usage-analytics:event` messages.
      const handler = (event: unknown) => {
        const data = (event as { data?: unknown }).data as
          | { channel?: string; topic?: string; payload?: unknown }
          | undefined
        if (data?.channel === 'usage-analytics:event' && data.topic === topic) cb(data.payload)
      }
      w.addEventListener?.('message', handler)
      return () => w.removeEventListener?.('message', handler)
    },
    getCapabilities: () => ({ costEstimation: false, exportFormats: ['json', 'csv'] }),
    openRoute: () => {
      // VS Code uses its own webview panel; nav is in-window.
    },
  }
}
