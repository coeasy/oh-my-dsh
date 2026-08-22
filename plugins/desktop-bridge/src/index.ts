/**
 * @dsh/plugin-desktop-bridge host entry.
 *
 * This plugin has no engine-side runtime: all behaviour lives in its browser
 * client bundle (see src/client/index.ts), which registers official
 * `sidebar.footer.action` entries that open the desktop config panels through
 * the existing `window.dshDesktop` bridge. The host is a no-op cordis plugin
 * so the package installs cleanly into the web profile via the official CLI
 * (dsh plugin --profile web add), which in turn mounts the client half.
 *
 * Keeping the host intentionally empty means it stays a pure bridge and never
 * grows engine-side services that would need HTTP/IPC wiring.
 */

/** Minimal structural context surface — no runtime Cordis dependency. */
export interface DesktopBridgeContext {
  on?(event: string, listener: (...args: never[]) => void): void
}

export const name = 'desktop-bridge'
export const inject: string[] = []

export function apply(_ctx: DesktopBridgeContext): void {
  // No engine-side services; the client bundle owns all behaviour.
}
