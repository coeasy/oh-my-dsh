/**
 * Pure formatting + quality helpers for the shared UI. Kept DOM-free so they
 * are unit-testable under node:test without jsdom.
 *
 * Core rule: `null`/unknown renders as an em-dash + an "unknown" badge — never
 * as a misleading 0.
 */

import type { Quality } from '@dsh/usage-protocol'

/** Escape a string for safe interpolation into HTML. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Format a token count. null → '—' (unknown). */
export function formatToken(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('en-US')
}

/** Format a cost. null → '—'; otherwise a currency-prefixed value. */
export function formatCost(
  v: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (v === null || v === undefined) return '—'
  const sym = currency === 'CNY' ? '¥' : '$'
  return `${sym}${v.toFixed(4)}`
}

/** Format a ratio (0..1) as a percentage; null → '—'. */
export function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return `${(v * 100).toFixed(1)}%`
}

export interface QualityBadge {
  label: string
  className: string
}

/** Field-level quality → badge styling. Unknown is visually distinct from 0. */
export function qualityBadge(q: Quality): QualityBadge {
  switch (q) {
    case 'exact':
      return { label: 'exact', className: 'q-exact' }
    case 'estimated':
      return { label: '≈ estimated', className: 'q-estimated' }
    case 'derived':
      return { label: 'derived', className: 'q-derived' }
    case 'unknown':
    default:
      return { label: 'unknown', className: 'q-unknown' }
  }
}

/** Render a quality badge span. */
export function badgeHtml(q: Quality): string {
  const b = qualityBadge(q)
  return `<span class="qa-badge ${b.className}" title="data quality: ${b.label}">${esc(b.label)}</span>`
}

/** Whether a query result carries estimated/unknown content (for headers). */
export function summaryNote(hasEstimated: boolean, hasUnknown: boolean): string {
  const parts: string[] = []
  if (hasEstimated) parts.push('includes estimates')
  if (hasUnknown) parts.push('some fields unknown')
  return parts.length ? `· ${parts.join(', ')}` : ''
}

/** Format a UTC date (YYYY-MM-DD) to a short local string. */
export function formatDate(iso: string | number): string {
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso)
  return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10)
}
