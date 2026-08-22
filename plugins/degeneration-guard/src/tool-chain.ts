/**
 * Tool-call repeat chain (plan §12.2 平面 A).
 *
 * Tracks consecutive identical calls (canonical args) per agent. Semantics
 * mirror the engine's repeat-tool-reminder: the chain key is `(tool, canonical
 * args)` with deep-key-sorted JSON canonicalization; excluded tools are
 * transparent to the chain (neither count nor reset); denied calls still
 * count (hammering a denied call is exactly the loop worth breaking).
 */

export interface ToolChainOptions {
  thresholds: number[]
  include: string[]
  exclude: string[]
  argumentsPreviewChars: number
  hardStop: number
}

export interface ToolChainResult {
  action: 'none' | 'remind' | 'pause'
  threshold?: number
  count: number
  reminder?: string
}

/** Canonicalize arguments: deep key-sort then JSON.stringify. */
export function canonicalizeArgs(args: unknown): string {
  if (args === undefined || args === null) return 'null'
  return JSON.stringify(sortDeep(args))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

export class ToolChain {
  private readonly opts: ToolChainOptions
  private previousKey: string | null = null
  private count = 0

  constructor(opts: ToolChainOptions) {
    if (opts.thresholds.length === 0) throw new Error('thresholds must be non-empty')
    for (const t of opts.thresholds) {
      if (!Number.isInteger(t) || t < 2) throw new Error('thresholds must be integers >= 2')
    }
    this.opts = { ...opts, thresholds: [...opts.thresholds].sort((a, b) => a - b) }
  }

  private matches(pattern: string, tool: string): boolean {
    if (pattern === '*') return true
    if (pattern.includes('*')) {
      const re = new RegExp(
        `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      )
      return re.test(tool)
    }
    return pattern === tool
  }

  /** Record one tool call; returns the ladder signal the guard should take. */
  record(tool: string, args: unknown, denied = false): ToolChainResult {
    // Untracked calls are transparent to the chain: they neither increment nor
    // reset the counter (mirrors the engine repeat-tool-reminder semantics, so
    // bookkeeping tools interleaved into a loop cannot launder it).
    if (
      !denied &&
      this.opts.include.length > 0 &&
      !this.opts.include.some((p) => this.matches(p, tool))
    ) {
      return { action: 'none', count: this.count }
    }
    if (this.opts.exclude.some((p) => this.matches(p, tool))) {
      return { action: 'none', count: this.count }
    }
    const key = `${tool}\u0000${canonicalizeArgs(args)}`
    if (key === this.previousKey) {
      this.count += 1
    } else {
      this.previousKey = key
      this.count = 1
      return { action: 'none', count: 1 }
    }
    // Check hard stop first.
    if (this.opts.hardStop > 0 && this.count >= this.opts.hardStop) {
      return {
        action: 'pause',
        count: this.count,
        reminder: `工具 ${tool} 已连续以相同参数调用 ${this.count} 次。疑似陷入循环，已暂停。`,
      }
    }
    const threshold = this.opts.thresholds.find((t) => t === this.count)
    if (threshold !== undefined) {
      const preview = canonicalizeArgs(args).slice(0, this.opts.argumentsPreviewChars)
      return {
        action: 'remind',
        threshold,
        count: this.count,
        reminder: `你已连续 ${this.count} 次以相同参数调用 ${tool}。请停止重复，重新阅读上次结果，改变方法或直接结束。参数预览：${preview}`,
      }
    }
    return { action: 'none', count: this.count }
  }

  get currentCount(): number {
    return this.count
  }

  /** Reset the chain (new user message / step boundary). */
  reset(): void {
    this.previousKey = null
    this.count = 0
  }
}
