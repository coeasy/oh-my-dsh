/**
 * Built-in declarative Provider mapping templates (read-only base configs).
 * Users clone one and override prices/fields without writing code.
 */

import type { ProviderMapping } from '@dsh/usage-analytics-core'
import type { PriceTable } from '@dsh/usage-analytics-core'

export const OPENAI_COMPATIBLE: ProviderMapping = {
  id: 'openai-compatible',
  match: {},
  usage: {
    input_tokens: ['$.prompt_tokens', '$.input_tokens'],
    output_tokens: ['$.completion_tokens', '$.output_tokens'],
    total_tokens: ['$.total_tokens'],
    cache_read_tokens: ['$.prompt_tokens_details.cached_tokens'],
  },
  streaming: { strategy: 'final_usage_preferred' },
}

export const DEEPSEEK: ProviderMapping = {
  id: 'deepseek',
  match: { base_url_pattern: 'api.deepseek.com' },
  usage: {
    input_tokens: ['$.prompt_tokens', '$.input_tokens'],
    output_tokens: ['$.completion_tokens', '$.output_tokens'],
    total_tokens: ['$.total_tokens'],
    cache_read_tokens: ['$.prompt_cache_hit_tokens', '$.prompt_tokens_details.cached_tokens'],
    cache_write_tokens: ['$.prompt_cache_miss_tokens'],
  },
  streaming: { strategy: 'final_usage_preferred' },
}

export const ANTHROPIC_COMPATIBLE: ProviderMapping = {
  id: 'anthropic-compatible',
  match: {},
  usage: {
    input_tokens: ['$.input_tokens'],
    output_tokens: ['$.output_tokens'],
    cache_read_tokens: ['$.cache_read_input_tokens'],
    cache_creation_tokens: ['$.cache_creation_input_tokens'],
  },
  streaming: { strategy: 'final_usage_preferred' },
}

export const GEMINI_COMPATIBLE: ProviderMapping = {
  id: 'gemini-compatible',
  match: {},
  usage: {
    input_tokens: ['$.usageMetadata.promptTokenCount', '$.promptTokenCount'],
    output_tokens: ['$.usageMetadata.candidatesTokenCount', '$.candidatesTokenCount'],
    cache_read_tokens: ['$.usageMetadata.cachedContentTokenCount', '$.cachedContentTokenCount'],
  },
  streaming: { strategy: 'final_usage_preferred' },
}

/** All built-in templates, keyed by id. */
export const BUILTIN_MAPPINGS: Record<string, ProviderMapping> = {
  'openai-compatible': OPENAI_COMPATIBLE,
  deepseek: DEEPSEEK,
  'anthropic-compatible': ANTHROPIC_COMPATIBLE,
  'gemini-compatible': GEMINI_COMPATIBLE,
}

/** Versioned default price table (USD). Users may override. */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  id: 'builtin-default',
  version: '2026-08-20',
  currency: 'USD',
  models: {},
  default: { input_per_mtok: 0.5, output_per_mtok: 1.5 },
}
