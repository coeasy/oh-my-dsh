/**
 * Streaming-response merge and request dedup.
 *
 * One user action = one logical_request_id; each network attempt = one
 * attempt_id. Retries share a logical ID and must not double-count tokens or
 * cost. Streaming events are merged into a single final record.
 */

import type { UsageEvent } from '@dsh/usage-protocol'

export interface InFlightStream {
  logical_request_id: string
  attempt_id: string
  started_at: string | null
  chunks: number
  saw_final_usage: boolean
  token_fields: Partial<
    Pick<
      UsageEvent,
      | 'input_tokens'
      | 'output_tokens'
      | 'total_tokens'
      | 'cache_read_tokens'
      | 'cache_write_tokens'
      | 'cache_creation_tokens'
    >
  >
  http_status: number | null
}

export function openStream(
  logical_request_id: string,
  attempt_id: string,
  started_at: string | null,
): InFlightStream {
  return {
    logical_request_id,
    attempt_id,
    started_at,
    chunks: 0,
    saw_final_usage: false,
    token_fields: {},
    http_status: null,
  }
}

/** Merge a chunk's discovered usage into the in-flight stream (first non-null wins). */
export function mergeChunk(stream: InFlightStream, chunk: Partial<UsageEvent>): InFlightStream {
  stream.chunks += 1
  if (chunk.http_status !== undefined && chunk.http_status !== null)
    stream.http_status = chunk.http_status
  for (const field of [
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'cache_creation_tokens',
  ] as const) {
    const v = chunk[field]
    if (v !== undefined && v !== null && stream.token_fields[field] === undefined) {
      stream.token_fields[field] = v
    }
  }
  if (chunk.status === 'completed') stream.saw_final_usage = true
  return stream
}

const FINAL_TOKEN_FIELDS = [
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'cache_creation_tokens',
] as const

/** Pick the non-null token fields of a final usage record (authoritative). */
function pickFinalTokens(u: Partial<UsageEvent>): Partial<UsageEvent> {
  const out: Partial<UsageEvent> = {}
  for (const field of FINAL_TOKEN_FIELDS) {
    const v = u[field]
    if (v !== undefined && v !== null) out[field] = v
  }
  return out
}

/**
 * Finalize a stream into a UsageEvent.
 * If no final usage was seen, token fields stay `null` (unknown) — intermediate
 * chunks are NOT summed into a fake total. When a final usage IS committed, its
 * non-null token fields take precedence (last-wins) over any earlier chunk,
 * matching the "authoritative total" contract. `mergeChunk` remains first-wins
 * only for incremental chunk merging during the stream.
 */
export function finalizeStream(
  stream: InFlightStream,
  base: Omit<
    UsageEvent,
    | 'input_tokens'
    | 'output_tokens'
    | 'total_tokens'
    | 'cache_read_tokens'
    | 'cache_write_tokens'
    | 'cache_creation_tokens'
    | 'observed_at'
  >,
  observed_at: string,
  finalUsage?: Partial<UsageEvent> | null,
): UsageEvent {
  const merged = finalUsage ? mergeChunk({ ...stream }, finalUsage) : stream
  const finalCommitted = stream.saw_final_usage || Boolean(finalUsage?.status === 'completed')
  const tf = finalCommitted
    ? finalUsage
      ? { ...stream.token_fields, ...pickFinalTokens(finalUsage) }
      : stream.token_fields
    : {}
  return {
    ...base,
    observed_at,
    input_tokens: tf.input_tokens ?? null,
    output_tokens: tf.output_tokens ?? null,
    total_tokens: tf.total_tokens ?? null,
    cache_read_tokens: tf.cache_read_tokens ?? null,
    cache_write_tokens: tf.cache_write_tokens ?? null,
    cache_creation_tokens: tf.cache_creation_tokens ?? null,
    http_status: merged.http_status ?? base.http_status,
  }
}

/** Dedup: same logical+attempt+source → duplicate. */
export function dedupKey(
  event: Pick<UsageEvent, 'logical_request_id' | 'attempt_id' | 'source'>,
): string {
  return `${event.logical_request_id}::${event.attempt_id}::${event.source}`
}

/**
 * Streaming merge state machine keyed by logical+attempt.
 * Returns true when the event was a duplicate and should be dropped.
 */
export class StreamMerger {
  /** Cap on in-memory dedup keys; beyond this the set is reset so a long-lived
   * plugin never leaks unbounded memory. Data safety is preserved because the
   * storage layer still rejects duplicate event_ids (UNIQUE constraint). */
  static readonly MAX_SEEN = 50_000
  private seen = new Set<string>()
  private streams = new Map<string, InFlightStream>()

  seenBefore(e: Pick<UsageEvent, 'logical_request_id' | 'attempt_id' | 'source'>): boolean {
    const key = dedupKey(e)
    if (this.seen.has(key)) return true
    if (this.seen.size >= StreamMerger.MAX_SEEN) {
      this.seen.clear()
    }
    this.seen.add(key)
    return false
  }

  isOpen(logical: string, attempt: string): boolean {
    return this.streams.has(`${logical}::${attempt}`)
  }

  open(logical: string, attempt: string, started: string | null): InFlightStream {
    const s = openStream(logical, attempt, started)
    this.streams.set(`${logical}::${attempt}`, s)
    return s
  }

  get(logical: string, attempt: string): InFlightStream | undefined {
    return this.streams.get(`${logical}::${attempt}`)
  }

  close(logical: string, attempt: string): void {
    this.streams.delete(`${logical}::${attempt}`)
  }
}
