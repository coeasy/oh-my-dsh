/**
 * Shared type surface for the degeneration-guard plugin.
 *
 * Pure types only. The plugin detects two loop families:
 *   - thinking-stream repetition (n-gram cycle detection on streamed deltas)
 *   - tool-call repetition (consecutive identical tool+args, advisory + hard stop)
 * plus two hard backstops: thinking-segment length and per-session turn count.
 */

/** Plugin operation mode (plan §12.4). */
export type GuardMode = 'off' | 'standard' | 'strict'

/** The kind of stream being fed into the detector. */
export type StreamKind = 'thinking' | 'text'

/** Tool-chain configuration (mirrors the engine repeat-tool-reminder semantics). */
export interface ToolChainConfig {
  /** Consecutive-repeat counts that trigger an advisory reminder (default [3,5,8]). */
  thresholds: number[]
  /** Consecutive repeats that trigger a hard pause (0 = advisory only). */
  hardStop: number
  /** Tool-name `*`-wildcard patterns to track; empty = every tool is tracked. */
  include: string[]
  /** Tool-name `*`-wildcard patterns transparent to the chain (neither count nor reset). */
  exclude: string[]
  /** Max characters of canonical arguments quoted in the detailed reminder. */
  argumentsPreviewChars: number
}

/** Stream-detection configuration (plan §12.2 平面 B, vLLM RepetitionDetectionParams semantics). */
export interface StreamConfig {
  /** Minimum pattern size in normalized chars. */
  minPatternSize: number
  /** Maximum pattern size in normalized chars. */
  maxPatternSize: number
  /** Consecutive complete periods required beyond the first occurrence. */
  minCount: number
  /** Bounded rolling window (normalized chars). */
  windowChars: number
  /** Max chars in a single thinking segment before escalation. */
  maxThinkingChars: number
  /** Max chars in a single response before escalation (length backstop, not repetition). */
  maxResponseChars: number
}

/** Full plugin configuration. */
export interface GuardConfig {
  mode: GuardMode
  autoRetry: boolean
  tool: ToolChainConfig
  stream: StreamConfig
  /** Per-session agent-step cap; triggers a reminder, never a hard stop (Q3 decided). */
  maxTurnsPerSession: number
}

/** Deep-partial patch accepted by updateConfig / plugin options. */
export interface GuardConfigPatch {
  mode?: GuardMode
  autoRetry?: boolean
  tool?: Partial<ToolChainConfig>
  stream?: Partial<StreamConfig>
  maxTurnsPerSession?: number
}

/** Result of one `feed` call: what the caller should do next. */
export interface FeedResult {
  /** No action needed. */
  action: 'none' | 'notify' | 'retry' | 'pause'
  /** Human-readable reason for diagnostics / UI. */
  reason?: string
  /** Advisory reminder text the host may inject (tool-repeat / turn-limit). */
  reminder?: string
  /** Detected period length (chars) when a cycle was found. */
  period?: number
  /** Which guard family fired. */
  family?: 'thinking' | 'tool' | 'turn' | 'length'
}

/** A state change the service exposes to host subscribers. */
export interface GuardEvent {
  kind:
    | 'mode_changed'
    | 'repetition_detected'
    | 'thinking_segment_too_long'
    | 'response_too_long'
    | 'tool_repeat_reminder'
    | 'tool_repeat_pause'
    | 'turn_limit_reminder'
    | 'auto_retry'
    | 'paused'
  sessionId?: string
  detail?: string
}

/** Service status for UI / diagnostics. */
export interface GuardStatus {
  mode: GuardMode
  ready: boolean
  host: {
    stream: boolean
    interrupt: boolean
  }
  stats: {
    thinkingChecks: number
    thinkingHits: number
    retries: number
    pauses: number
    toolRepeatWarns: number
    toolRepeatPauses: number
    turnReminders: number
  }
  active: {
    paused: boolean
    pauseReason?: string
  }
}

/** Seam the host must implement to interrupt an in-flight request (AbortSignal). */
export interface InterruptSeam {
  /** Abort the current request. Returns when the abort is captured. */
  abort(reason: string): Promise<void>
  /** True while a request is running and can be interrupted. */
  canAbort(): boolean
}

/** Seam the host uses to inject an advisory reminder into the next model request. */
export interface ReminderSeam {
  /** Attach reminder context to the pending request. */
  inject(text: string): void
}

/** All host seams the guard plugin accepts (each optional → graceful degradation). */
export interface GuardHost {
  interrupt?: InterruptSeam
  reminder?: ReminderSeam
}

/** Options passed to the Cordis plugin apply(). */
export interface GuardOptions {
  config?: GuardConfigPatch
  host?: GuardHost
  /** Force a known mode (tests). */
  forceMode?: GuardMode
  /** Engine loopback web server (optional); enables the desktop HTTP API. */
  engine?: { webServer?: import('./engine-http.ts').WebServerLike }
}

/** Context surface used by the plugin (host adapters provide it). */
export interface GuardContext {
  on?(event: string, listener: (...args: never[]) => void): void
  emit?(event: string, payload: unknown): void
}

export const DEFAULT_TOOL_CHAIN: ToolChainConfig = {
  thresholds: [3, 5, 8],
  hardStop: 12,
  include: [],
  exclude: [],
  argumentsPreviewChars: 500,
}

export const DEFAULT_STREAM: StreamConfig = {
  minPatternSize: 24,
  maxPatternSize: 1024,
  minCount: 3,
  windowChars: 16384,
  maxThinkingChars: 65536,
  maxResponseChars: 262144,
}

export const DEFAULT_CONFIG: GuardConfig = {
  mode: 'standard',
  autoRetry: true,
  tool: DEFAULT_TOOL_CHAIN,
  stream: DEFAULT_STREAM,
  maxTurnsPerSession: 30,
}

/**
 * Per-mode detection presets (P0-5): switching `standard`/`strict` now applies
 * a REAL knob diff instead of only changing the mode string. `strict` tightens
 * every detection family — shorter patterns, earlier repeat count, halved
 * length backstops, more sensitive tool hard-stop, earlier turn reminder.
 *
 * `off` has no preset: it simply disables detection (isEnabled() → false) and
 * retains the last active parameters so re-enabling is non-destructive.
 */
export const MODE_PRESETS: Record<Exclude<GuardMode, 'off'>, GuardConfigPatch> = {
  standard: {
    // Balanced default — matches DEFAULT_CONFIG, tuned for low false-positive
    // rates in everyday multi-agent use.
    autoRetry: true,
    stream: {
      minPatternSize: 24,
      maxPatternSize: 1024,
      minCount: 3,
      windowChars: 16384,
      maxThinkingChars: 65536,
      maxResponseChars: 262144,
    },
    tool: { hardStop: 12 },
    maxTurnsPerSession: 30,
  },
  strict: {
    // Aggressive — shorter thresholds, earlier interception, higher sensitivity
    // (and thus more likely to false-positive on long, repetitive-but-valid
    // reasoning).
    autoRetry: true,
    stream: {
      minPatternSize: 16,
      maxPatternSize: 1024,
      minCount: 2,
      windowChars: 16384,
      maxThinkingChars: 32768,
      maxResponseChars: 131072,
    },
    tool: { hardStop: 8 },
    maxTurnsPerSession: 20,
  },
}
