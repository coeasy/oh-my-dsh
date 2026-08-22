/**
 * Aggregation of a batch of usage events into a daily aggregate.
 * Kept as a pure function so both SQLite UPSERT and tests share the same math.
 */

import type { UsageEvent } from '@dsh/usage-protocol'
import type { DataQuality } from '@dsh/usage-protocol'

export interface DailyAggregate {
  date: string
  provider_id: string
  model_id: string
  request_count: number
  attempt_count: number
  success_count: number
  error_count: number
  unknown_status_count: number
  input_tokens_exact: number
  input_tokens_unknown_count: number
  output_tokens_exact: number
  output_tokens_unknown_count: number
  cache_read_tokens_exact: number
  cache_write_tokens_exact: number
  cache_creation_tokens_exact: number
  cache_status_unknown_count: number
  cache_read_requests: number
  cache_write_requests: number
  cache_creation_requests: number
  estimated_cost_value: number
  cost_currency: string | null
}

export function emptyAggregate(date: string, provider_id: string, model_id: string): DailyAggregate {
  return {
    date,
    provider_id,
    model_id,
    request_count: 0,
    attempt_count: 0,
    success_count: 0,
    error_count: 0,
    unknown_status_count: 0,
    input_tokens_exact: 0,
    input_tokens_unknown_count: 0,
    output_tokens_exact: 0,
    output_tokens_unknown_count: 0,
    cache_read_tokens_exact: 0,
    cache_write_tokens_exact: 0,
    cache_creation_tokens_exact: 0,
    cache_status_unknown_count: 0,
    cache_read_requests: 0,
    cache_write_requests: 0,
    cache_creation_requests: 0,
    estimated_cost_value: 0,
    cost_currency: null,
  }
}

function isExact(dq: DataQuality, field: keyof DataQuality): boolean {
  return dq[field] === 'exact' || dq[field] === 'estimated'
}

/** Merge one logical request's final event into the daily aggregate. */
export function accumulateEvent(agg: DailyAggregate, e: UsageEvent): DailyAggregate {
  agg.request_count += 1
  agg.attempt_count += 1
  if (e.status === 'completed') agg.success_count += 1
  else if (e.status === 'error') agg.error_count += 1
  else agg.unknown_status_count += 1

  if (e.input_tokens !== null) {
    if (isExact(e.data_quality, 'input_tokens')) agg.input_tokens_exact += e.input_tokens
    else agg.input_tokens_unknown_count += 1
  } else {
    agg.input_tokens_unknown_count += 1
  }
  if (e.output_tokens !== null) {
    if (isExact(e.data_quality, 'output_tokens')) agg.output_tokens_exact += e.output_tokens
    else agg.output_tokens_unknown_count += 1
  } else {
    agg.output_tokens_unknown_count += 1
  }
  if (e.cache_read_tokens !== null && isExact(e.data_quality, 'cache_read_tokens')) {
    agg.cache_read_tokens_exact += e.cache_read_tokens
  }
  if (e.cache_write_tokens !== null && isExact(e.data_quality, 'cache_write_tokens')) {
    agg.cache_write_tokens_exact += e.cache_write_tokens
  }
  if (e.cache_creation_tokens !== null && isExact(e.data_quality, 'cache_creation_tokens')) {
    agg.cache_creation_tokens_exact += e.cache_creation_tokens
  }

  const read = e.cache_read_tokens !== null && e.cache_read_tokens > 0
  const write = e.cache_write_tokens !== null && e.cache_write_tokens > 0
  const create = e.cache_creation_tokens !== null && e.cache_creation_tokens > 0
  if (read) agg.cache_read_requests += 1
  if (write) agg.cache_write_requests += 1
  if (create) agg.cache_creation_requests += 1
  if (!read && !write && !create) agg.cache_status_unknown_count += 1

  if (e.cost_value !== null && e.cost_value !== undefined) {
    agg.estimated_cost_value += e.cost_value
    agg.cost_currency = e.cost_currency ?? agg.cost_currency ?? null
  }
  return agg
}

/** Merge a full event list into a map keyed by date|provider|model. */
export function aggregateEvents(
  events: UsageEvent[],
  dateOf: (e: UsageEvent) => string,
): Map<string, DailyAggregate> {
  const out = new Map<string, DailyAggregate>()
  for (const e of events) {
    const key = `${dateOf(e)}|${e.provider_id}|${e.model_id ?? ''}`
    let agg = out.get(key)
    if (!agg) {
      agg = emptyAggregate(dateOf(e), e.provider_id, e.model_id ?? '')
      out.set(key, agg)
    }
    accumulateEvent(agg, e)
  }
  return out
}
