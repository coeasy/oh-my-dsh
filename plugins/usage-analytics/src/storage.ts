/**
 * Storage layer over sql.js (WASM SQLite). Portable across desktop/vscode/web
 * with no native compilation. Exposes an interface so a better-sqlite3 adapter
 * could be swapped in later without touching the rest of the plugin.
 *
 * Notes:
 *  - Token/cost columns are NULL = unknown; never coerced to 0.
 *  - Sensitive fields (prompt/api_key/raw usage) are structurally absent.
 */

import type { Database as SqlJsDatabase } from 'sql.js'
import type { UsageEvent } from '@dsh/usage-protocol'
import { accumulateEvent, emptyAggregate, type DailyAggregate } from '@dsh/usage-analytics-core'

export const SCHEMA_VERSION = 1

const SCHEMA_001 = `
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  logical_request_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  session_id TEXT, turn_id TEXT,
  provider_id TEXT NOT NULL, model_id TEXT,
  observed_at INTEGER NOT NULL, started_at INTEGER, completed_at INTEGER,
  status TEXT NOT NULL, http_status INTEGER, latency_ms INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
  total_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER, cache_creation_tokens INTEGER,
  cost_value REAL, cost_currency TEXT,
  data_quality_json TEXT NOT NULL,
  source TEXT NOT NULL, error_category TEXT,
  pricing_id TEXT, pricing_version TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_time ON usage_events(observed_at);
CREATE INDEX IF NOT EXISTS idx_events_logical ON usage_events(logical_request_id, attempt_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON usage_events(session_id);

CREATE TABLE IF NOT EXISTS usage_daily (
  date TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
  request_count INTEGER, attempt_count INTEGER,
  success_count INTEGER, error_count INTEGER, unknown_status_count INTEGER,
  input_tokens_exact INTEGER, input_tokens_unknown_count INTEGER,
  output_tokens_exact INTEGER, output_tokens_unknown_count INTEGER,
  cache_read_tokens_exact INTEGER, cache_write_tokens_exact INTEGER,
  cache_creation_tokens_exact INTEGER, cache_status_unknown_count INTEGER,
  cache_read_requests INTEGER, cache_write_requests INTEGER, cache_creation_requests INTEGER,
  estimated_cost_value REAL, cost_currency TEXT,
  PRIMARY KEY (date, provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS plugin_settings (key TEXT PRIMARY KEY, value_json TEXT);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
`

export interface UsageStorage {
  runMigrations(): void
  insertEvent(e: UsageEvent): { inserted: boolean; reason?: string }
  touchDaily(e: UsageEvent): void
  getOverview(): unknown
  getProviderBreakdown(): unknown
  getCacheAnalysis(): unknown
  getDailyTrend(days: number): unknown
  getModelBreakdown(): unknown
  getSessionUsage(sessionId: string): unknown
  getTurnUsage(sessionId: string, turnId: string): unknown
  getSessionStats(sessionId: string): unknown
  exportUsage(format: 'json' | 'csv'): string
  listEvents(limit: number, offset: number): unknown
  getEventCount(): number
  clearEvents(retentionMs?: number): number
  setSetting(key: string, value: unknown): void
  getSetting(key: string): unknown
  exportBytes(): Uint8Array
}

export class SqliteUsageStorage implements UsageStorage {
  private db: SqlJsDatabase
  private memoized: { overview?: unknown; providers?: unknown; cache?: unknown } = {}

  constructor(db: SqlJsDatabase) {
    this.db = db
  }

  runMigrations(): void {
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run(SCHEMA_001)
      const row = this.db.exec('SELECT version FROM schema_migrations WHERE version = ?', [
        SCHEMA_VERSION,
      ])
      if (!row.length || row[0].values.length === 0) {
        this.db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
          SCHEMA_VERSION,
          Date.now(),
        ])
      }
      this.db.run('COMMIT')
    } catch (err) {
      this.db.run('ROLLBACK')
      throw err
    }
  }

  insertEvent(e: UsageEvent): { inserted: boolean; reason?: string } {
    // Defensive: an invalid observed_at must never write NaN into the DB.
    const obsMs = new Date(e.observed_at).getTime()
    const obs = Number.isFinite(obsMs) ? obsMs : Date.now()
    const existing = this.db.exec('SELECT 1 FROM usage_events WHERE event_id = ?', [e.event_id])
    if (existing.length && existing[0].values.length > 0) {
      return { inserted: false, reason: 'duplicate' }
    }
    this.db.run(
      `INSERT INTO usage_events (
        event_id, logical_request_id, attempt_id, session_id, turn_id,
        provider_id, model_id, observed_at, started_at, completed_at,
        status, http_status, latency_ms,
        input_tokens, output_tokens, reasoning_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens, cache_creation_tokens,
        cost_value, cost_currency, data_quality_json, source, error_category,
        pricing_id, pricing_version, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        e.event_id,
        e.logical_request_id,
        e.attempt_id,
        e.session_id,
        e.turn_id,
        e.provider_id,
        e.model_id,
        obs,
        e.started_at ? new Date(e.started_at).getTime() : null,
        e.completed_at ? new Date(e.completed_at).getTime() : null,
        e.status,
        e.http_status,
        e.latency_ms,
        e.input_tokens,
        e.output_tokens,
        e.reasoning_tokens,
        e.total_tokens,
        e.cache_read_tokens,
        e.cache_write_tokens,
        e.cache_creation_tokens,
        // cost value stored as the pre-computed estimate; quality lives in data_quality_json
        (e as any).cost_value ?? null,
        (e as any).cost_currency ?? null,
        JSON.stringify(e.data_quality),
        e.source,
        e.error_category,
        e.pricing_id,
        e.pricing_version,
        Date.now(),
      ],
    )
    this.touchDaily(e)
    this.memoized = {}
    return { inserted: true }
  }

  touchDaily(e: UsageEvent): void {
    const date = new Date(e.observed_at).toISOString().slice(0, 10)
    const provider = e.provider_id
    const model = e.model_id ?? ''
    const agg = this.loadAggregate(date, provider, model)
    accumulateEvent(agg, e)
    this.saveAggregate(agg)
  }

  private loadAggregate(date: string, provider: string, model: string): DailyAggregate {
    const row = this.db.exec(
      `SELECT * FROM usage_daily WHERE date=? AND provider_id=? AND model_id=?`,
      [date, provider, model],
    )
    const agg = emptyAggregate(date, provider, model)
    if (!row.length || row[0].values.length === 0) return agg
    const cols = row[0].columns
    const vals = row[0].values[0]
    const idx = (name: string) => cols.indexOf(name)
    const num = (name: string) => (vals[idx(name)] ?? agg[name as keyof DailyAggregate]) as number
    agg.request_count = num('request_count')
    agg.attempt_count = num('attempt_count')
    agg.success_count = num('success_count')
    agg.error_count = num('error_count')
    agg.unknown_status_count = num('unknown_status_count')
    agg.input_tokens_exact = num('input_tokens_exact')
    agg.input_tokens_unknown_count = num('input_tokens_unknown_count')
    agg.output_tokens_exact = num('output_tokens_exact')
    agg.output_tokens_unknown_count = num('output_tokens_unknown_count')
    agg.cache_read_tokens_exact = num('cache_read_tokens_exact')
    agg.cache_write_tokens_exact = num('cache_write_tokens_exact')
    agg.cache_creation_tokens_exact = num('cache_creation_tokens_exact')
    agg.cache_status_unknown_count = num('cache_status_unknown_count')
    agg.cache_read_requests = num('cache_read_requests')
    agg.cache_write_requests = num('cache_write_requests')
    agg.cache_creation_requests = num('cache_creation_requests')
    agg.estimated_cost_value = num('estimated_cost_value')
    const cur = vals[cols.indexOf('cost_currency')]
    agg.cost_currency = (cur as string) ?? null
    return agg
  }

  private saveAggregate(agg: DailyAggregate): void {
    this.db.run(
      `INSERT INTO usage_daily (
        date, provider_id, model_id, request_count, attempt_count,
        success_count, error_count, unknown_status_count,
        input_tokens_exact, input_tokens_unknown_count,
        output_tokens_exact, output_tokens_unknown_count,
        cache_read_tokens_exact, cache_write_tokens_exact, cache_creation_tokens_exact,
        cache_status_unknown_count, cache_read_requests, cache_write_requests, cache_creation_requests,
        estimated_cost_value, cost_currency
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(date, provider_id, model_id) DO UPDATE SET
        request_count=excluded.request_count, attempt_count=excluded.attempt_count,
        success_count=excluded.success_count, error_count=excluded.error_count,
        unknown_status_count=excluded.unknown_status_count,
        input_tokens_exact=excluded.input_tokens_exact,
        input_tokens_unknown_count=excluded.input_tokens_unknown_count,
        output_tokens_exact=excluded.output_tokens_exact,
        output_tokens_unknown_count=excluded.output_tokens_unknown_count,
        cache_read_tokens_exact=excluded.cache_read_tokens_exact,
        cache_write_tokens_exact=excluded.cache_write_tokens_exact,
        cache_creation_tokens_exact=excluded.cache_creation_tokens_exact,
        cache_status_unknown_count=excluded.cache_status_unknown_count,
        cache_read_requests=excluded.cache_read_requests,
        cache_write_requests=excluded.cache_write_requests,
        cache_creation_requests=excluded.cache_creation_requests,
        estimated_cost_value=excluded.estimated_cost_value,
        cost_currency=excluded.cost_currency`,
      [
        agg.date,
        agg.provider_id,
        agg.model_id,
        agg.request_count,
        agg.attempt_count,
        agg.success_count,
        agg.error_count,
        agg.unknown_status_count,
        agg.input_tokens_exact,
        agg.input_tokens_unknown_count,
        agg.output_tokens_exact,
        agg.output_tokens_unknown_count,
        agg.cache_read_tokens_exact,
        agg.cache_write_tokens_exact,
        agg.cache_creation_tokens_exact,
        agg.cache_status_unknown_count,
        agg.cache_read_requests,
        agg.cache_write_requests,
        agg.cache_creation_requests,
        agg.estimated_cost_value,
        agg.cost_currency,
      ],
    )
    this.memoized = {}
  }

  getOverview(): unknown {
    if (this.memoized.overview) return this.memoized.overview
    const r = this.db.exec(
      `SELECT
        COUNT(*) AS request_count,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error_count,
        SUM(CASE WHEN status NOT IN ('completed','error') THEN 1 ELSE 0 END) AS unknown_status_count,
        SUM(CASE WHEN input_tokens IS NOT NULL AND input_tokens>0 THEN 1 ELSE 0 END) AS input_known,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(CASE WHEN cache_read_tokens IS NOT NULL AND cache_read_tokens>0 THEN 1 ELSE 0 END) AS cache_read_requests,
        SUM(CASE WHEN cache_write_tokens IS NOT NULL AND cache_write_tokens>0 THEN 1 ELSE 0 END) AS cache_write_requests,
        SUM(CASE WHEN cache_read_tokens IS NULL AND cache_write_tokens IS NULL AND cache_creation_tokens IS NULL THEN 1 ELSE 0 END) AS cache_unknown,
        SUM(cache_read_tokens) AS cache_read_tokens_exact,
        SUM(cost_value) AS estimated_cost
      FROM usage_events`,
    )
    const cols = r[0].columns
    const v = r[0].values[0] ?? []
    const num = (i: number) => v[i] ?? 0
    const request_count = num(cols.indexOf('request_count'))
    const success = num(cols.indexOf('success_count'))
    const errors = num(cols.indexOf('error_count'))
    const input_known = num(cols.indexOf('input_known'))
    const { p50, p95 } = this.latencyPercentiles()
    const overview = {
      request_count,
      success_count: success,
      error_count: num(cols.indexOf('error_count')),
      unknown_status_count: num(cols.indexOf('unknown_status_count')),
      input_tokens_exact: num(cols.indexOf('input_tokens')),
      output_tokens_exact: num(cols.indexOf('output_tokens')),
      cache_read_requests: num(cols.indexOf('cache_read_requests')),
      cache_write_requests: num(cols.indexOf('cache_write_requests')),
      cache_status_unknown_count: num(cols.indexOf('cache_unknown')),
      cache_read_tokens_exact: num(cols.indexOf('cache_read_tokens_exact')),
      estimated_cost_value: num(cols.indexOf('estimated_cost')),
      error_rate: request_count ? errors / request_count : null,
      latency_p50: p50,
      latency_p95: p95,
      has_estimated: num(cols.indexOf('estimated_cost')) > 0,
      has_unknown: request_count - input_known > 0 || num(cols.indexOf('cache_unknown')) > 0,
    }
    this.memoized.overview = overview
    return overview
  }

  getProviderBreakdown(): unknown {
    if (this.memoized.providers) return this.memoized.providers
    const r = this.db.exec(
      `SELECT provider_id, COUNT(*) AS cnt,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
        SUM(input_tokens) AS input, SUM(output_tokens) AS output,
        SUM(CASE WHEN cache_read_tokens>0 THEN 1 ELSE 0 END) AS cache_read,
        SUM(cost_value) AS cost
       FROM usage_events GROUP BY provider_id`,
    )
    const cols = r[0].columns
    const rows = r[0].values
    const providers = rows.map((v: unknown[]) => {
      const num = (i: number): number => ((v[i] as number) ?? 0) as number
      const cnt = num(cols.indexOf('cnt'))
      return {
        provider_id: v[cols.indexOf('provider_id')],
        request_count: cnt,
        success_count: num(cols.indexOf('success')),
        error_count: num(cols.indexOf('errors')),
        input_tokens_exact: num(cols.indexOf('input')),
        output_tokens_exact: num(cols.indexOf('output')),
        cache_read_requests: num(cols.indexOf('cache_read')),
        estimated_cost_value: num(cols.indexOf('cost')),
        error_rate: cnt ? num(cols.indexOf('errors')) / cnt : null,
      }
    })
    this.memoized.providers = providers
    return providers
  }

  getCacheAnalysis(): unknown {
    if (this.memoized.cache) return this.memoized.cache
    const r = this.db.exec(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN cache_read_tokens>0 THEN 1 ELSE 0 END) AS read_req,
        SUM(CASE WHEN cache_write_tokens>0 THEN 1 ELSE 0 END) AS write_req,
        SUM(CASE WHEN cache_creation_tokens>0 THEN 1 ELSE 0 END) AS create_req,
        SUM(CASE WHEN cache_read_tokens IS NULL AND cache_write_tokens IS NULL AND cache_creation_tokens IS NULL THEN 1 ELSE 0 END) AS unknown,
        SUM(cache_read_tokens) AS read_tok,
        SUM(cache_write_tokens) AS write_tok,
        SUM(cache_creation_tokens) AS create_tok
      FROM usage_events`,
    )
    const cols = r[0].columns
    const v = r[0].values[0] ?? []
    const num = (i: number) => v[i] ?? 0
    const readTok = num(cols.indexOf('read_tok'))
    const writeTok = num(cols.indexOf('write_tok'))
    const createTok = num(cols.indexOf('create_tok'))
    const known = readTok + writeTok + createTok
    this.memoized.cache = {
      total_requests: num(cols.indexOf('total')),
      cache_read_requests: num(cols.indexOf('read_req')),
      cache_write_requests: num(cols.indexOf('write_req')),
      cache_creation_requests: num(cols.indexOf('create_req')),
      cache_status_unknown_count: num(cols.indexOf('unknown')),
      cache_read_tokens_exact: readTok,
      cache_write_tokens_exact: writeTok,
      cache_creation_tokens_exact: createTok,
      hit_rate: known > 0 ? readTok / known : null,
    }
    return this.memoized.cache
  }

  listEvents(limit: number, offset: number): unknown {
    const r = this.db.exec(
      `SELECT event_id, logical_request_id, attempt_id, provider_id, model_id,
              observed_at, status, input_tokens, output_tokens, cache_read_tokens,
              cost_value, data_quality_json
       FROM usage_events ORDER BY observed_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    )
    const cols = r[0]?.columns ?? []
    const rows = r[0]?.values ?? []
    return rows.map((v: unknown[]) => {
      const obj: Record<string, unknown> = {}
      cols.forEach((c: string, i: number) => {
        if (c === 'observed_at') obj[c] = new Date((v[i] as number) ?? 0).toISOString()
        else obj[c] = v[i]
      })
      return obj
    })
  }

  getEventCount(): number {
    const r = this.db.exec('SELECT COUNT(*) AS c FROM usage_events')
    return (r[0].values[0]?.[0] as number) ?? 0
  }

  clearEvents(retentionMs: number | null = null): number {
    let n = 0
    if (retentionMs !== null) {
      const cutoff = Date.now() - retentionMs
      const r = this.db.exec('SELECT COUNT(*) AS c FROM usage_events WHERE observed_at < ?', [
        cutoff,
      ])
      n = (r[0].values[0]?.[0] as number) ?? 0
      this.db.run('DELETE FROM usage_events WHERE observed_at < ?', [cutoff])
      // Keep the daily aggregate consistent with retained raw events: drop any
      // day fully older than the cutoff so trend queries never surface data
      // whose raw events have already been purged.
      const cutoffDate = new Date(cutoff).toISOString().slice(0, 10)
      this.db.run('DELETE FROM usage_daily WHERE date < ?', [cutoffDate])
    } else {
      const r = this.db.exec('SELECT COUNT(*) AS c FROM usage_events')
      n = (r[0].values[0]?.[0] as number) ?? 0
      this.db.run('DELETE FROM usage_events')
      this.db.run('DELETE FROM usage_daily')
    }
    this.memoized = {}
    return n
  }

  setSetting(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO plugin_settings (key, value_json) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`,
      [key, JSON.stringify(value)],
    )
  }

  getSetting(key: string): unknown {
    const r = this.db.exec('SELECT value_json FROM plugin_settings WHERE key=?', [key])
    if (!r.length || r[0].values.length === 0) return undefined
    return JSON.parse(r[0].values[0][0] as string)
  }

  private latencyPercentiles(): { p50: number | null; p95: number | null } {
    const r = this.db.exec(
      'SELECT latency_ms FROM usage_events WHERE latency_ms IS NOT NULL ORDER BY latency_ms',
    )
    const rows = r[0]?.values ?? []
    if (rows.length === 0) return { p50: null, p95: null }
    const lat = rows.map((row: unknown[]) => row[0] as number)
    // Standard linear-rank percentile: index = floor(q * (n - 1)),
    // so q=0 -> first sample, q=1 -> last sample, median falls mid-range.
    const at = (q: number) =>
      lat[Math.max(0, Math.min(lat.length - 1, Math.floor(q * (lat.length - 1))))]
    return { p50: at(0.5), p95: at(0.95) }
  }

  getDailyTrend(days: number): unknown {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const r = this.db.exec(
      `SELECT date, SUM(request_count) AS requests, SUM(input_tokens_exact) AS input,
              SUM(output_tokens_exact) AS output, SUM(cache_read_requests) AS cache_read,
              SUM(error_count) AS errors, SUM(estimated_cost_value) AS cost
       FROM usage_daily WHERE date >= ? GROUP BY date ORDER BY date ASC`,
      [cutoff],
    )
    const cols = r[0]?.columns ?? []
    const rows = r[0]?.values ?? []
    return rows.map((v: unknown[]) => {
      const num = (i: number): number => ((v[i] as number) ?? 0) as number
      return {
        date: v[0],
        request_count: num(cols.indexOf('requests')),
        input_tokens_exact: num(cols.indexOf('input')),
        output_tokens_exact: num(cols.indexOf('output')),
        cache_read_requests: num(cols.indexOf('cache_read')),
        error_count: num(cols.indexOf('errors')),
        estimated_cost_value: num(cols.indexOf('cost')),
      }
    })
  }

  getModelBreakdown(): unknown {
    const r = this.db.exec(
      `SELECT model_id, COUNT(*) AS cnt,
        SUM(input_tokens) AS input, SUM(output_tokens) AS output
       FROM usage_events GROUP BY model_id ORDER BY cnt DESC`,
    )
    const cols = r[0]?.columns ?? []
    const rows = r[0]?.values ?? []
    return rows.map((v: unknown[]) => {
      const num = (i: number): number => ((v[i] as number) ?? 0) as number
      return {
        model_id: v[cols.indexOf('model_id')],
        request_count: num(cols.indexOf('cnt')),
        input_tokens_exact: num(cols.indexOf('input')),
        output_tokens_exact: num(cols.indexOf('output')),
      }
    })
  }

  getSessionUsage(sessionId: string): unknown {
    const r = this.db.exec(
      `SELECT id, event_id, turn_id, provider_id, model_id, observed_at, status,
              input_tokens, output_tokens, cache_read_tokens, cost_value, data_quality_json
       FROM usage_events WHERE session_id = ? ORDER BY observed_at ASC`,
      [sessionId],
    )
    const cols = r[0]?.columns ?? []
    const rows = r[0]?.values ?? []
    return rows.map((v: unknown[]) => {
      const obj: Record<string, unknown> = {}
      cols.forEach((c: string, i: number) => {
        obj[c] = c === 'observed_at' ? new Date((v[i] as number) ?? 0).toISOString() : v[i]
      })
      return obj
    })
  }

  getTurnUsage(sessionId: string, turnId: string): unknown {
    const r = this.db.exec(
      `SELECT id, event_id, turn_id, provider_id, model_id, observed_at, status,
              input_tokens, output_tokens, cache_read_tokens, cost_value
       FROM usage_events WHERE session_id = ? AND turn_id = ? ORDER BY observed_at ASC`,
      [sessionId, turnId],
    )
    const cols = r[0]?.columns ?? []
    const rows = r[0]?.values ?? []
    return rows.map((v: unknown[]) => {
      const obj: Record<string, unknown> = {}
      cols.forEach((c: string, i: number) => {
        obj[c] = c === 'observed_at' ? new Date((v[i] as number) ?? 0).toISOString() : v[i]
      })
      return obj
    })
  }

  /** Session-scoped live summary for the desktop status bar: cumulative tokens,
   * cost, cache hit rate, turn count and the last (current) request breakdown.
   * NULL fields stay unknown (rendered as —), never coerced to 0. */
  getSessionStats(sessionId: string): unknown {
    const agg = this.db.exec(
      `SELECT COUNT(*) AS request_count,
              COUNT(DISTINCT turn_id) AS turn_count,
              SUM(input_tokens) AS input,
              SUM(output_tokens) AS output,
              SUM(cache_read_tokens) AS cache_read,
              SUM(cache_write_tokens) AS cache_write,
              SUM(cost_value) AS cost
       FROM usage_events WHERE session_id = ?`,
      [sessionId],
    )
    const aCols = agg[0]?.columns ?? []
    const aVals = agg[0]?.values?.[0] ?? []
    const num = (name: string): number | null => {
      const v = aVals[aCols.indexOf(name)]
      return v === null || v === undefined ? null : (v as number)
    }
    const input = num('input')
    const output = num('output')
    const cacheRead = num('cache_read')
    const cacheWrite = num('cache_write')
    const cost = num('cost')
    // Cache hit rate = cache-read tokens / input tokens (known data only).
    const hitRate =
      input !== null && input > 0 && cacheRead !== null ? Math.min(1, cacheRead / input) : null

    const last = this.db.exec(
      `SELECT model_id, provider_id, observed_at, input_tokens, output_tokens, cache_read_tokens, cost_value, cost_currency
       FROM usage_events WHERE session_id = ? ORDER BY observed_at DESC LIMIT 1`,
      [sessionId],
    )
    const lCols = last[0]?.columns ?? []
    const lVals = last[0]?.values?.[0] ?? []
    const at = (name: string) => lVals[lCols.indexOf(name)]
    const lastObs = at('observed_at')

    return {
      session_id: sessionId,
      model_id: (at('model_id') as string) ?? null,
      provider_id: (at('provider_id') as string) ?? null,
      request_count: num('request_count') ?? 0,
      turn_count: num('turn_count') ?? 0,
      input_tokens_exact: input,
      output_tokens_exact: output,
      cache_read_tokens_exact: cacheRead,
      cache_write_tokens_exact: cacheWrite,
      cache_hit_rate: hitRate,
      cost_value: cost,
      last_observed_at:
        lastObs === null || lastObs === undefined
          ? null
          : new Date(lastObs as number).toISOString(),
      last_input_tokens: (at('input_tokens') as number) ?? null,
      last_output_tokens: (at('output_tokens') as number) ?? null,
      last_cache_read_tokens: (at('cache_read_tokens') as number) ?? null,
      last_cost_value: (at('cost_value') as number) ?? null,
      cost_currency: (at('cost_currency') as string) ?? null,
    }
  }

  /** Export events as CSV or JSONL for user-triggered export. */
  exportUsage(format: 'json' | 'csv'): string {
    const r = this.db.exec(
      `SELECT observed_at, provider_id, model_id, session_id, turn_id, status,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
              cache_creation_tokens, cost_value, cost_currency, error_category
       FROM usage_events ORDER BY observed_at ASC`,
    )
    const cols = r[0]?.columns ?? []
    const rows = r[0]?.values ?? []
    if (format === 'json') {
      const arr = rows.map((v: unknown[]) => {
        const obj: Record<string, unknown> = {}
        cols.forEach((c: string, i: number) => {
          obj[c] = c === 'observed_at' ? new Date((v[i] as number) ?? 0).toISOString() : v[i]
        })
        return obj
      })
      return JSON.stringify(arr, null, 2)
    }
    const escape = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`
    const header = cols.map(escape).join(',')
    const body = rows
      .map((v: unknown[]) =>
        v
          .map((cell) => {
            if (typeof cell === 'number') return String(cell)
            return escape(cell)
          })
          .join(','),
      )
      .join('\n')
    return `${header}\n${body}`
  }

  exportBytes(): Uint8Array {
    return this.db.export()
  }
}
