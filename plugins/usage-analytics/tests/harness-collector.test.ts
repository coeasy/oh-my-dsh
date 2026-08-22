import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import initSqlJs from 'sql.js'
import {
  collectFromEvents,
  eventFromMessage,
  type HarnessSessionEvent,
} from '../src/harness-collector.ts'
import { SqliteUsageStorage } from '../src/storage.ts'
import { UsagePipeline } from '../src/pipeline.ts'
import { normalize } from '../src/normalizer.ts'
import type { SafeObservedEvent } from '../src/normalizer.ts'

let SQL: any = null

function harnessEvent(over: Partial<HarnessSessionEvent> = {}): HarnessSessionEvent {
  return {
    type: 'assistant/message',
    turn: 1,
    step: 0,
    message: {},
    usage: { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 500, cacheWriteTokens: 40 },
    ...over,
  }
}

describe('harness collector', () => {
  it('extracts a SafeObservedEvent from assistant/message with usage', () => {
    const ev = eventFromMessage('sess_1', harnessEvent())
    assert.ok(ev)
    assert.equal(ev!.session_id, 'sess_1')
    assert.equal(ev!.turn_id, '1')
    assert.equal((ev!.usage as any).input_tokens, 1200)
    assert.equal((ev!.usage as any).cache_read_tokens, 500)
  })

  it('returns null when the adapter reported no usage', () => {
    assert.equal(eventFromMessage('s', harnessEvent({ usage: undefined })), null)
  })

  it('streams events into the sink', () => {
    const out: SafeObservedEvent[] = []
    collectFromEvents(
      'sess_1',
      [
        harnessEvent(),
        harnessEvent({ turn: 2, step: 1, usage: { inputTokens: 5, outputTokens: 1 } }),
        { type: 'user/message', turn: 3 } as HarnessSessionEvent,
      ],
      (e) => out.push(e),
    )
    assert.equal(out.length, 2)
  })
})

describe('harness → plugin end-to-end', () => {
  it('ingests real-shaped session events and aggregates them', async () => {
    if (!SQL) SQL = await initSqlJs()
    const storage = new SqliteUsageStorage(new SQL.Database())
    storage.runMigrations()
    const pipeline = new UsagePipeline(storage)

    const raw = eventFromMessage('sess_1', harnessEvent())!
    const { event } = normalize(raw, null)
    pipeline.accept(event)
    pipeline.flush()

    const overview: any = storage.getOverview()
    assert.equal(overview.request_count, 1)
    assert.equal(overview.input_tokens_exact, 1200)
    assert.equal(overview.output_tokens_exact, 340)
    const cache: any = storage.getCacheAnalysis()
    assert.equal(cache.cache_read_tokens_exact, 500)
  })
})
