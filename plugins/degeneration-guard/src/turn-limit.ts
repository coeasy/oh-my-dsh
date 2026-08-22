/**
 * Per-session agent-step counter (plan §12.4 maxTurnsPerSession).
 *
 * Q3 decision: at the cap the guard reminds — it never hard-stops a session.
 * The reminder is emitted once at the cap and then throttled (every N overruns
 * beyond the cap) so a long-lived legitimate session does not spam.
 */

export interface TurnLimitOptions {
  maxTurns: number
  /** Remind again every this-many overruns after the first reminder. */
  remindEvery?: number
}

export interface TurnCheckResult {
  action: 'none' | 'notify'
  reminder?: string
  turns: number
}

export class TurnLimiter {
  private readonly maxTurns: number
  private readonly remindEvery: number
  private readonly turns = new Map<string, number>()
  private readonly remindedAt = new Map<string, number>()

  constructor(opts: TurnLimitOptions) {
    if (!Number.isInteger(opts.maxTurns) || opts.maxTurns < 1)
      throw new Error('maxTurns must be >= 1')
    this.maxTurns = opts.maxTurns
    this.remindEvery = opts.remindEvery ?? 10
  }

  /** Record one agent step for a session and return whether a reminder is due. */
  noteStep(sessionId: string): TurnCheckResult {
    const next = (this.turns.get(sessionId) ?? 0) + 1
    this.turns.set(sessionId, next)
    if (next <= this.maxTurns) return { action: 'none', turns: next }

    const lastReminded = this.remindedAt.get(sessionId) ?? 0
    if (next === this.maxTurns + 1 || next - lastReminded >= this.remindEvery) {
      this.remindedAt.set(sessionId, next)
      return {
        action: 'notify',
        turns: next,
        reminder: `会话已达到 ${next} 轮（上限 ${this.maxTurns} 轮）。如果任务仍未完成，请评估是否陷入循环：总结当前进展、改变方法或结束任务。`,
      }
    }
    return { action: 'none', turns: next }
  }

  getTurns(sessionId: string): number {
    return this.turns.get(sessionId) ?? 0
  }

  reset(sessionId: string): void {
    this.turns.delete(sessionId)
    this.remindedAt.delete(sessionId)
  }

  /** Clear every session's counters (e.g. on plugin reset / session cleanup). */
  resetAll(): void {
    this.turns.clear()
    this.remindedAt.clear()
  }
}
