/**
 * Normalizer: turns a safe observed event (in-memory only, never persisted)
 * into a usage.event.v1 event, applying a Provider mapping and field-level
 * quality markers. Fields the provider didn't return stay `null` = unknown.
 */

import type { UsageEvent } from '@dsh/usage-protocol'
import { defaultQuality, SCHEMA_VERSION, type Quality } from '@dsh/usage-protocol'
import { applyUsageMapping, type ProviderMapping } from '@dsh/usage-analytics-core'

export interface SafeObservedEvent {
  logical_request_id: string
  attempt_id: string
  session_id?: string | null
  turn_id?: string | null
  provider_id: string
  model_id?: string | null
  base_url_host?: string | null
  http_status?: number | null
  status?: UsageEvent['status']
  error_category?: UsageEvent['error_category']
  started_at?: string | null
  completed_at?: string | null
  latency_ms?: number | null
  /** Provider usage JSON — allowed in memory only, never persisted. */
  usage?: unknown
  /** Whether a final usage object was seen (streaming). */
  has_final_usage?: boolean
  source?: UsageEvent['source']
}

export interface NormalizeResult {
  event: UsageEvent
  problems: string[]
}

/**
 * Normalize a safe observed event into a UsageEvent.
 * `mapping` optional: when absent, tokens default to unknown (null).
 */
export function normalize(
  raw: SafeObservedEvent,
  mapping: ProviderMapping | null,
): NormalizeResult {
  const problems: string[] = []
  const dq = defaultQuality()

  const CANONICAL = [
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'total_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'cache_creation_tokens',
  ] as const
  let tokens: Record<string, number> = {}
  // Path 1: canonical usage shape already normalized (harness observer) → exact.
  if (raw.usage && typeof raw.usage === 'object') {
    const u = raw.usage as Record<string, unknown>
    const canonical = CANONICAL.some((k) => typeof u[k] === 'number')
    if (canonical) {
      for (const k of CANONICAL) {
        const v = u[k]
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          tokens[k] = v
          ;(dq as any)[k] = 'exact'
        }
      }
    }
  }
  // Path 2: raw provider usage + declarative mapping.
  if (Object.keys(tokens).length === 0 && mapping && raw.usage !== undefined) {
    const res = applyUsageMapping(raw.usage, mapping)
    tokens = res.found
    for (const m of res.missing) {
      dq[m as keyof typeof dq] = 'unknown'
      problems.push(`missing field: ${m}`)
    }
    for (const key of Object.keys(tokens)) {
      ;(dq as any)[key] = 'exact'
    }
  } else {
    for (const key of Object.keys(dq)) {
      dq[key as keyof typeof dq] = 'unknown'
    }
  }

  const status: UsageEvent['status'] = raw.status ?? (raw.has_final_usage ? 'completed' : 'unknown')

  const event: UsageEvent = {
    schema_version: SCHEMA_VERSION,
    // Include source so the same logical+attempt from different observers
    // (provider_response vs log_parser) do not collide on the UNIQUE event_id.
    event_id: `evt_${raw.source ?? 'provider_response'}_${raw.logical_request_id}_${raw.attempt_id}`,
    logical_request_id: raw.logical_request_id,
    attempt_id: raw.attempt_id,
    session_id: raw.session_id ?? null,
    turn_id: raw.turn_id ?? null,
    provider_id: raw.provider_id,
    model_id: raw.model_id ?? null,
    observed_at: raw.completed_at ?? raw.started_at ?? new Date().toISOString(),
    started_at: raw.started_at ?? null,
    completed_at: raw.completed_at ?? null,
    status,
    http_status: raw.http_status ?? null,
    latency_ms: raw.latency_ms ?? null,
    input_tokens: tokens.input_tokens ?? null,
    output_tokens: tokens.output_tokens ?? null,
    reasoning_tokens: tokens.reasoning_tokens ?? null,
    total_tokens: tokens.total_tokens ?? null,
    cache_read_tokens: tokens.cache_read_tokens ?? null,
    cache_write_tokens: tokens.cache_write_tokens ?? null,
    cache_creation_tokens: tokens.cache_creation_tokens ?? null,
    cost_value: null,
    cost_currency: null,
    data_quality: dq,
    source: raw.source ?? 'provider_response',
    error_category: raw.error_category ?? null,
    pricing_id: null,
    pricing_version: null,
  }
  return { event, problems }
}

/** Attach a field-level quality marker to a produced event. */
export function markQuality(e: UsageEvent, field: keyof UsageEvent, q: Quality): UsageEvent {
  ;(e.data_quality as any)[field] = q
  return e
}
