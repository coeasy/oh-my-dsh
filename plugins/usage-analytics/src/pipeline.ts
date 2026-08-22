/**
 * Bounded async ingestion pipeline. Isolated from the main chat path: a full
 * queue or a storage error never blocks or throws into the caller.
 */

import type { UsageEvent } from '@dsh/usage-protocol'
import { StreamMerger } from '@dsh/usage-analytics-core'
import type { UsageStorage } from './storage.ts'

export interface PipelineStats {
  accepted: number
  dropped: number
  duplicates: number
  storageErrors: number
}

const DEFAULT_QUEUE_LIMIT = 512

export class UsagePipeline {
  private queue: UsageEvent[] = []
  private flushing = false
  private merger = new StreamMerger()
  private maxQueue: number
  readonly stats: PipelineStats = { accepted: 0, dropped: 0, duplicates: 0, storageErrors: 0 }

  private storage: UsageStorage

  constructor(storage: UsageStorage, opts: { queueLimit?: number } = {}) {
    this.storage = storage
    this.maxQueue = opts.queueLimit ?? DEFAULT_QUEUE_LIMIT
  }

  /** Reset dedup state (e.g. on disable/enable). */
  resetDedup(): void {
    this.merger = new StreamMerger()
  }

  /**
   * Accept a finalized event. Returns false if it was dropped (duplicate or
   * queue full). Never throws.
   */
  accept(e: UsageEvent): boolean {
    const key = {
      logical_request_id: e.logical_request_id,
      attempt_id: e.attempt_id,
      source: e.source,
    }
    if (this.merger.seenBefore(key)) {
      this.stats.duplicates += 1
      return false
    }
    if (this.queue.length >= this.maxQueue) {
      this.stats.dropped += 1
      return false
    }
    this.queue.push(e)
    this.stats.accepted += 1
    return true
  }

  /** Synchronous flush of the in-memory queue into storage. */
  flush(): void {
    if (this.flushing || this.queue.length === 0) return
    this.flushing = true
    const batch = this.queue
    this.queue = []
    try {
      for (const e of batch) {
        try {
          this.storage.insertEvent(e)
        } catch (err) {
          this.stats.storageErrors += 1
          void err
        }
      }
    } finally {
      this.flushing = false
    }
  }

  queueSize(): number {
    return this.queue.length
  }
}
