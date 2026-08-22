/**
 * Bundle entry: exposes `window.__USAGE_MOUNT__` so any host page can mount the
 * shared UI into a container. The host page supplies `__USAGE_HOST_BRIDGE__`;
 * this entry reads it and mounts.
 */

import { mountUsageAnalytics } from './app.ts'
import { getBridge } from './bridge.ts'

declare global {
  interface Window {
    __USAGE_MOUNT__?: (container: HTMLElement) => unknown
  }
}

window.__USAGE_MOUNT__ = (container: HTMLElement): unknown => {
  return mountUsageAnalytics({ container, bridge: getBridge() ?? undefined })
}
