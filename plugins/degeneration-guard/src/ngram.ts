/**
 * n-gram cycle detection (plan §12.2 平面 B, vLLM RepetitionDetectionParams).
 *
 * Detects a period L in [minPatternSize, maxPatternSize] such that the tail of
 * the stream contains `minCount` consecutive complete copies of the same block
 * (i.e. minCount+1 identical blocks in a row). Semantics: a block of length L
 * repeated minCount extra times = a degenerate loop.
 *
 * Algorithm note: candidates are pre-filtered by "does the last block equal the
 * one before it?" — a single slice compare that exits on the first differing
 * char. For ordinary text this is ~O(1) per candidate; only a genuine cycle
 * pays the full multi-block verification, so per-delta cost stays bounded.
 */

import { normalizeText } from './buffer.ts'

export interface CycleDetectionResult {
  /** True when a cycle was found. */
  hit: boolean
  /** Detected period length (normalized chars). */
  period: number
  /** Full period text (first block), for diagnostics. */
  block?: string
}

export interface CycleDetectorOptions {
  minPatternSize: number
  maxPatternSize: number
  minCount: number
  /** True when the input is already whitespace-normalized (avoids a second pass). */
  normalized?: boolean
}

export function detectCycle(input: string, opts: CycleDetectorOptions): CycleDetectionResult {
  const { minPatternSize, maxPatternSize, minCount } = opts
  if (!Number.isInteger(minCount) || minCount < 1) throw new Error('minCount must be >= 1')
  if (minPatternSize < 1 || maxPatternSize < minPatternSize)
    throw new Error('invalid pattern size bounds')

  // Required blocks: minCount+1 (first occurrence plus minCount repeats).
  const blocks = minCount + 1
  if (input.length < blocks * minPatternSize) return { hit: false, period: 0 }

  // The rolling buffer already normalizes whitespace; skipping the second pass
  // keeps the hot path cheap for high-frequency stream deltas.
  const text = opts.normalized ? input : normalizeText(input)
  if (text.length < blocks * minPatternSize) return { hit: false, period: 0 }

  const maxL = Math.min(maxPatternSize, Math.floor(text.length / blocks))

  for (let L = minPatternSize; L <= maxL; L++) {
    // Pre-filter: last block equals the block before it.
    const a = text.slice(-L)
    const b = text.slice(-2 * L, -L)
    if (a !== b) continue
    // Verify the remaining blocks up the tail are identical to a.
    let ok = true
    for (let i = 2; i < blocks; i++) {
      const block = text.slice(-(i + 1) * L, -i * L)
      if (block !== a) {
        ok = false
        break
      }
    }
    if (ok) return { hit: true, period: L, block: a.slice(0, 80) }
  }
  return { hit: false, period: 0 }
}

/** Convenience: does the text contain a cycle? */
export function hasCycle(input: string, opts: CycleDetectorOptions): boolean {
  return detectCycle(input, opts).hit
}
