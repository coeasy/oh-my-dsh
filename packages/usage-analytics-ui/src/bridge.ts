/**
 * Host Bridge contract. The shared UI only ever depends on this interface; the
 * desktop/vscode apps inject their own implementation. No platform API is
 * referenced here, so this file runs anywhere.
 */

import type { QueryRequest } from '@dsh/usage-protocol'

export interface UIBridge {
  query(req: QueryRequest): Promise<{ data: unknown }>
  subscribe(topic: string, cb: (payload: unknown) => void): () => void
  getCapabilities(): { costEstimation: boolean; exportFormats: string[] }
  openRoute(route: string): void
}

export type Route =
  'overview' | 'trend' | 'providers' | 'models' | 'cache' | 'sessions' | 'settings'

/** The injected global, provided by each platform's bridge bootstrap. */
export interface WindowWithBridge {
  __USAGE_HOST_BRIDGE__?: UIBridge
}

export function getBridge(
  w: WindowWithBridge = globalThis as unknown as WindowWithBridge,
): UIBridge | null {
  return w.__USAGE_HOST_BRIDGE__ ?? null
}
