/**
 * Field-level data quality markers.
 *
 * Quality is tracked per-field (never a single event-level marker) so that a
 * single response can mix `exact` tokens, `estimated` cost and `unknown` cache
 * fields without misleading aggregation.
 */
export type Quality = 'exact' | 'estimated' | 'derived' | 'unknown'

export const QUALITIES: readonly Quality[] = ['exact', 'estimated', 'derived', 'unknown']

export function isQuality(v: unknown): v is Quality {
  return QUALITIES.includes(v as Quality)
}

/** The set of token/cost fields that carry their own quality marker. */
export type TokenField =
  | 'input_tokens'
  | 'output_tokens'
  | 'reasoning_tokens'
  | 'total_tokens'
  | 'cache_read_tokens'
  | 'cache_write_tokens'
  | 'cache_creation_tokens'
  | 'cost'

export const TOKEN_FIELDS: readonly TokenField[] = [
  'input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'total_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cache_creation_tokens',
  'cost',
]

export type DataQuality = { [K in TokenField]?: Quality }

/** A fully-qualified quality map with every field present. */
export function defaultQuality(): Required<DataQuality> {
  const q = {} as Required<DataQuality>
  for (const f of TOKEN_FIELDS) q[f] = 'unknown'
  return q
}
