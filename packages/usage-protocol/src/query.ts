/**
 * Unified Query API types shared by the statistics core and every UI.
 * UIs only ever depend on these types + the Query API; they never touch SQLite.
 */

export type TimeRange = 'today' | '7d' | '30d' | '90d' | 'custom'

export interface DateRange {
  start: string // ISO date or timestamp
  end: string
}

export interface Filters {
  provider_ids?: string[]
  model_ids?: string[]
  statuses?: string[]
}

export interface QueryRequest {
  range: TimeRange
  /** Optional UI view selector (overview | providers | cache | events | trend | models | session | settings).
   * When omitted the host defaults to overview. Lets the shared UI fetch only the
   * single data block it needs instead of an aggregate. */
  view?: string
  start?: string
  end?: string
  filters?: Filters
  page?: number
  pageSize?: number
}

export interface OverviewData {
  range: DateRange
  filters: Filters
  request_count: number
  attempt_count: number
  success_count: number
  error_count: number
  unknown_status_count: number
  input_tokens_exact: number
  output_tokens_exact: number
  reasoning_tokens_exact: number
  cache_read_tokens_exact: number
  cache_write_tokens_exact: number
  cache_creation_tokens_exact: number
  cache_read_requests: number
  cache_write_requests: number
  cache_creation_requests: number
  cache_status_unknown_count: number
  error_rate: number | null
  latency_p50: number | null
  latency_p95: number | null
  estimated_cost_value: number | null
  cost_currency: string | null
  has_estimated: boolean
  has_unknown: boolean
}

export interface DailyPoint {
  date: string
  request_count: number
  input_tokens_exact: number
  output_tokens_exact: number
  cache_read_requests: number
  error_count: number
  estimated_cost_value: number | null
}

export interface ProviderRow {
  provider_id: string
  request_count: number
  success_count: number
  error_count: number
  error_rate: number | null
  latency_p50: number | null
  input_tokens_exact: number
  output_tokens_exact: number
  cache_read_requests: number
  estimated_cost_value: number | null
  model_ids: string[]
}

export interface ModelRow {
  model_id: string
  request_count: number
  input_tokens_exact: number
  output_tokens_exact: number
}

export interface CacheAnalysis {
  total_requests: number
  cache_read_requests: number
  cache_write_requests: number
  cache_creation_requests: number
  cache_status_unknown_count: number
  cache_read_tokens_exact: number
  cache_write_tokens_exact: number
  cache_creation_tokens_exact: number
  /** Hit rate computed ONLY over requests with known cache data. null when none known. */
  hit_rate: number | null
}

export interface UsageEventRow {
  event_id: string
  logical_request_id: string
  attempt_id: string
  session_id: string | null
  turn_id: string | null
  provider_id: string
  model_id: string | null
  observed_at: string
  status: string
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  estimated_cost_value: number | null
  data_quality_json: string
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface QueryResponse {
  request: QueryRequest
  data: unknown
  quality: {
    has_estimated: boolean
    has_unknown: boolean
  }
}
