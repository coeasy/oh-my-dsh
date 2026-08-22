/**
 * Escalation ladder (plan §12.3).
 *
 * A small state machine mapping detector signals to actions:
 *
 *   L1: thinking repetition first hit → interrupt the request (if the host can
 *       abort) and, when autoRetry is enabled and no retry has been used in
 *       this episode, signal `retry` (host injects anti-loop context).
 *   L2: second hit within the same episode (after a retry) → `pause`.
 *   L3: tool-chain hard stop / response-length / tool-repeat → `pause`.
 *
 * Pauses are sticky: once paused, the guard stays paused until the host
 * resumes it (user decision). The state machine is pure and testable.
 */

import type { FeedResult } from './types.ts'

export interface EscalationOptions {
  autoRetry: boolean
  /** Emit a `notify` instead of `retry`/`pause` when the host cannot abort. */
  canAbort: () => boolean
}

export interface EscalationDecision {
  result: FeedResult
  /** true when this signal advanced the ladder (worth emitting an event). */
  advanced: boolean
}

/**
 * Tracks one loop episode: a repetition signal resets the episode when the
 * stream makes real progress (feedReset with `progress: true`).
 */
export class EscalationLadder {
  private readonly autoRetry: boolean
  private readonly canAbort: () => boolean
  private retryUsed = false
  private paused = false
  private pauseReason: string | undefined

  constructor(opts: EscalationOptions) {
    this.autoRetry = opts.autoRetry
    this.canAbort = opts.canAbort
  }

  /** Signal a thinking-stream repetition. */
  signalRepetition(family: 'thinking' | 'tool', detail: string): EscalationDecision {
    if (this.paused) return { result: { action: 'none' }, advanced: false }
    // L1 first hit: retry path (interrupt + one auto retry). Auto-retry only
    // makes sense when the host can actually abort the in-flight request.
    if (!this.retryUsed) {
      this.retryUsed = true
      const action = this.autoRetry && this.canAbort() ? 'retry' : 'pause'
      if (action === 'retry') {
        return {
          result: {
            action,
            reason: `${family} 重复输出被检测到，已中断请求并注入反循环提示`,
            family,
            detail,
          } as FeedResult,
          advanced: true,
        }
      }
      return this.pauseNow(family, detail, true)
    }
    // L2 second hit in the same episode → pause.
    return this.pauseNow(family, detail, true)
  }

  /** Signal a hard backstop (response too long / tool hard stop). */
  signalHardStop(family: 'tool' | 'length', detail: string): EscalationDecision {
    return this.pauseNow(family, detail, true)
  }

  /** An advisory notification that never pauses (turn limit / tool reminder). */
  notify(
    detail: string,
    reminder?: string,
    family: FeedResult['family'] = 'turn',
  ): EscalationDecision {
    return {
      result: { action: 'notify', reason: detail, reminder, family } as FeedResult,
      advanced: false,
    }
  }

  private pauseNow(family: string, detail: string, advanced: boolean): EscalationDecision {
    this.paused = true
    this.pauseReason = `${family}: ${detail}`
    return {
      result: {
        action: 'pause',
        reason: this.pauseReason,
        family: family as FeedResult['family'],
      } as FeedResult,
      advanced,
    }
  }

  /**
   * Reset episode state. `progress: true` means real progress was observed
   * (step boundary / new user message / tool call) — the retry budget resets.
   */
  reset(progress: boolean): void {
    if (this.paused) return
    if (progress) this.retryUsed = false
  }

  /** Resume after a user decision (continue with a fresh retry budget). */
  resume(): void {
    this.paused = false
    this.pauseReason = undefined
    this.retryUsed = false
  }

  isPaused(): boolean {
    return this.paused
  }

  pauseReasonText(): string | undefined {
    return this.pauseReason
  }
}
