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
 *   - 1024store:         https://deepseek1024.com/api/v1/plugins (paged REST)
 *   - lwmxiaobei:        https://github.com/lwmxiaobei/dsh-plugins (community
 *                        directory, ~809 curated+validated plugins with stars)
 *   - dshfind:           https://api.dshfind.com/v1/plugins (paged REST + data_version)
 *   - github:            GitHub Search API topic:dsh-plugin (unauthenticated subset)
 *   - builtin:           local curated snapshot (offline fallback)
 *
 * The merged directory (and each per-source list) is presented SORTED BY
 * stars (descending) so the most popular plugins surface first; the builtin
 * snapshot is regenerated at build time with the latest stars (see
 * scripts/build-snapshot.mjs).
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
const FAILURE_CACHE_TTL_MS = 30_000

/** Bound the cached provider index; API pagination keeps this out of the UI. */
export const MAX_PER_SOURCE = 2_000
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

export interface CatalogPage {
  entries: RegistryEntry[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

let cache: { index: CatalogIndex; at: number } | null = null
const sourceCache = new Map<string, { entries: RegistryEntry[]; ok: boolean; at: number }>()

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

/**
 * First-party built-in plugins shipped with the desktop client (see
 * apps/desktop/src/first-party-plugins.ts — model-config / degeneration-guard /
 * usage-analytics). They are exposed in the catalog so the web-side market can
 * recognize and show them (they ARE installed into the web profile by the
 * desktop bootstrap), marked read-only: they are `private` npm packages, not
 * installable from the registry — installs go through the bundled bootstrap.
 *
 * `full_name` uses the FIRST_PARTY_NAMESPACE owner so (a) it passes the
 * `isGithubRepo` gate used by resolveCatalogEntry (installs/detail) and (b) it
 * never collides with a real remote plugin. `pkg_name` carries the true
 * installed package name so isInstalled() matches the profile deps.
 */
export const FIRST_PARTY_NAMESPACE = 'dsh-harness'

export const FIRST_PARTY_CATALOG_ENTRIES: RegistryEntry[] = [
  {
    name: 'plugin-model-config',
    full_name: `${FIRST_PARTY_NAMESPACE}/plugin-model-config`,
    description: '模型配置：分阶段模型路由（默认/规划/子代理/评估）、推理强度与 Profiles。客户端内置。',
    url: 'https://github.com/coeasy/oh-my-dsh/tree/main/plugins/model-config',
    stars: 0,
    updated_at: '',
    topics: ['model', 'config', 'first-party'],
    license: 'MIT',
    pkg_name: '@dsh/plugin-model-config',
    market_tags: ['first-party', 'builtin'],
  },
  {
    name: 'plugin-degeneration-guard',
    full_name: `${FIRST_PARTY_NAMESPACE}/plugin-degeneration-guard`,
    description: '退化防护：n-gram 重复循环/工具重复链/会话轮次限制与升级阶梯。客户端内置。',
    url: 'https://github.com/coeasy/oh-my-dsh/tree/main/plugins/degeneration-guard',
    stars: 0,
    updated_at: '',
    topics: ['guard', 'safety', 'first-party'],
    license: 'MIT',
    pkg_name: '@dsh/plugin-degeneration-guard',
    market_tags: ['first-party', 'builtin'],
  },
  {
    name: 'plugin-usage-analytics',
    full_name: `${FIRST_PARTY_NAMESPACE}/plugin-usage-analytics`,
    description: '用量分析：安全用量观测、归一化、存储与查询 API。客户端内置。',
    url: 'https://github.com/coeasy/oh-my-dsh/tree/main/plugins/usage-analytics',
    stars: 0,
    updated_at: '',
    topics: ['usage', 'analytics', 'first-party'],
    license: 'MIT',
    pkg_name: '@dsh/plugin-usage-analytics',
    market_tags: ['first-party', 'builtin'],
  },
]

/** True for first-party built-in entries (exposed read-only in the market). */
export function isFirstPartyEntry(entry: { full_name?: string }): boolean {
  return String(entry?.full_name ?? '').startsWith(`${FIRST_PARTY_NAMESPACE}/plugin-`)
}

/** Builtin snapshot + the first-party built-in plugins. */
function allBuiltinEntries(): RegistryEntry[] {
  return [...loadBuiltinSnapshot(), ...FIRST_PARTY_CATALOG_ENTRIES]
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
    const d = (await fetchJson('https://awesome-dsh-plugin.com/plugins.json')) as {
      plugins?: Array<Record<string, unknown>>
    }
    if (!Array.isArray(d.plugins)) throw new Error('awesome registry returned no plugins array')
    return d.plugins
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
  },
}

const githubAdapter: CatalogAdapter = {
  id: 'github',
  label: 'GitHub 嗅探',
  priority: 3,
  async scan() {
    // Unauthenticated GitHub Search is rate-limited (~10/min); keep to the
    // first page. The curated sources provide the larger searchable index.
    const url =
      'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=stars&order=desc&per_page=100'
    const res = await fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'coeasy-dsh-market' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`GitHub search returned HTTP ${res.status}`)
    const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
    if (!Array.isArray(body.items)) throw new Error('GitHub search returned no items array')
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
  },
}

const store1024Adapter: CatalogAdapter = {
  id: '1024store',
  label: '1024 Store',
  priority: 1,
  async scan() {
    // Keep to a bounded first fetch to avoid pulling install telemetry on open.
    const url = 'https://deepseek1024.com/api/v1/plugins?limit=500'
    const d = (await fetchJson(url, 30_000)) as { packages?: Array<Record<string, unknown>> }
    if (!Array.isArray(d.packages)) throw new Error('1024 Store returned no packages array')
    return d.packages
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
            str(p.url) || `https://github.com/${str(p.owner)}/${str(p.repository) || str(p.name)}`,
          stars: 0,
          updated_at: str(p.latestInstallAt),
          topics: category ? [category] : [],
          license: null,
          pkg_name: null,
          market_tags: category ? [category] : [],
        }
      })
  },
}

const lwmxiaobeiAdapter: CatalogAdapter = {
  id: 'lwmxiaobei',
  label: 'DSH 社区目录',
  priority: 1,
  async scan() {
    // Community directory: automated discovery + basic bundle validation,
    // bilingual descriptions, stars, license and latest-version install specs.
    const d = (await fetchJson(
      'https://raw.githubusercontent.com/lwmxiaobei/dsh-plugins/main/catalog/plugins.json',
      30_000,
    )) as { plugins?: Array<Record<string, unknown>> }
    if (!Array.isArray(d.plugins)) throw new Error('lwmxiaobei catalog returned no plugins array')
    return d.plugins
      .filter((p) => typeof p.repository === 'string' && isGithubRepo(p.repository))
      .map((p) => {
        const pkg = p.package as { name?: unknown } | undefined
        return {
          name: str(p.repository).split('/').pop() || '',
          full_name: str(p.repository),
          description: str(p.description).slice(0, 200),
          url: str(p.url) || `https://github.com/${str(p.repository)}`,
          stars: num(p.stars),
          updated_at: str(p.pushedAt) || str(p.updatedAt),
          topics: [],
          license: str(p.license) || null,
          pkg_name: pkg && typeof pkg.name === 'string' ? pkg.name : null,
          market_tags: [],
        }
      })
  },
}

const dshfindAdapter: CatalogAdapter = {
  id: 'dshfind',
  label: 'DSH Find',
  priority: 2,
  async scan() {
    const d = (await fetchJson('https://api.dshfind.com/v1/plugins', 30_000)) as {
      data?: Array<Record<string, unknown>>
    }
    if (!Array.isArray(d.data)) throw new Error('DSH Find returned no data array')
    return d.data
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
  },
}

const builtinAdapter: CatalogAdapter = {
  id: 'builtin',
  label: '内置精选',
  priority: -1,
  async scan() {
    return allBuiltinEntries()
  },
}

/** All adapters. `builtin` is the offline fallback merged at lowest priority. */
export const ADAPTERS: CatalogAdapter[] = [
  awesomeAdapter,
  store1024Adapter,
  lwmxiaobeiAdapter,
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

/**
 * Present the directory sorted by stars (descending) so the hottest plugins
 * surface first. Missing stars sort last; ties keep insertion order (stable).
 */
export function sortByStars(entries: RegistryEntry[]): RegistryEntry[] {
  return [...entries].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
}

async function cachedSource(
  adapter: CatalogAdapter,
  force = false,
): Promise<{ entries: RegistryEntry[]; ok: boolean }> {
  const cached = sourceCache.get(adapter.id)
  const ttl = cached?.ok ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS
  if (!force && cached && Date.now() - cached.at < ttl) {
    return { entries: cached.entries, ok: cached.ok }
  }
  try {
    const all = await adapter.scan()
    // First-party built-ins must never be dropped by the MAX_PER_SOURCE cap:
    // the curated snapshot is far larger than the cap, and first-party entries
    // (stars: 0) would otherwise sort to the tail and get sliced away.
    const entries =
      adapter.id === 'builtin'
        ? [
            ...all.filter((entry) => isFirstPartyEntry(entry)),
            ...all.filter((entry) => !isFirstPartyEntry(entry)).slice(0, MAX_PER_SOURCE),
          ]
        : all.slice(0, MAX_PER_SOURCE)
    sourceCache.set(adapter.id, { entries, ok: true, at: Date.now() })
    return { entries, ok: true }
  } catch {
    const entries = cached?.entries ?? []
    sourceCache.set(adapter.id, { entries, ok: false, at: Date.now() })
    return { entries, ok: false }
  }
}

/** Build an index by scanning every adapter concurrently. */
async function scanAll(force = false): Promise<CatalogIndex> {
  const settled = await Promise.all(ADAPTERS.map((a) => cachedSource(a, force)))
  const bySource: Record<string, RegistryEntry[]> = {}
  const sources: SourceInfo[] = []
  ADAPTERS.forEach((adapter, i) => {
    const r = settled[i]
    const entries = r.entries
    bySource[adapter.id] = entries
    sources.push({ id: adapter.id, label: adapter.label, count: entries.length, ok: r.ok })
  })
  return {
    generated_at: new Date().toISOString(),
    sources,
    entries: sortByStars(merge(bySource)),
    bySource,
  }
}

/**
 * Scan a single adapter (bounded to MAX_PER_SOURCE) without touching the
 * all-source cache. Used by the list API for progressive, per-source loading
 * so the client can show which sources are still coming in. Returns the
 * entries plus that source's metadata (count/ok) for the source picker.
 */
export async function scanSource(
  id: string,
  force = false,
): Promise<{
  entries: RegistryEntry[]
  sources: SourceInfo[]
}> {
  const adapter = ADAPTERS.find((a) => a.id === id)
  if (!adapter) return { entries: [], sources: [] }
  const result = await cachedSource(adapter, force)
  return {
    entries: sortByStars(result.entries),
    sources: [
      {
        id: adapter.id,
        label: adapter.label,
        count: result.entries.length,
        ok: result.ok,
      },
    ],
  }
}

/** Filter first, then paginate, so search covers the full cached catalog. */
export function paginateCatalog(
  entries: RegistryEntry[],
  options: { page?: number; pageSize?: number; query?: string } = {},
): CatalogPage {
  const page = Math.max(1, Math.trunc(options.page ?? 1) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(options.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
  )
  const query = String(options.query ?? '')
    .trim()
    .toLowerCase()
  const filtered = query
    ? entries.filter((entry) => {
        const haystack = [
          entry.name,
          entry.full_name,
          entry.description,
          entry.pkg_name,
          ...(entry.topics ?? []),
          ...(entry.market_tags ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(query)
      })
    : entries
  const start = (page - 1) * pageSize
  return {
    entries: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total: filtered.length,
    hasMore: start + pageSize < filtered.length,
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
    const index = await scanAll(force)
    cache = { index, at: Date.now() }
    return index
  } catch {
    const index = {
      generated_at: new Date().toISOString(),
      sources: ADAPTERS.map((a) => ({ id: a.id, label: a.label, count: 0, ok: false })),
      entries: allBuiltinEntries(),
      bySource: { builtin: allBuiltinEntries() },
    }
    return index
  }
}

/** Resolve an install target only from the server-owned catalog index. */
export async function resolveCatalogEntry(
  fullName: string,
  force = false,
): Promise<RegistryEntry | undefined> {
  if (!isGithubRepo(fullName)) return undefined
  const index = await loadCatalog(force)
  return index.entries.find((entry) => entry.full_name === fullName)
}

/**
 * Directory of the default official profile (kept here for status/detail).
 * Delegates to registry.dshHomeOf so the home resolution stays byte-identical
 * with the official CLI (default ~/.dsh, $DSH_HOME, or an explicit `configured`).
 */
export function profileDirOf(profile: string, configured?: string): string {
  return join(dshHomeOf(configured), 'profiles', profile)
}
