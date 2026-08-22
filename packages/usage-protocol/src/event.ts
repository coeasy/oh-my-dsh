/**
 * usage.event.v1 — the canonical, field-level-quality-annotated event produced
 * by the Usage Analytics observer and consumed by the statistics core.
 *
 * Design rules (from the final plan):
 *  - Token/cost fields are `number | null`; `null` means `unknown`, never 0.
 *  - Every token/cost field has a matching field-level quality marker.
 *  - No prompt/response/authorization/api-key/raw-usage data is allowed here.
 */

import type { DataQuality } from './quality.ts'
import { isQuality } from './quality.ts'

export const SCHEMA_VERSION = 'usage.event.v1' as const

export type EventStatus =
  'completed' | 'error' | 'interrupted' | 'timeout' | 'cancelled' | 'unknown'

export const EVENT_STATUSES: readonly EventStatus[] = [
  'completed',
  'error',
  'interrupted',
  'timeout',
  'cancelled',
  'unknown',
]

export type ErrorCategory =
  | 'unsupported_provider'
  | 'invalid_mapping'
  | 'missing_usage'
  | 'stream_interrupted'
  | 'request_timeout'
  | 'http_error'
  | 'parse_error'
  | 'permission_denied'
  | 'storage_error'
  | 'plugin_incompatible'

export const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  'unsupported_provider',
  'invalid_mapping',
  'missing_usage',
  'stream_interrupted',
  'request_timeout',
  'http_error',
  'parse_error',
  'permission_denied',
  'storage_error',
  'plugin_incompatible',
]

export type EventSource = 'provider_response' | 'log_parser' | 'sse_parser' | 'host_derived'

export const EVENT_SOURCES: readonly EventSource[] = [
  'provider_response',
  'log_parser',
  'sse_parser',
  'host_derived',
]

export interface UsageEvent {
  schema_version: typeof SCHEMA_VERSION
  event_id: string
  logical_request_id: string
  attempt_id: string
  session_id: string | null
  turn_id: string | null
  provider_id: string
  model_id: string | null
  observed_at: string
  started_at: string | null
  completed_at: string | null
  status: EventStatus
  http_status: number | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  total_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  cache_creation_tokens: number | null
  cost_value: number | null
  cost_currency: string | null
  data_quality: DataQuality
  source: EventSource
  error_category: ErrorCategory | null
  pricing_id: string | null
  pricing_version: string | null
}

/**
 * Runtime validator. Hand-written (no external schema lib) to keep the package
 * zero-dependency, matching the monorepo philosophy.
 *
 * Returns the list of problems, or `null` when the value is a valid event.
 * Also rejects any forbidden sensitive field even if present as an extra key.
 */
const FORBIDDEN_KEYS = new Set([
  'prompt',
  'prompt_raw',
  'response',
  'response_raw',
  'authorization',
  'api_key',
  'apiKey',
  'cookie',
  'raw_provider_json',
  'usage_raw',
  'headers',
])

const NUM_FIELD: (keyof UsageEvent)[] = [
  'http_status',
  'latency_ms',
  'cost_value',
  'input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'total_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cache_creation_tokens',
]

const STR_FIELD: (keyof UsageEvent)[] = [
  'event_id',
  'logical_request_id',
  'attempt_id',
  'provider_id',
  'observed_at',
]

const NULLABLE_STR: (keyof UsageEvent)[] = [
  'session_id',
  'turn_id',
  'model_id',
  'started_at',
  'completed_at',
  'error_category',
  'pricing_id',
  'pricing_version',
  'cost_currency',
]

export function validateUsageEvent(v: unknown): string[] | null {
  if (typeof v !== 'object' || v === null) return ['not an object']
  const e = v as Record<string, unknown>
  const problems: string[] = []

  for (const key of Object.keys(e)) {
    if (FORBIDDEN_KEYS.has(key)) {
      problems.push(`forbidden field present: ${key}`)
    }
  }

  if (e.schema_version !== SCHEMA_VERSION) {
    problems.push(`schema_version must be ${SCHEMA_VERSION}`)
  }

  for (const f of STR_FIELD) {
    if (typeof e[f] !== 'string' || (e[f] as string).length === 0) {
      problems.push(`${f} must be a non-empty string`)
    }
  }
  for (const f of NULLABLE_STR) {
    if (e[f] !== null && e[f] !== undefined && typeof e[f] !== 'string') {
      problems.push(`${f} must be a string or null`)
    }
  }
  for (const f of NUM_FIELD) {
    const v = e[f]
    if (v === null || v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      problems.push(`${f} must be a non-negative number or null`)
    }
  }

  if (!EVENT_STATUSES.includes(e.status as EventStatus)) {
    problems.push(`invalid status: ${String(e.status)}`)
  }
  if (!EVENT_SOURCES.includes(e.source as EventSource)) {
    problems.push(`invalid source: ${String(e.source)}`)
  }
  if (e.error_category !== null && !ERROR_CATEGORIES.includes(e.error_category as ErrorCategory)) {
    problems.push(`invalid error_category: ${String(e.error_category)}`)
  }

  const dq = e.data_quality
  if (typeof dq !== 'object' || dq === null) {
    problems.push('data_quality must be an object')
  } else {
    for (const [k, v] of Object.entries(dq as Record<string, unknown>)) {
      if (!isQuality(v)) problems.push(`data_quality.${k} has invalid quality`)
    }
  }

  return problems.length ? problems : null
}
