/**
 * Pure view renderers: each returns an HTML string (escaped) for a page. No DOM
 * access, so they are testable under node:test. The mount layer (app.ts) injects
 * these into a container and wires the bridge.
 *
 * Design rules:
 *  - Unknown values render as '—' (via format.ts), never as 0.
 *  - Cache hit rate only shown when known.
 *  - Cost cards are opt-in and gated by the host capability.
 */

import { esc, formatToken, formatCost, formatPercent, formatDate } from './format.ts'
import type { Route } from './bridge.ts'

export interface OverviewData {
  request_count: number
  success_count: number
  error_count: number
  unknown_status_count: number
  input_tokens_exact: number
  output_tokens_exact: number
  cache_read_requests: number
  cache_status_unknown_count: number
  cache_read_tokens_exact: number
  estimated_cost_value: number | null
  error_rate: number | null
  latency_p50: number | null
  latency_p95: number | null
}

export interface ProviderRowData {
  provider_id: string
  request_count: number
  success_count: number
  error_count: number
  error_rate: number | null
  input_tokens_exact: number
  output_tokens_exact: number
  cache_read_requests: number
  estimated_cost_value: number | null
}

export interface CacheData {
  total_requests: number
  cache_read_requests: number
  cache_write_requests: number
  cache_creation_requests: number
  cache_status_unknown_count: number
  cache_read_tokens_exact: number
  cache_write_tokens_exact: number
  cache_creation_tokens_exact: number
  hit_rate: number | null
}

export interface EventRowData {
  event_id: string
  logical_request_id: string
  provider_id: string
  model_id: string | null
  observed_at: string
  status: string
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cost_value: number | null
  cost_currency: string | null
}

export interface TrendPointData {
  date: string
  request_count: number
  input_tokens_exact: number
  output_tokens_exact: number
  cache_read_requests: number
  error_count: number
  estimated_cost_value: number | null
}

export interface ModelRowData {
  model_id: string | null
  request_count: number
  input_tokens_exact: number
  output_tokens_exact: number
}

export function statCard(label: string, value: string, hint = ''): string {
  return `<div class="qa-card qa-stat"><div class="qa-stat-label">${esc(label)}</div><div class="qa-stat-value">${value}</div>${hint ? `<div class="qa-stat-hint">${esc(hint)}</div>` : ''}</div>`
}

export function renderOverview(overview: OverviewData, costEnabled: boolean): string {
  const cards = [
    statCard('Requests', formatToken(overview.request_count)),
    statCard('Input tokens', formatToken(overview.input_tokens_exact)),
    statCard('Output tokens', formatToken(overview.output_tokens_exact)),
    statCard('Cache reads', formatToken(overview.cache_read_requests)),
    statCard(
      'Cache unknown',
      formatToken(overview.cache_status_unknown_count),
      'provider did not report',
    ),
    statCard('Error rate', formatPercent(overview.error_rate)),
    statCard('P50 latency', overview.latency_p50 === null ? '—' : `${overview.latency_p50}ms`),
    statCard('P95 latency', overview.latency_p95 === null ? '—' : `${overview.latency_p95}ms`),
  ]
  if (costEnabled) {
    cards.splice(
      0,
      0,
      statCard(
        'Est. cost',
        formatCost(overview.estimated_cost_value, 'USD'),
        'estimated, local only',
      ),
    )
  }
  return `<section class="qa-page" data-route="overview"><h2>Overview</h2><div class="qa-grid">${cards.join('')}</div></section>`
}

export function renderProviders(providers: ProviderRowData[], costEnabled: boolean): string {
  const rows = providers
    .map((p) => {
      const cost = costEnabled ? `<td>${formatCost(p.estimated_cost_value, 'USD')}</td>` : ''
      return `<tr><td>${esc(p.provider_id)}</td><td>${formatToken(p.request_count)}</td><td>${formatToken(p.success_count)}</td><td>${formatToken(p.error_count)}</td><td>${formatPercent(p.error_rate)}</td><td>${formatToken(p.input_tokens_exact)}</td><td>${formatToken(p.output_tokens_exact)}</td><td>${formatToken(p.cache_read_requests)}</td>${cost}</tr>`
    })
    .join('')
  const costHead = costEnabled ? '<th>Est. cost</th>' : ''
  return `<section class="qa-page" data-route="providers"><h2>Providers</h2><table class="qa-table"><thead><tr><th>Provider</th><th>Requests</th><th>Success</th><th>Errors</th><th>Error rate</th><th>Input</th><th>Output</th><th>Cache reads</th>${costHead}</tr></thead><tbody>${rows || '<tr><td colspan="8">No data</td></tr>'}</tbody></table></section>`
}

export function renderCache(cache: CacheData): string {
  const hit =
    cache.hit_rate === null
      ? '<span class="qa-badge q-unknown" title="no known cache data; not reported as a miss">unknown</span>'
      : formatPercent(cache.hit_rate)
  return `<section class="qa-page" data-route="cache"><h2>Cache</h2><div class="qa-grid">${[
    statCard('Total requests', formatToken(cache.total_requests)),
    statCard('Cache reads', formatToken(cache.cache_read_requests)),
    statCard('Cache writes', formatToken(cache.cache_write_requests)),
    statCard('Cache creations', formatToken(cache.cache_creation_requests)),
    statCard('Cache unknown', formatToken(cache.cache_status_unknown_count)),
    statCard('Cache read tokens', formatToken(cache.cache_read_tokens_exact)),
    statCard('Hit rate (known only)', hit),
  ].join('')}</div></section>`
}

export function renderTrend(points: TrendPointData[]): string {
  const rows = points
    .map((p) => {
      return `<tr><td>${esc(p.date)}</td><td>${formatToken(p.request_count)}</td><td>${formatToken(p.input_tokens_exact)}</td><td>${formatToken(p.output_tokens_exact)}</td><td>${formatToken(p.cache_read_requests)}</td><td>${formatToken(p.error_count)}</td><td>${formatCost(p.estimated_cost_value, 'USD')}</td></tr>`
    })
    .join('')
  return `<section class="qa-page" data-route="trend"><h2>Daily trend</h2><table class="qa-table"><thead><tr><th>Date</th><th>Requests</th><th>Input</th><th>Output</th><th>Cache reads</th><th>Errors</th><th>Est. cost</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No data</td></tr>'}</tbody></table></section>`
}

export function renderModels(models: ModelRowData[]): string {
  const rows = models
    .map((m) => {
      return `<tr><td>${esc(m.model_id ?? '—')}</td><td>${formatToken(m.request_count)}</td><td>${formatToken(m.input_tokens_exact)}</td><td>${formatToken(m.output_tokens_exact)}</td></tr>`
    })
    .join('')
  return `<section class="qa-page" data-route="models"><h2>Models</h2><table class="qa-table"><thead><tr><th>Model</th><th>Requests</th><th>Input</th><th>Output</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No data</td></tr>'}</tbody></table></section>`
}

export function renderSessions(events: EventRowData[]): string {
  const rows = events
    .map((e) => {
      return `<tr><td>${esc(e.logical_request_id)}</td><td>${esc(e.provider_id)}</td><td>${esc(e.model_id ?? '—')}</td><td>${formatDate(e.observed_at)}</td><td>${esc(e.status)}</td><td>${formatToken(e.input_tokens)}</td><td>${formatToken(e.output_tokens)}</td><td>${formatToken(e.cache_read_tokens)}</td><td>${formatCost(e.cost_value, e.cost_currency)}</td></tr>`
    })
    .join('')
  return `<section class="qa-page" data-route="sessions"><h2>Events</h2><table class="qa-table"><thead><tr><th>Request</th><th>Provider</th><th>Model</th><th>Date</th><th>Status</th><th>Input</th><th>Output</th><th>Cache read</th><th>Est. cost</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No events</td></tr>'}</tbody></table></section>`
}

export function renderSettings(
  capabilities: { costEstimation: boolean; exportFormats: string[] },
  status: unknown,
): string {
  return `<section class="qa-page" data-route="settings"><h2>Settings</h2><div class="qa-card"><h3>Status</h3><pre class="qa-pre">${esc(JSON.stringify(status, null, 2))}</pre></div><div class="qa-card"><h3>Capabilities</h3><ul><li>Cost estimation: ${capabilities.costEstimation ? 'enabled' : 'disabled (default)'}</li><li>Export formats: ${esc(capabilities.exportFormats.join(', ') || 'none')}</li></ul></div></section>`
}

/** Route registry used by the mount layer for simple routing. */
export const ROUTES: readonly Route[] = [
  'overview',
  'trend',
  'providers',
  'models',
  'cache',
  'sessions',
  'settings',
]
