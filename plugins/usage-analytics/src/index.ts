/**
 * Cordis plugin entry for Usage Analytics.
 *
 * Lifecycle contract (from the plan): install ≠ collect. The plugin loads but
 * only subscribes to observed events once explicitly enabled. Disabling stops
 * collection but keeps data.
 *
 * The plugin registers a `usageAnalytics` service on the Cordis context so the
 * desktop/vscode Host Bridges can reach the Query API.
 */

import initSqlJs from 'sql.js'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SqliteUsageStorage } from './storage.ts'
import { UsagePipeline } from './pipeline.ts'
import { normalize, type SafeObservedEvent } from './normalizer.ts'
import type { UsageStorage } from './storage.ts'
import type { ProviderMapping, PriceTable } from '@dsh/usage-analytics-core'
import { estimateCost } from '@dsh/usage-analytics-core'
import type { UsageEvent } from '@dsh/usage-protocol'
import {
  createHarnessObserver,
  type HarnessSessionLike,
  type HarnessSessionEvent,
} from './harness-collector.ts'
import { registerUsageHttpApi, type WebServerLike } from './engine-http.ts'
import { BUILTIN_MAPPINGS, DEFAULT_PRICE_TABLE } from './builtin.ts'

export interface UsageAnalyticsConfig {
  /** Path for persisted DB bytes. When empty, keeps DB in memory only. */
  dbPath?: string
  /** Default retention days for raw events. */
  retentionDays?: number
  /** Provider mapping: explicit, or a builtin id, or null to use default. */
  providerMapping?: ProviderMapping | null | string
  /** Opt-in local cost estimation (marked estimated). Default off. */
  costEnabled?: boolean
  /** Price table for cost estimation (defaults to builtin USD table). */
  priceTable?: PriceTable
  /** Harness session seam for live observation. When provided, the observer
   * subscribes to session/event while enabled. */
  harness?: {
    getSession: () => HarnessSessionLike | null
    subscribeSession: (s: HarnessSessionLike, on: (ev: HarnessSessionEvent) => void) => () => void
  }
  /** Engine webServer seam: registers the loopback HTTP API for cross-process
   * queries from the desktop client. */
  engine?: {
    webServer: WebServerLike
  }
}

export interface UsageAnalyticsContext {
  on(event: string, listener: (...args: any[]) => void): void
  emit?(event: string, payload: unknown): void
}

export interface UsageAnalyticsService {
  getStatus(): { enabled: boolean; collected: number; dropped: number; duplicates: number }
  setEnabled(enabled: boolean): void
  ingest(raw: SafeObservedEvent): boolean
  queryOverview(): unknown
  queryProviders(): unknown
  queryCache(): unknown
  queryTrend(days: number): unknown
  queryModels(): unknown
  querySession(sessionId: string): unknown
  queryTurn(sessionId: string, turnId: string): unknown
  /** Live stats for the most recently active session (drives the status bar). */
  querySessionStats(): unknown
  queryEvents(limit: number, offset: number): unknown
  exportUsage(format: 'json' | 'csv'): string
  getSettings(): Record<string, unknown>
  setSetting(key: string, value: unknown): void
  clearData(): number
  flush(): void
}

export const name = 'usage-analytics'
export const inject = []
export const provide = ['usageAnalytics']

let sqlModule: any = null

/** Resolve the effective provider mapping (builtin id or explicit object). */
function resolveMapping(m: UsageAnalyticsConfig['providerMapping']): ProviderMapping | null {
  if (typeof m === 'string') return BUILTIN_MAPPINGS[m] ?? null
  return m ?? null
}

/** Attach opt-in, clearly-estimated cost to an event. */
function applyCost(event: UsageEvent, enabled: boolean, table: PriceTable): UsageEvent {
  if (!enabled) return event
  const cost = estimateCost(table, event.model_id, {
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    cache_read_tokens: event.cache_read_tokens,
    cache_write_tokens: event.cache_write_tokens,
  })
  ;(event as any).cost_value = cost.value
  ;(event as any).cost_currency = cost.currency
  ;(event.data_quality as any).cost = cost.value > 0 ? 'estimated' : 'unknown'
  return event
}

/** Create the usageAnalytics service. Exposed separately so tests and hosts can
 * obtain the service object directly; the Cordis entry (`apply`) wraps this
 * and registers it on the context. */
export async function createService(
  ctx: UsageAnalyticsContext,
  config: UsageAnalyticsConfig = {},
): Promise<UsageAnalyticsService> {
  if (!sqlModule) {
    sqlModule = await initSqlJs()
  }
  // Opt-in disk persistence: when dbPath is set, load the existing DB bytes on
  // startup and write the whole DB back atomically after each flush and on
  // dispose. Default (no dbPath) stays in-memory only.
  const dbPath = config.dbPath
  let persisted: Uint8Array | undefined
  if (dbPath) {
    try {
      if (existsSync(dbPath)) persisted = new Uint8Array(readFileSync(dbPath))
    } catch {
      persisted = undefined
    }
  }
  const db = new sqlModule.Database(persisted)
  const storage: UsageStorage = new SqliteUsageStorage(db)
  storage.runMigrations()

  const saveDb = (): void => {
    if (!dbPath) return
    try {
      mkdirSync(dirname(dbPath), { recursive: true })
      const bytes = db.export()
      const tmp = `${dbPath}.tmp`
      writeFileSync(tmp, bytes)
      renameSync(tmp, dbPath)
    } catch {
      // contained: a persistence failure must never break the chat path
    }
  }

  const retentionDays = config.retentionDays ?? 181
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000
  const pipeline = new UsagePipeline(storage)
  storage.setSetting('retention_ms', retentionMs)
  storage.setSetting('retention_days', retentionDays)

  const costEnabled = config.costEnabled ?? false
  const priceTable = config.priceTable ?? DEFAULT_PRICE_TABLE
  const mapping = resolveMapping(config.providerMapping)

  let enabled = false
  let unobserve: (() => void) | null = null
  let retentionTimer: ReturnType<typeof setInterval> | null = null
  let lastSessionId: string | null = null

  // Ingestion core (shared by harness observer and direct ingest).
  const ingest = (raw: SafeObservedEvent): boolean => {
    if (!enabled) return false
    const { event } = normalize(raw, mapping)
    applyCost(event, costEnabled, priceTable)
    if (event.session_id) lastSessionId = event.session_id
    const ok = pipeline.accept(event)
    if (ok) {
      pipeline.flush()
      saveDb()
    }
    return ok
  }

  // Background retention sweep (daily); never blocks the main path.
  retentionTimer = setInterval(
    () => {
      try {
        pipeline.flush()
        const removed = storage.clearEvents(retentionMs)
        saveDb()
        if (removed > 0 && ctx.emit) ctx.emit('usage.retention.cleaned', { removed })
      } catch {
        // contained — retention failure must not affect the agent loop
      }
    },
    24 * 60 * 60 * 1000,
  )
  retentionTimer.unref?.()

  const service: UsageAnalyticsService = {
    getStatus: () => ({
      enabled,
      collected: pipeline.stats.accepted,
      dropped: pipeline.stats.dropped,
      duplicates: pipeline.stats.duplicates,
      storageErrors: pipeline.stats.storageErrors,
    }),
    setEnabled: (on) => {
      enabled = on
      if (on) pipeline.resetDedup()
      if (on && config.harness && !unobserve) {
        unobserve = createHarnessObserver({
          getSession: config.harness.getSession,
          subscribeSession: config.harness.subscribeSession,
          sink: (raw) => ingest(raw),
        })
      } else if (!on && unobserve) {
        unobserve()
        unobserve = null
      }
      if (ctx.emit) ctx.emit('usage.plugin.status_changed', { enabled: on })
    },
    ingest,
    queryOverview: () => storage.getOverview(),
    queryProviders: () => storage.getProviderBreakdown(),
    queryCache: () => storage.getCacheAnalysis(),
    queryTrend: (days) => storage.getDailyTrend(days),
    queryModels: () => storage.getModelBreakdown(),
    querySession: (sessionId) => storage.getSessionUsage(sessionId),
    queryTurn: (sessionId, turnId) => storage.getTurnUsage(sessionId, turnId),
    querySessionStats: () => {
      const stats = lastSessionId ? storage.getSessionStats(lastSessionId) : null
      if (!stats) return null
      // Expose whether cost estimation is enabled so the status bar can hide the
      // cost columns when the capability is off (default).
      return { ...(stats as Record<string, unknown>), cost_enabled: costEnabled }
    },
    queryEvents: (limit, offset) => storage.listEvents(limit, offset),
    exportUsage: (format) => storage.exportUsage(format),
    getSettings: () => ({
      retentionDays,
      costEnabled,
      dbPath: config.dbPath ?? null,
      pricingId: priceTable.id,
      pricingVersion: priceTable.version,
      mapping: mapping?.id ?? null,
    }),
    setSetting: (key, value) => storage.setSetting(key, value),
    clearData: () => storage.clearEvents(),
    flush: () => {
      pipeline.flush()
      saveDb()
    },
  }

  if (ctx.on) {
    ctx.on('dispose', () => {
      pipeline.flush()
      saveDb()
      if (retentionTimer) clearInterval(retentionTimer)
      db.close()
    })
  }

  // Engine loopback HTTP API: lets the desktop main process drive the service
  // across the process boundary. Prefer Cordis DI (`ctx.inject(['webServer'])`)
  // — the real engine makes the webServer available via injection, and does not
  // populate config.engine.webServer. The config seam stays as a direct fallback.
  const registerHttp = (webServer: import('./engine-http.ts').WebServerLike): void => {
    registerUsageHttpApi(webServer, () => service)
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

/** Cordis entry: build the service, register it on the context as `usageAnalytics`,
 * and return void so the engine loader accepts the effect. Host bridges reach
 * the service via `ctx.get('usageAnalytics')` / `ctx.usageAnalytics`. */
export async function apply(
  ctx: UsageAnalyticsContext,
  config: UsageAnalyticsConfig = {},
): Promise<void> {
  const service = await createService(ctx, config)
  const c = ctx as unknown as {
    provide?: (name: string, value: UsageAnalyticsService) => void
    usageAnalytics?: UsageAnalyticsService
  }
  if (typeof c.provide === 'function') c.provide('usageAnalytics', service)
  else c.usageAnalytics = service
}
