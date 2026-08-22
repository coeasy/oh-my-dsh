/**
 * Versioned, local-only cost estimation.
 *
 * Cost estimation is opt-in and clearly marked `estimated`. Only known token
 * counts are priced; unknown fields are skipped. No network access, no official
 * billing — this is a local estimate only.
 */

export type Currency = 'USD' | 'CNY' | string

export interface PriceEntry {
  /** Per 1M input tokens. */
  input_per_mtok: number
  /** Per 1M output tokens. */
  output_per_mtok: number
  /** Per 1M cache-read tokens. */
  cache_read_per_mtok?: number
  /** Per 1M cache-write tokens. */
  cache_write_per_mtok?: number
}

export interface PriceTable {
  id: string
  version: string
  currency: Currency
  models: Record<string, PriceEntry>
  /** fallback used when model not found */
  default?: PriceEntry
}

export interface CostInput {
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
}

export interface CostResult {
  value: number
  currency: Currency
  /** which components were priced */
  components: {
    input: boolean
    output: boolean
    cache_read: boolean
    cache_write: boolean
  }
}

export function estimateCost(table: PriceTable, model_id: string | null, input: CostInput): CostResult {
  const entry = (model_id && table.models[model_id]) || table.default || { input_per_mtok: 0, output_per_mtok: 0 }
  let value = 0
  const components = { input: false, output: false, cache_read: false, cache_write: false }
  if (input.input_tokens !== null && entry.input_per_mtok > 0) {
    value += (input.input_tokens / 1_000_000) * entry.input_per_mtok
    components.input = true
  }
  if (input.output_tokens !== null && entry.output_per_mtok > 0) {
    value += (input.output_tokens / 1_000_000) * entry.output_per_mtok
    components.output = true
  }
  if (input.cache_read_tokens !== null && entry.cache_read_per_mtok !== undefined && entry.cache_read_per_mtok > 0) {
    value += (input.cache_read_tokens / 1_000_000) * entry.cache_read_per_mtok
    components.cache_read = true
  }
  if (input.cache_write_tokens !== null && entry.cache_write_per_mtok !== undefined && entry.cache_write_per_mtok > 0) {
    value += (input.cache_write_tokens / 1_000_000) * entry.cache_write_per_mtok
    components.cache_write = true
  }
  return { value: round(value), currency: table.currency, components }
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

/** Validate that a price table is structurally sound (all numbers, no code). */
export function validatePriceTable(t: unknown): string[] {
  const problems: string[] = []
  if (typeof t !== 'object' || t === null) return ['price table must be an object']
  const table = t as Record<string, unknown>
  if (typeof table.id !== 'string' || typeof table.version !== 'string') {
    problems.push('id and version are required strings')
  }
  if (typeof table.currency !== 'string') problems.push('currency required')
  const models = table.models
  if (typeof models !== 'object' || models === null) {
    problems.push('models must be an object')
  } else {
    for (const [model, entry] of Object.entries(models as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) {
        problems.push(`model ${model} entry must be object`)
        continue
      }
      const e = entry as Record<string, unknown>
      for (const key of ['input_per_mtok', 'output_per_mtok']) {
        if (typeof e[key] !== 'number' || e[key] < 0) problems.push(`${model}.${key} must be a non-negative number`)
      }
    }
  }
  for (const bad of ['code', 'fn', 'evaluate']) {
    if (bad in table) problems.push(`executable field not allowed: ${bad}`)
  }
  return problems
}
