/**
 * Build-time snapshot refresh for the marketplace's OFFLINE catalog
 * (data/registry-snapshot.json). Runs on every `pnpm run build`.
 *
 * Pulls the LATEST data from every configured source, merges by repository
 * identity (same priority rules as src/catalog.ts: lower wins on conflict),
 * SORTS by stars (descending) so the builtin directory presents the hottest
 * plugins first, and writes a fresh snapshot. Any failing source is skipped;
 * if every live source fails the existing snapshot is kept untouched so a
 * network blip never bricks the offline catalog.
 *
 * This is the "每次构建都按照最新的市场星数排序展示" half: the builtin
 * snapshot always reflects the newest star counts at build time, and the
 * runtime catalog sorts every list by stars too.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const snapshotPath = join(root, 'data', 'registry-snapshot.json')
const MAX_PER_SOURCE = 2000

/* ---- fetch helpers (bounded, best-effort) ---- */
async function fetchJson(url, timeoutMs = 30_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const str = (v) => (v === null || v === undefined ? '' : String(v))
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/* ---- sources (mirrors src/catalog.ts normalization) ---- */
const sources = [
  {
    id: 'awesome',
    priority: 0,
    async scan() {
      const d = await fetchJson('https://awesome-dsh-plugin.com/plugins.json')
      if (!Array.isArray(d.plugins)) throw new Error('no plugins array')
      return d.plugins
        .filter((p) => typeof p.owner === 'string' && typeof p.name === 'string')
        .map((p) => {
          const desc = p.description
          const category = str(p.category)
          return {
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
  },
  {
    id: '1024store',
    priority: 1,
    async scan() {
      const d = await fetchJson('https://deepseek1024.com/api/v1/plugins?limit=500', 30_000)
      if (!Array.isArray(d.packages)) throw new Error('no packages array')
      return d.packages
        .filter((p) => typeof p.owner === 'string' && typeof p.name === 'string')
        .map((p) => {
          const desc = p.description
          const category = str(p.category)
          return {
            full_name: `${str(p.owner)}/${str(p.repository) || str(p.name)}`,
            description: str(desc?.zh || desc?.en).slice(0, 200),
            url: str(p.url) || `https://github.com/${str(p.owner)}/${str(p.repository) || str(p.name)}`,
            stars: 0,
            updated_at: str(p.latestInstallAt),
            topics: category ? [category] : [],
            license: null,
            pkg_name: null,
            market_tags: category ? [category] : [],
          }
        })
    },
  },
  {
    id: 'lwmxiaobei',
    priority: 1,
    async scan() {
      const d = await fetchJson(
        'https://raw.githubusercontent.com/lwmxiaobei/dsh-plugins/main/catalog/plugins.json',
        30_000,
      )
      if (!Array.isArray(d.plugins)) throw new Error('no plugins array')
      return d.plugins
        .filter((p) => typeof p.repository === 'string')
        .map((p) => {
          const pkg = p.package
          return {
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
  },
  {
    id: 'dshfind',
    priority: 2,
    async scan() {
      const d = await fetchJson('https://api.dshfind.com/v1/plugins', 30_000)
      if (!Array.isArray(d.data)) throw new Error('no data array')
      return d.data
        .filter((it) => typeof it.full_name === 'string')
        .map((it) => ({
          full_name: str(it.full_name),
          description: str(it.description).slice(0, 200),
          url: str(it.url) || `https://github.com/${str(it.full_name)}`,
          stars: num(it.stars),
          updated_at: str(it.pushed_at),
          topics: Array.isArray(it.tags) ? it.tags.map(str).filter(Boolean).slice(0, 6) : [],
          license: null,
          pkg_name: null,
          market_tags: [],
        }))
    },
  },
]

/* ---- existing snapshot as lowest-priority fallback (builtin) ---- */
function loadBuiltin() {
  try {
    const d = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    return Array.isArray(d.repos) ? d.repos : []
  } catch {
    return []
  }
}

/* Mirror src/catalog.ts isGithubRepo: reject sub-path repos (`#`) and the
 * harness engine itself (not a plugin). Keeps the snapshot aligned with the
 * runtime catalog's filter so the offline fallback never shows odd entries. */
function isGithubRepo(fullName) {
  if (typeof fullName !== 'string') return false
  if (fullName.includes('#')) return false
  if (fullName.toLowerCase() === 'deepseek-ai/deepseek-harness') return false
  return /^[^\s/]+\/[^\s/]+$/u.test(fullName)
}

function filterRepo(entry) {
  return isGithubRepo(entry?.full_name)
}

/* ---- merge + sort (mirrors catalog.ts merge + sortByStars) ---- */
function merge(bySource) {
  const best = new Map()
  const prio = new Map()
  for (const source of sources) {
    for (const entry of bySource[source.id] ?? []) {
      const key = entry.full_name
      if (!key) continue
      const cur = prio.get(key)
      if (cur === undefined || source.priority < cur) {
        prio.set(key, source.priority)
        best.set(key, entry)
      }
    }
  }
  // builtin: lowest priority — only fills repos no live source reported.
  for (const entry of bySource.builtin ?? []) {
    const key = entry.full_name
    if (!key) continue
    if (!prio.has(key)) {
      prio.set(key, 99)
      best.set(key, entry)
    }
  }
  return [...best.values()]
}

function sortByStars(entries) {
  return [...entries].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
}

/* ---- main ---- */
const settled = await Promise.all(
  sources.map((s) =>
    s
      .scan()
      .then((entries) => ({
        id: s.id,
        entries: entries.filter(filterRepo).slice(0, MAX_PER_SOURCE),
        ok: true,
      }))
      .catch(() => ({ id: s.id, entries: [], ok: false })),
  ),
)
const bySource = {}
for (const r of settled) bySource[r.id] = r.entries
bySource.builtin = loadBuiltin().filter(filterRepo)

const liveOk = settled.filter((r) => r.ok)
if (liveOk.length === 0) {
  console.log('snapshot refresh skipped: all live sources failed, keeping existing snapshot')
  process.exit(0)
}

const repos = sortByStars(merge(bySource))
const snapshot = {
  generated_at: new Date().toISOString(),
  count: repos.length,
  source: 'build-merge',
  repos,
}
writeFileSync(snapshotPath, `${JSON.stringify(snapshot, undefined, 2)}\n`)
console.log(
  `snapshot refreshed: ${repos.length} plugins (${liveOk.length}/${sources.length} sources ok), sorted by stars`,
)
