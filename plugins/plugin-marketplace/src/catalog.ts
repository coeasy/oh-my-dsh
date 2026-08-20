/**
 * Unified multi-source catalog layer (P-A).
 *
 * Each data source is a `CatalogAdapter` that scans a remote registry and
 * returns the SAME normalized `RegistryEntry[]`. The catalog service runs all
 * enabled adapters concurrently, merges by repository identity (highest
 * `priority` wins on conflict), and keeps a short-lived local index so search,
 * category filtering and pagination never re-hit the providers.
 *
 * Sources:
 *   - awesome (default): https://awesome-dsh-plugin.com/plugins.json (~1500)
 *   - github:            GitHub Search API topic:dsh-plugin (unauthenticated subset)
 *   - 1024store:         https://deepseek1024.com/api/v1/plugins (paged REST)
 *   - dshfind:           https://api.dshfind.com/v1/plugins (paged REST + data_version)
 *   - builtin:           local curated snapshot (offline fallback)
 *
 * Installs are never done here — the catalog only discovers. Install/remove
 * always go through the official dsh CLI (see install.ts).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RegistryEntry } from './registry.ts'
import { dshHomeOf, isGithubRepo } from './registry.ts'

export interface CatalogAdapter {
  /** Stable adapter id, used in the `?source=` query and the sources API. */
  readonly id: string
  /** Localized-ish display label for the source picker. */
  readonly label: string
  /** Merge priority — lower wins on duplicate full_name. */
  readonly priority: number
  /** Fetch + normalize all entries from this source ([] on any failure). */
  scan(): Promise<RegistryEntry[]>
}

export interface SourceInfo {
  id: string
  label: string
  count: number
  ok: boolean
}

export interface CatalogIndex {
  generated_at: string
  sources: SourceInfo[]
  /** Merged, de-duplicated view (source=all). */
  entries: RegistryEntry[]
  /** Per-source view. */
  bySource: Record<string, RegistryEntry[]>
}

const CACHE_TTL_MS = 5 * 60_000

/** Bound every source to this many entries so the market never floods the UI. */
export const MAX_PER_SOURCE = 100

let cache: { index: CatalogIndex; at: number } | null = null

/* ------------------------------------------------------------------ */
/* data helpers                                                        */
/* ------------------------------------------------------------------ */

/** data/ sits next to the package root; lib/index.js is one level below it. */
function snapshotPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'registry-snapshot.json')
}

function loadBuiltinSnapshot(): RegistryEntry[] {
  try {
    const d = JSON.parse(readFileSync(snapshotPath(), 'utf8')) as {
      repos?: RegistryEntry[]
    }
    return Array.isArray(d.repos) ? d.repos.filter((entry) => isGithubRepo(entry.full_name)) : []
  } catch {
    return []
  }
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function arr(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .map((x) => str(x))
        .filter(Boolean)
        .slice(0, 6)
    : []
}

/* ------------------------------------------------------------------ */
/* adapters                                                            */
/* ------------------------------------------------------------------ */

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const awesomeAdapter: CatalogAdapter = {
  id: 'awesome',
  label: 'Awesome Registry',
  priority: 0,
  async scan() {
    try {
      const d = (await fetchJson('https://awesome-dsh-plugin.com/plugins.json')) as {
        plugins?: Array<Record<string, unknown>>
      }
      const pls = Array.isArray(d.plugins) ? d.plugins : []
      return pls
        .filter(
          (p) =>
            typeof p.owner === 'string' &&
            typeof p.name === 'string' &&
            isGithubRepo(`${p.owner}/${p.name}`),
        )
        .map((p) => {
          const desc = p.description as Record<string, string> | undefined
          const category = str(p.category)
          return {
            name: str(p.name),
            full_name: `${str(p.owner)}/${str(p.name)}`,
            description: str(desc?.zh || desc?.en).slice(0, 200),
            url: str(p.url) || `https://github.com/${str(p.owner)}/${str(p.name)}`,
            stars: num(p.stars),
            updated_at: str(p.added),
            topics: category ? [category] : [],
            license: null,
            pkg_name: str(p.npm) || null,
            market_tags: category ? [category] : [],
          }
        })
    } catch {
      return []
    }
  },
}

const githubAdapter: CatalogAdapter = {
  id: 'github',
  label: 'GitHub 嗅探',
  priority: 3,
  async scan() {
    try {
      // Unauthenticated GitHub Search is rate-limited (~10/min); keep to the
      // first page so the market never trips the quota. The full 6888+ set is
      // covered by the curated awesome source anyway.
      const url =
        'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=stars&order=desc&per_page=100'
      const res = await fetch(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'coeasy-dsh-market' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) return []
      const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
      if (!Array.isArray(body.items)) return []
      return body.items
        .filter((it) => isGithubRepo(str(it.full_name)))
        .map((it) => ({
          name: str(it.name),
          full_name: str(it.full_name),
          description: str(it.description).slice(0, 200),
          url: str(it.html_url) || `https://github.com/${str(it.full_name)}`,
          stars: num(it.stargazers_count),
          updated_at: str(it.updated_at),
          topics: arr(it.topics),
          license:
            it.license && typeof it.license === 'object' && 'spdx_id' in it.license
              ? str((it.license as { spdx_id?: unknown }).spdx_id)
              : null,
          pkg_name: null,
          market_tags: [],
        }))
    } catch {
      return []
    }
  },
}

const store1024Adapter: CatalogAdapter = {
  id: '1024store',
  label: '1024 Store',
  priority: 1,
  async scan() {
    try {
      // Paged REST; keep to a bounded first fetch to avoid pulling 6MB+ of
      // install telemetry on every open.
      const url = 'https://deepseek1024.com/api/v1/plugins?limit=500'
      const d = (await fetchJson(url, 30_000)) as { packages?: Array<Record<string, unknown>> }
      const pkgs = Array.isArray(d.packages) ? d.packages : []
      return pkgs
        .filter(
          (p) =>
            typeof p.owner === 'string' &&
            typeof p.name === 'string' &&
            isGithubRepo(`${p.owner}/${str(p.repository) || str(p.name)}`),
        )
        .map((p) => {
          const desc = p.description as Record<string, string> | undefined
          const category = str(p.category)
          return {
            name: str(p.name),
            full_name: `${str(p.owner)}/${str(p.repository) || str(p.name)}`,
            description: str(desc?.zh || desc?.en).slice(0, 200),
            url:
              str(p.url) ||
              `https://github.com/${str(p.owner)}/${str(p.repository) || str(p.name)}`,
            stars: 0,
            updated_at: str(p.latestInstallAt),
            topics: category ? [category] : [],
            license: null,
            pkg_name: null,
            market_tags: category ? [category] : [],
          }
        })
    } catch {
      return []
    }
  },
}

const dshfindAdapter: CatalogAdapter = {
  id: 'dshfind',
  label: 'DSH Find',
  priority: 2,
  async scan() {
    try {
      const d = (await fetchJson('https://api.dshfind.com/v1/plugins', 30_000)) as {
        data?: Array<Record<string, unknown>>
      }
      const items = Array.isArray(d.data) ? d.data : []
      return items
        .filter((it) => typeof it.full_name === 'string' && isGithubRepo(it.full_name))
        .map((it) => ({
          name: str(it.name) || str(it.full_name).split('/').pop() || '',
          full_name: str(it.full_name),
          description: str(it.description).slice(0, 200),
          url: str(it.url) || `https://github.com/${str(it.full_name)}`,
          stars: num(it.stars),
          updated_at: str(it.pushed_at),
          topics: arr(it.tags),
          license: null,
          pkg_name: null,
          market_tags: [],
        }))
    } catch {
      return []
    }
  },
}

const builtinAdapter: CatalogAdapter = {
  id: 'builtin',
  label: '内置精选',
  priority: -1,
  async scan() {
    return loadBuiltinSnapshot()
  },
}

/** All adapters. `builtin` is the offline fallback merged at lowest priority. */
export const ADAPTERS: CatalogAdapter[] = [
  awesomeAdapter,
  store1024Adapter,
  dshfindAdapter,
  githubAdapter,
  builtinAdapter,
]

/** Merge entries by full_name; lower priority wins. */
function merge(bySource: Record<string, RegistryEntry[]>): RegistryEntry[] {
  const best = new Map<string, RegistryEntry>()
  const prio = new Map<string, number>()
  for (const adapter of ADAPTERS) {
    for (const entry of bySource[adapter.id] ?? []) {
      const key = entry.full_name
      if (!key) continue
      const cur = prio.get(key)
      if (cur === undefined || adapter.priority < cur) {
        prio.set(key, adapter.priority)
        best.set(key, entry)
      }
    }
  }
  return [...best.values()]
}

/** Build a fresh index by scanning every adapter concurrently. */
async function scanAll(): Promise<CatalogIndex> {
  const settled = await Promise.allSettled(ADAPTERS.map((a) => a.scan()))
  const bySource: Record<string, RegistryEntry[]> = {}
  const sources: SourceInfo[] = []
  ADAPTERS.forEach((adapter, i) => {
    const r = settled[i]
    const ok = r.status === 'fulfilled'
    const entries = (ok && r.value.length > 0 ? r.value : []).slice(0, MAX_PER_SOURCE)
    bySource[adapter.id] = entries
    sources.push({ id: adapter.id, label: adapter.label, count: entries.length, ok })
  })
  return {
    generated_at: new Date().toISOString(),
    sources,
    entries: merge(bySource),
    bySource,
  }
}

/**
 * Scan a single adapter (bounded to MAX_PER_SOURCE) without touching the
 * all-source cache. Used by the list API for progressive, per-source loading
 * so the client can show which sources are still coming in. Returns the
 * entries plus that source's metadata (count/ok) for the source picker.
 */
export async function scanSource(id: string): Promise<{
  entries: RegistryEntry[]
  sources: SourceInfo[]
}> {
  const adapter = ADAPTERS.find((a) => a.id === id)
  if (!adapter) return { entries: [], sources: [] }
  try {
    const entries = (await adapter.scan()).slice(0, MAX_PER_SOURCE)
    return {
      entries,
      sources: [{ id: adapter.id, label: adapter.label, count: entries.length, ok: true }],
    }
  } catch {
    return { entries: [], sources: [{ id: adapter.id, label: adapter.label, count: 0, ok: false }] }
  }
}

/**
 * Get the catalog index. Honors the in-memory cache (5 min) unless `force`.
 * On any error (including a fresh cold cache with no network) the builtin
 * snapshot is used so the market is always browsable.
 */
export async function loadCatalog(force = false): Promise<CatalogIndex> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.index
  try {
    const index = await scanAll()
    cache = { index, at: Date.now() }
    return index
  } catch {
    const index = {
      generated_at: new Date().toISOString(),
      sources: ADAPTERS.map((a) => ({ id: a.id, label: a.label, count: 0, ok: false })),
      entries: loadBuiltinSnapshot(),
      bySource: { builtin: loadBuiltinSnapshot() },
    }
    return index
  }
}

/**
 * Directory of the default official profile (kept here for status/detail).
 * Delegates to registry.dshHomeOf so the home resolution stays byte-identical
 * with the official CLI (default ~/.dsh, $DSH_HOME, or an explicit `configured`).
 */
export function profileDirOf(profile: string, configured?: string): string {
  return join(dshHomeOf(configured), 'profiles', profile)
}
