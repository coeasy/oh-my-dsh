/**
 * Degeneration guard core — the observable, testable engine behind the plugin.
 *
 * Wires together: two rolling buffers (thinking / text), the n-gram cycle
 * detector, the tool repeat chain, the turn limiter, and the escalation
 * ladder. Feeds come from the host's stream seam; decisions come back as
 * FeedResult actions the host applies (notify / retry / pause).
 */

import { RollingBuffer } from './buffer.ts'
import { EscalationLadder } from './escalation.ts'
import { detectCycle } from './ngram.ts'
import { ToolChain } from './tool-chain.ts'
import { TurnLimiter } from './turn-limit.ts'
import {
  DEFAULT_CONFIG,
  MODE_PRESETS,
  type FeedResult,
  type GuardConfig,
  type GuardConfigPatch,
  type GuardMode,
  type StreamKind,
} from './types.ts'

/** Minimum normalized chars accumulated before a cycle check runs again. */
export const CYCLE_CHECK_THROTTLE_CHARS = 256

export interface GuardCoreOptions {
  config?: GuardConfigPatch
  canAbort?: () => boolean
}

export class DegenerationGuardCore {
  private cfg: GuardConfig
  private thinkingBuffer: RollingBuffer
  private textBuffer: RollingBuffer
  private toolChain: ToolChain
  private turnLimiter: TurnLimiter
  private readonly ladder: EscalationLadder

  private thinkingChars = 0
  private responseChars = 0
  /** Unchecked chars since the last cycle check (throttle accumulator). */
  private pendingThinkingChars = 0

  readonly stats = {
    thinkingChecks: 0,
    thinkingHits: 0,
    retries: 0,
    pauses: 0,
    toolRepeatWarns: 0,
    toolRepeatPauses: 0,
    turnReminders: 0,
  }

  constructor(opts: GuardCoreOptions = {}) {
    this.cfg = {
      ...DEFAULT_CONFIG,
      ...opts.config,
      stream: { ...DEFAULT_CONFIG.stream, ...opts.config?.stream },
      tool: { ...DEFAULT_CONFIG.tool, ...opts.config?.tool },
    }
    this.thinkingBuffer = new RollingBuffer(this.cfg.stream.windowChars)
    this.textBuffer = new RollingBuffer(this.cfg.stream.windowChars)
    this.toolChain = new ToolChain(this.cfg.tool)
    this.turnLimiter = new TurnLimiter({ maxTurns: this.cfg.maxTurnsPerSession })
    this.ladder = new EscalationLadder({
      autoRetry: this.cfg.autoRetry,
      canAbort: opts.canAbort ?? (() => false),
    })
  }

  get config(): GuardConfig {
    return this.cfg
  }

  setMode(mode: GuardMode): void {
    // P0-5: switching standard/strict applies the per-mode preset (a real knob
    // diff), not just the mode string. Reusing updateConfig() rebuilds the
    // dependent detectors so new windows/thresholds take effect immediately.
    const preset = mode === 'off' ? null : MODE_PRESETS[mode]
    if (preset) {
      this.updateConfig({ ...preset, mode })
    } else {
      // off: keep last active parameters, merely disable detection.
      this.cfg = { ...this.cfg, mode }
    }
    if (mode === 'off') this.resetAll()
  }

  /** Merge a config patch, rebuilding dependent detectors when their knobs change. */
  updateConfig(patch: GuardConfigPatch): void {
    const merged: GuardConfig = {
      ...this.cfg,
      ...patch,
      stream: { ...this.cfg.stream, ...patch.stream },
      tool: { ...this.cfg.tool, ...patch.tool },
    }
    this.cfg = merged
    // Rebuild dependent detectors so new windows/thresholds take effect.
    this.thinkingBuffer = new RollingBuffer(merged.stream.windowChars)
    this.textBuffer = new RollingBuffer(merged.stream.windowChars)
    this.toolChain = new ToolChain(merged.tool)
    this.turnLimiter = new TurnLimiter({ maxTurns: merged.maxTurnsPerSession })
    this.thinkingChars = 0
    this.responseChars = 0
  }

  isEnabled(): boolean {
    return this.cfg.mode !== 'off'
  }

  /** Feed a streamed delta. Returns the action the host should take. */
  feed(kind: StreamKind, delta: string): FeedResult {
    if (!this.isEnabled()) return { action: 'none' }
    if (this.ladder.isPaused()) return { action: 'none', reason: this.ladder.pauseReasonText() }

    if (kind === 'thinking') {
      this.thinkingChars += delta.length
      this.pendingThinkingChars += delta.length
      this.thinkingBuffer.append(delta)
      // Length backstop first.
      if (this.thinkingChars > this.cfg.stream.maxThinkingChars) {
        this.stats.pauses += 1
        return this.ladder.signalHardStop(
          'length',
          `思考段超过 ${this.cfg.stream.maxThinkingChars} 字符上限`,
        ).result
      }
      // Throttle the expensive check: run at most every N accumulated chars.
      // The check scans the whole retained buffer, so nothing is missed while
      // throttled — detection is only delayed by at most one throttle window.
      if (this.pendingThinkingChars < CYCLE_CHECK_THROTTLE_CHARS) {
        return { action: 'none' }
      }
      this.pendingThinkingChars = 0
      this.stats.thinkingChecks += 1
      const cycle = detectCycle(this.thinkingBuffer.content, {
        minPatternSize: this.cfg.stream.minPatternSize,
        maxPatternSize: this.cfg.stream.maxPatternSize,
        minCount: this.cfg.stream.minCount,
        normalized: true, // the rolling buffer already normalizes whitespace
      })
      if (cycle.hit) {
        this.stats.thinkingHits += 1
        const d = this.ladder.signalRepetition('thinking', `检测到长度 ${cycle.period} 的重复模式`)
        if (d.result.action === 'retry') this.stats.retries += 1
        if (d.result.action === 'pause') this.stats.pauses += 1
        return { ...d.result, period: cycle.period }
      }
      return { action: 'none' }
    }

    // text
    this.responseChars += delta.length
    this.textBuffer.append(delta)
    if (this.responseChars > this.cfg.stream.maxResponseChars) {
      this.stats.pauses += 1
      return this.ladder.signalHardStop(
        'length',
        `响应超过 ${this.cfg.stream.maxResponseChars} 字符上限`,
      ).result
    }
    return { action: 'none' }
  }

  /** Record one tool call. Returns the action (remind / pause). */
  feedToolCall(tool: string, args: unknown, denied = false): FeedResult {
    if (!this.isEnabled()) return { action: 'none' }
    const r = this.toolChain.record(tool, args, denied)
    if (r.action === 'pause') {
      this.stats.toolRepeatPauses += 1
      this.stats.pauses += 1
      return this.ladder.signalHardStop('tool', r.reminder ?? `工具 ${tool} 连续重复`).result
    }
    if (r.action === 'remind') {
      this.stats.toolRepeatWarns += 1
      return this.ladder.notify(`工具 ${tool} 连续调用 ${r.count} 次`, r.reminder, 'tool').result
    }
    return { action: 'none' }
  }

  /** Record one agent step for the session turn limiter. */
  noteStep(sessionId: string): FeedResult {
    if (!this.isEnabled()) return { action: 'none' }
    const r = this.turnLimiter.noteStep(sessionId)
    if (r.action === 'notify') {
      this.stats.turnReminders += 1
      return this.ladder.notify(`会话超过 ${this.cfg.maxTurnsPerSession} 轮`, r.reminder, 'turn')
        .result
    }
    return { action: 'none' }
  }

  /** Real progress observed → reset cycle/retry state for a family/segment. */
  resetSegment(kind: StreamKind): void {
    if (kind === 'thinking') {
      this.thinkingBuffer.reset()
      this.thinkingChars = 0
      this.pendingThinkingChars = 0
    } else {
      this.textBuffer.reset()
      this.responseChars = 0
    }
    this.ladder.reset(false)
  }

  /** Full reset at a step boundary / new user message: progress resets the retry budget. */
  resetAll(): void {
    this.thinkingBuffer.reset()
    this.textBuffer.reset()
    this.thinkingChars = 0
    this.responseChars = 0
    this.pendingThinkingChars = 0
    this.toolChain.reset()
    this.ladder.reset(true)
  }

  /** Release per-session state (turn counter) when a session ends. */
  resetSession(sessionId: string): void {
    this.turnLimiter.reset(sessionId)
  }

  /**
   * Full teardown (plugin reset / service reset): clears detectors AND every
   * session's turn counters. Deliberately distinct from `resetAll` (step
   * boundary), which must NOT touch turn counters or the limit would never
   * accumulate across steps.
   */
  resetEverything(): void {
    this.resetAll()
    this.turnLimiter.resetAll()
  }

  /** Resume after a user decision. */
  resume(): void {
    this.ladder.resume()
  }

  isPaused(): boolean {
    return this.ladder.isPaused()
  }

  pauseReason(): string | undefined {
    return this.ladder.pauseReasonText()
  }

  turnCount(sessionId: string): number {
    return this.turnLimiter.getTurns(sessionId)
  }
}
