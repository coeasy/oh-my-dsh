/**
 * Single source of truth for `window.dshDesktop` on the desktop shell.
 *
 * This is the browser-half contract that client plugins (marketplace,
 * desktop-bridge, …) consume. Keep it in sync with the bridge exposed by
 * `preload.ts` — do NOT redeclare `dshDesktop` in a plugin's own `declare
 * global`, or the global `interface Window` augmentation conflicts under tsc.
 */

declare global {
  interface Window {
    dshDesktop?: {
      pickFolder?(): Promise<unknown>
      setupDefaults?(): Promise<unknown>
      completeSetup?(payload: { workspace: string; apiKey: string }): Promise<unknown>
      shouldSkipOnboarding?(): Promise<unknown>
      marketAction?(request: { kind: string; payload: Record<string, unknown> }): Promise<unknown>
      usageAnalytics?(request: { kind: string; payload?: unknown }): Promise<unknown>
      modelConfig?(request: { kind: 'call'; method: string; args?: unknown[] }): Promise<unknown>
      degenerationGuard?(request: {
        kind: 'call'
        method: string
        args?: unknown[]
      }): Promise<unknown>
      pluginConfigOpen?(request: { plugin: string }): Promise<unknown>
      pluginConfigClose?(): Promise<unknown>
      mobileOpenPairing?(): Promise<unknown>
      mobileStatus?(): Promise<{ connected?: boolean; running?: boolean }>
      engineCheckUpdate?(): Promise<unknown>
      engineActivity?(): Promise<{
        activeVersion?: string
        pendingVersion?: string
        pendingChecksum?: string
        bundledVersion: string
        rollbackAvailable: boolean
        hasNewer: boolean
        cacheRoot: string
      }>
      engineActivate?(): Promise<unknown>
      engineRollback?(): Promise<unknown>
    }
  }
}

export {}
