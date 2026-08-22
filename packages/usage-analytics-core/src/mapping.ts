/**
 * Declarative Provider usage mapping engine.
 *
 * Supports a restricted JSONPath subset (no full library, per the plan's
 * security decision): `$.a.b[0].c`, `$..cached_tokens`, `$.a[*].x`.
 * No arbitrary JS is ever executed.
 */

export interface ProviderMapping {
  id: string
  match: {
    base_url_pattern?: string
    model_pattern?: string
  }
  usage: Record<string, string[]>
  streaming: {
    strategy: 'final_usage_preferred'
  }
}

const SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const INDEX_RE = /^\[(\d+)\]$/
const WILD_RE = /^\[\*\]$/

/** Validate a mapping path string; returns true when structurally safe. */
export function isValidPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false
  if (!path.startsWith('$')) return false
  let rest = path.slice(1)
  if (rest === '') return true
  if (!rest.startsWith('.')) return false
  rest = rest.slice(1)
  if (rest === '') return false
  const parts = rest.split('.')
  // first part may be '' when path is "$." — disallow
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p === '') return false
    // token may be a plain segment, or segment followed by [n] / [*]
    let seg = p
    const bracketIdx = seg.indexOf('[')
    if (bracketIdx !== -1) {
      seg = seg.slice(0, bracketIdx)
      const bracketPart = p.slice(bracketIdx)
      if (!INDEX_RE.test(bracketPart) && !WILD_RE.test(bracketPart)) return false
      // only allow a single trailing bracket group for simplicity
      if (p.slice(bracketIdx + 1).includes('[')) return false
    }
    if (!SEGMENT_RE.test(seg)) return false
  }
  return true
}

type WalkResult = unknown

/** Resolve a validated path against a value using the restricted subset. */
export function resolvePath(root: unknown, path: string): WalkResult {
  if (!isValidPath(path)) return undefined
  let cur: unknown = root
  if (path === '$') return cur
  const rest = path.slice(2) // skip "$."
  if (rest === '') return cur
  const tokens = rest.split('.')
  for (const rawTok of tokens) {
    let seg = rawTok
    let bracket: string | null = null
    const bi = rawTok.indexOf('[')
    if (bi !== -1) {
      seg = rawTok.slice(0, bi)
      bracket = rawTok.slice(bi)
    }
    if (seg !== '') {
      if (typeof cur !== 'object' || cur === null) return undefined
      cur = (cur as Record<string, unknown>)[seg]
    }
    if (bracket !== null) {
      if (bracket === '[*]') {
        if (!Array.isArray(cur)) return undefined
        const out: unknown[] = []
        for (const item of cur) {
          const v = resolvePath(item, '$')
          if (v !== undefined) out.push(v)
        }
        return out
      } else {
        const idx = Number(bracket.slice(1, -1))
        if (!Array.isArray(cur)) return undefined
        cur = cur[idx]
      }
    }
  }
  return cur
}

/** Deep-resolve a path that may contain recursive-descent `..`. */
export function resolveRecursive(root: unknown, path: string): unknown {
  if (!path.includes('..')) return resolvePath(root, path)
  // transform "$..field" → walk everything
  const field = path.split('..').pop() ?? ''
  const results: unknown[] = []
  walk(root, field, results)
  return results.length ? results : undefined
}

function walk(node: unknown, field: string, out: unknown[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, field, out)
    return
  }
  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (key === field && typeof obj[key] !== 'object') out.push(obj[key])
      else walk(obj[key], field, out)
    }
  }
}

export interface MappingResult {
  found: Record<string, number>
  missing: string[]
}

/**
 * Apply a mapping config's `usage` candidates against a usage JSON object.
 * First candidate that resolves to a non-negative finite number wins.
 * Fields that resolve to nothing are returned in `missing` (→ unknown).
 */
export function applyUsageMapping(usageJson: unknown, mapping: ProviderMapping): MappingResult {
  const found: Record<string, number> = {}
  const missing: string[] = []
  for (const [field, candidates] of Object.entries(mapping.usage)) {
    let value: number | undefined = undefined
    for (const cand of candidates) {
      const v = cand.includes('..')
        ? resolveRecursive(usageJson, cand)
        : resolvePath(usageJson, cand)
      if (Array.isArray(v)) {
        const first = v.find(
          (x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0,
        )
        if (first !== undefined) {
          value = first
          break
        }
      } else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        value = v
        break
      }
    }
    if (value === undefined) missing.push(field)
    else found[field] = value
  }
  return { found, missing }
}

/** Validate a full mapping config object (declarative-only). */
export function validateMappingConfig(cfg: unknown): string[] {
  const problems: string[] = []
  if (typeof cfg !== 'object' || cfg === null) return ['mapping must be an object']
  const c = cfg as Record<string, unknown>
  if (typeof c.id !== 'string' || c.id.length === 0) problems.push('id required')
  const usage = c.usage
  if (typeof usage !== 'object' || usage === null) {
    problems.push('usage must be an object')
  } else {
    for (const [field, cands] of Object.entries(usage as Record<string, unknown>)) {
      if (!Array.isArray(cands) || cands.length === 0) {
        problems.push(`usage.${field} must be a non-empty array`)
        continue
      }
      for (const p of cands) {
        if (typeof p !== 'string' || !isValidPath(p)) {
          problems.push(`usage.${field} has invalid path: ${String(p)}`)
        }
      }
    }
  }
  // reject executable-ish fields
  for (const bad of ['code', 'js', 'script', 'evaluate', 'fn']) {
    if (bad in c) problems.push(`executable field not allowed: ${bad}`)
  }
  return problems
}
