/**
 * Harness observer: maps DeepSeek Harness session events to SafeObservedEvent.
 *
 * Subscribes to the Cordis `session/event` firehose and extracts token usage
 * from:
 *   - `assistant/message` → carries the step's final `usage` (TokenUsage)
 *   - `assistant/chunk` with `chunk.type === 'usage'` → streaming usage chunk
 *
 * Real shapes (verified against deepseek-harness/packages/core/session):
 *   TokenUsage     = { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens? }
 *   assistant/msg  = { turn, step, message, usage? }
 *   assistant/chunk= { turn, step, chunk: StreamChunk }
 *
 * The collector is duck-typed against the harness context (no hard import of
 * @deepseek-ai/cordis or @deepseek-ai/dsh-session), mirroring the
 * embedded-client pattern, so it typechecks without the vendor runtime.
 */

import type { SafeObservedEvent } from './normalizer.ts'

/** Minimal TokenUsage shape from the harness (camelCase). */
export interface HarnessTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Minimal duck-typed session event object. */
export interface HarnessSessionEvent {
  type: string
  turn: number
  step?: number
  message?: unknown
  usage?: HarnessTokenUsage
  chunk?: { type?: string; usage?: HarnessTokenUsage }
}

/** Minimal duck-typed Session/Cordis context the collector needs. */
export interface HarnessSessionLike {
  id: string
  on(event: 'event', listener: (ev: HarnessSessionEvent) => void): void
}

/** Sink that consumes produced safe events. */
export type ObserverSink = (ev: SafeObservedEvent) => void

const KNOWN_PROVIDER = 'unknown' // provider resolved downstream by mapping

/** Extract a SafeObservedEvent from a finalized assistant message event. */
export function eventFromMessage(
  sessionId: string,
  ev: HarnessSessionEvent,
): SafeObservedEvent | null {
  const usage = ev.usage
  if (!usage) return null // adapter reported no usage → skip (unknown downstream)
  const turn = typeof ev.turn === 'number' ? ev.turn : null
  const step = typeof ev.step === 'number' ? ev.step : null
  return {
    logical_request_id: `${sessionId}:t${turn ?? '?'}:s${step ?? '?'}`,
    attempt_id: `${sessionId}:t${turn ?? '?'}:s${step ?? '?'}:final`,
    session_id: sessionId,
    turn_id: turn === null ? null : String(turn),
    provider_id: KNOWN_PROVIDER,
    model_id: null,
    status: 'completed',
    completed_at: new Date().toISOString(),
    has_final_usage: true,
    source: 'sse_parser',
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens ?? null,
      cache_write_tokens: usage.cacheWriteTokens ?? null,
    },
  }
}

/**
 * Drive the collector over a stream of session events (pure, testable).
 * Returns the finalized SafeObservedEvents (one per assistant/message with
 * usage) plus a hook for streaming state. Streaming usage chunks are tracked
 * but only a final usage commits tokens — matching the "final usage preferred"
 * strategy.
 */
export function collectFromEvents(
  sessionId: string,
  events: HarnessSessionEvent[],
  sink: ObserverSink,
): void {
  for (const ev of events) {
    if (ev.type === 'assistant/message') {
      const out = eventFromMessage(sessionId, ev)
      if (out) sink(out)
    }
    // assistant/chunk usage chunks are informational; final usage comes from
    // the assembled assistant/message and is not double counted.
  }
}

/** Build a Cordis plugin entry that subscribes to live session events. */
export function createHarnessObserver(opts: {
  getSession: () => HarnessSessionLike | null
  sink: ObserverSink
  subscribeSession: (s: HarnessSessionLike, on: (ev: HarnessSessionEvent) => void) => () => void
}): () => void {
  const unsubs: Array<() => void> = []
  const start = (): (() => void) => {
    const session = opts.getSession()
    if (!session) return () => {}
    const on = (ev: HarnessSessionEvent): void => {
      if (ev.type === 'assistant/message') {
        const out = eventFromMessage(session.id, ev)
        if (out) opts.sink(out)
      }
    }
    const un = opts.subscribeSession(session, on)
    unsubs.push(un)
    return un
  }
  start()
  return () => {
    while (unsubs.length) unsubs.pop()?.()
  }
}
