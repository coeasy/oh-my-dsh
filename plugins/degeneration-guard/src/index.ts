/**
 * Cordis plugin entry for Degeneration Guard.
 *
 * Registers a `degenerationGuard` service wrapping the core engine and wiring
 * host seams (interrupt / reminder). Lifecycle (from the plan §12): installing
 * the plugin observes nothing until the host feeds it. `setMode('off')`
 * bypasses all intervention (engine reminders still apply). Pauses are sticky
 * until the host resumes with a user decision.
 */

import { DegenerationGuardCore } from './core.ts'
import { registerDegenerationGuardHttpApi } from './engine-http.ts'
import type {
  FeedResult,
  GuardConfig,
  GuardConfigPatch,
  GuardContext,
  GuardEvent,
  GuardHost,
  GuardMode,
  GuardOptions,
  GuardStatus,
  StreamKind,
} from './types.ts'

export const name = 'degeneration-guard'
export const inject = []
export const provide = ['degenerationGuard']

export interface DegenerationGuardService {
  getStatus(): GuardStatus
  getConfig(): GuardConfig
  setMode(mode: GuardMode): void
  updateConfig(patch: GuardConfigPatch): void
  feed(kind: StreamKind, delta: string): FeedResult
  feedToolCall(tool: string, args: unknown, denied?: boolean): FeedResult
  noteStep(sessionId: string): FeedResult
  resetSegment(kind: StreamKind): void
  /** Reset a specific session's state (turn counter), or everything when omitted. */
  resetSession(sessionId?: string): void
  resume(): void
  pauseReason(): string | undefined
  isPaused(): boolean
  turnCount(sessionId: string): number
  /** Abort the current request via the host interrupt seam (best-effort). */
  interruptNow(reason: string): Promise<boolean>
}

/** Create the degenerationGuard service. Exposed separately so tests and hosts
 * can obtain the service object directly; the Cordis entry (`apply`) wraps this
 * and registers it on the context. */
export async function createService(
  ctx: GuardContext,
  config: GuardOptions = {},
): Promise<DegenerationGuardService> {
  const host: GuardHost = config.host ?? {}

  const core = new DegenerationGuardCore({
    config: config.config,
    canAbort: () => !!host.interrupt?.canAbort(),
  })
  if (config.forceMode) core.setMode(config.forceMode)

  const emit = (ev: GuardEvent): void => {
    if (ctx.emit) ctx.emit('degeneration-guard.event', ev)
  }

  const service: DegenerationGuardService = {
    getStatus: () => ({
      mode: core.config.mode,
      ready: true,
      host: {
        stream: true,
        interrupt: !!host.interrupt,
      },
      stats: { ...core.stats },
      active: {
        paused: core.isPaused(),
        pauseReason: core.pauseReason(),
      },
    }),
    getConfig: () => core.config,
    setMode: (mode) => {
      core.setMode(mode)
      emit({ kind: 'mode_changed', detail: `mode -> ${mode}` })
    },
    updateConfig: (patch) => {
      core.updateConfig(patch)
    },
    feed: (kind, delta) => {
      const r = core.feed(kind, delta)
      if (r.action === 'retry') {
        emit({ kind: 'auto_retry', detail: r.reason })
        if (host.reminder) host.reminder.inject(r.reason ?? '你陷入重复输出，请直接总结并结束。')
        if (host.interrupt?.canAbort())
          void host.interrupt.abort(r.reason ?? '检测到重复输出').catch(() => {})
      } else if (r.action === 'pause') {
        emit({ kind: 'paused', detail: r.reason })
      } else if (r.action === 'notify') {
        emit({
          kind:
            r.family === 'turn'
              ? 'turn_limit_reminder'
              : r.family === 'tool'
                ? 'tool_repeat_reminder'
                : 'repetition_detected',
          detail: r.reason,
        })
        if (r.reminder && host.reminder) host.reminder.inject(r.reminder)
      }
      return r
    },
    feedToolCall: (tool, args, denied) => {
      const r = core.feedToolCall(tool, args, denied)
      if (r.action === 'pause') emit({ kind: 'tool_repeat_pause', detail: r.reason })
      else if (r.action === 'notify') emit({ kind: 'tool_repeat_reminder', detail: r.reason })
      return r
    },
    noteStep: (sessionId) => {
      const r = core.noteStep(sessionId)
      if (r.action === 'notify') emit({ kind: 'turn_limit_reminder', detail: r.reason })
      return r
    },
    resetSegment: (kind) => core.resetSegment(kind),
    resetSession: (sessionId) => {
      if (sessionId) core.resetSession(sessionId)
      else core.resetEverything()
    },
    resume: () => {
      core.resume()
      emit({ kind: 'paused', detail: 'resumed by user' })
    },
    pauseReason: () => core.pauseReason(),
    isPaused: () => core.isPaused(),
    turnCount: (sessionId) => core.turnCount(sessionId),
    async interruptNow(reason) {
      if (!host.interrupt?.canAbort()) return false
      await host.interrupt.abort(reason)
      return true
    },
  }

  // Engine loopback HTTP API: lets the desktop main process drive the service
  // across the process boundary. Prefer Cordis DI (`ctx.inject(['webServer'])`)
  // — the real engine makes the webServer available via injection, and does not
  // populate config.engine.webServer. The config seam stays as a direct fallback.
  const registerHttp = (webServer: import('./engine-http.ts').WebServerLike): void => {
    registerDegenerationGuardHttpApi(webServer, () => service)
  }
  if (config.engine?.webServer) {
    registerHttp(config.engine.webServer)
  } else if (typeof (ctx as unknown as { inject?: unknown }).inject === 'function') {
    ;(ctx as unknown as {
      inject(
        deps: string[],
        fn: (hostCtx: { get(name: string): unknown }) => void,
      ): void
    }).inject(['webServer'], (hostCtx) => {
      const webServer = hostCtx.get('webServer')
      if (webServer) registerHttp(webServer as import('./engine-http.ts').WebServerLike)
    })
  }

  return service
}

/** Cordis entry: build the service, register it on the context as
 * `degenerationGuard`, and return void so the engine loader accepts the
 * effect. Host bridges reach the service via
 * `ctx.get('degenerationGuard')` / `ctx.degenerationGuard`. */
export async function apply(
  ctx: GuardContext,
  config: GuardOptions = {},
): Promise<void> {
  const service = await createService(ctx, config)
  const c = ctx as unknown as {
    provide?: (name: string, value: DegenerationGuardService) => void
    degenerationGuard?: DegenerationGuardService
  }
  if (typeof c.provide === 'function') c.provide('degenerationGuard', service)
  else c.degenerationGuard = service
}
