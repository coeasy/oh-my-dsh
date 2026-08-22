/**
 * Cache request-count metrics and hit-rate, computed strictly on *known* data.
 * Unknown cache fields are never counted as a miss and never treated as 0.
 */

export interface CacheCounts {
  total_requests: number
  cache_read_requests: number
  cache_write_requests: number
  cache_creation_requests: number
  cache_status_unknown_count: number
}

/**
 * Classify a single event's cache contribution.
 * `cache_read_requests` = logical request with cache_read_tokens known and > 0.
 * `cache_status_unknown_count` = provider may support cache but returned nothing
 *   judgeable (no read/write/creation known field).
 */
export function classifyCacheEvent(
  readTokens: number | null,
  writeTokens: number | null,
  creationTokens: number | null,
): { read: boolean; write: boolean; creation: boolean; unknown: boolean } {
  const read = readTokens !== null && readTokens > 0
  const write = writeTokens !== null && writeTokens > 0
  const creation = creationTokens !== null && creationTokens > 0
  const unknown = !read && !write && !creation
  return { read, write, creation, unknown }
}

export function accumulateCacheCounts(): CacheCounts {
  return {
    total_requests: 0,
    cache_read_requests: 0,
    cache_write_requests: 0,
    cache_creation_requests: 0,
    cache_status_unknown_count: 0,
  }
}

export function addCacheEvent(
  acc: CacheCounts,
  readTokens: number | null,
  writeTokens: number | null,
  creationTokens: number | null,
): CacheCounts {
  acc.total_requests += 1
  const c = classifyCacheEvent(readTokens, writeTokens, creationTokens)
  if (c.read) acc.cache_read_requests += 1
  if (c.write) acc.cache_write_requests += 1
  if (c.creation) acc.cache_creation_requests += 1
  if (c.unknown) acc.cache_status_unknown_count += 1
  return acc
}

/**
 * Hit rate only over known cache-read data:
 *   cache_read_tokens / (cache_read_tokens + cache_write_tokens + cache_creation_tokens)
 * Returns null when no cache data is known at all (avoid dividing by zero and
 * avoid reporting a misleading "miss rate").
 */
export function cacheHitRate(
  readTokens: number | null,
  writeTokens: number | null,
  creationTokens: number | null,
): number | null {
  const read = readTokens ?? 0
  const write = writeTokens ?? 0
  const creation = creationTokens ?? 0
  const known = read + write + creation
  if (known <= 0) return null
  return read / known
}
