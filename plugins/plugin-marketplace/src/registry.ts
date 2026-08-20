/**
 * Registry layer: built-in snapshot (offline, instant, zero rate limits) +
 * on-demand refresh from the GitHub Search API (topic:dsh-plugin).
 * Read-only against official state — installed detection reads the real
 * profile manifest, never a private list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type PluginType = 'cordis' | 'skill' | 'preset' | 'unknown'

export interface RegistryEntry {
  name: string
  full_name: string
  description: string
  url: string
  stars: number
  updated_at: string
  topics: string[]
  license: string | null
  pkg_name: string | null
  market_tags: string[]
}

export interface RegistryData {
  generated_at: string
  count: number
  source: string
  repos: RegistryEntry[]
}

/** data/ sits next to the package root; lib/index.js is one level below it. */
function snapshotPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'registry-snapshot.json')
}

/** Load the snapshot bundled with this package (data/registry-snapshot.json). */
export function loadSnapshot(): RegistryData {
  try {
    return JSON.parse(readFileSync(snapshotPath(), 'utf8')) as RegistryData
  } catch {
    return { generated_at: '', count: 0, source: 'builtin', repos: [] }
  }
}

/** Curated whitelist (quality signal): repos here get a "Curated" badge. */
export const CURATED: ReadonlySet<string> = new Set([
  'dsh-market/dsh-market',
  'bradeGithub/DSH-Plugins-Marketplace',
  'Noob-stupid/dsh-plugin-hub',
  'liustack/modlens',
  'dataelement/dsh-desktop',
  'hairyf/deepseek-harness-desktop',
  'awesome-dsh-plugin/awesome-dsh-plugin',
])

/** Adaptor redirects: broken/ambiguous entries → the real plugin repo. */
export const REDIRECTS: ReadonlyMap<string, string> = new Map([
  // Example from the reference adaptor: a repo whose plugin lives in a sub-repo.
  // ['yejiming/MuseAI', 'yejiming/dsh-museai-tavern'],
])

/** Repo names that are never plugins. */
export const EXCLUDED: ReadonlySet<string> = new Set(['deepseek-ai/deepseek-harness'])

/** 12 rough category chips derived from tags/description. */
const CATEGORY_RULES: Array<[string, string[]]> = [
  ['视觉多模态', ['vision', 'image', 'ocr', 'multimodal', 'visual']],
  ['文档办公', ['doc', 'office', 'pdf', 'document', 'word', 'excel']],
  ['记忆知识', ['memory', 'knowledge', 'rag', 'recall']],
  ['模型用量', ['token', 'usage', 'quota', 'billing']],
  ['通知通讯', ['notify', 'notification', 'telegram', 'slack', 'email', 'sms']],
  ['开发编码', ['dev', 'coding', 'code', 'vscode', 'ide', 'debug']],
  ['对话会话', ['chat', 'conversation', 'session', 'message']],
  ['界面美化', ['theme', 'ui', 'skin', 'style', 'beauty']],
  ['Agent 自动化', ['agent', 'automation', 'workflow', 'autopilot']],
  ['通用工具', ['tool', 'utils', 'utility', 'helper']],
  ['聚合资源', ['aggregate', 'hub', 'collection', 'index']],
]
export const CATEGORIES: string[] = ['全部', ...CATEGORY_RULES.map(([c]) => c), '其他']

/** Only accept GitHub owner/repository identifiers from remote catalogs. */
export function isGithubRepo(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(
    String(value || ''),
  )
}

/** Profile names become directory names under the DSH home. */
export function isSafeProfileName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(String(value || ''))
}

/** Catalog URLs are untrusted remote metadata; only HTTPS links reach the UI. */
export function safeExternalUrl(value: string, fallback: string): string {
  try {
    const parsed = new URL(String(value || ''))
    return parsed.protocol === 'https:' ? parsed.href : fallback
  } catch {
    return fallback
  }
}

export function classify(entry: RegistryEntry): string {
  const text =
    `${entry.description} ${(entry.topics ?? []).join(' ')} ${(entry.market_tags ?? []).join(' ')}`.toLowerCase()
  for (const [cat, keys] of CATEGORY_RULES) {
    if (keys.some((k) => text.includes(k))) return cat
  }
  return '其他'
}

/** Best-effort type guess from snapshot fields; authoritative type is decided at install time. */
export function detectType(entry: RegistryEntry): PluginType {
  if (entry.pkg_name && entry.pkg_name !== '') return 'cordis'
  const text = `${entry.name} ${entry.description} ${(entry.topics ?? []).join(' ')}`.toLowerCase()
  if (text.includes('skill')) return 'skill'
  if (text.includes('preset') || text.includes('agent')) return 'preset'
  return 'unknown'
}

/**
 * Expand supported tilde prefixes against the OS home — mirrors
 * @deepseek-ai/dsh-home-paths expandHomePath (official source of truth).
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the DeepSeek Harness home, following the EXACT precedence of the
 * official @deepseek-ai/dsh-home-paths `resolveDshHome`:
 *   1. an explicit configured path (highest), e.g. ~/.my_dsh
 *   2. $DSH_HOME (blank/whitespace treated as unset)
 *   3. ~/.dsh (default)
 * Keeping this identical to what the official CLI resolves means installs
 * (CLI writes there) and installed-state reads (here) always agree — reading
 * a different home is what made installed plugins keep showing "installable".
 */
export function dshHomeOf(configured?: string): string {
  const fromEnv = process.env.DSH_HOME
  const selected =
    configured ??
    (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh'))
  return resolve(expandHomePath(selected))
}

/**
 * Official profile directory for a given profile name, under the resolved
 * harness home (default ~/.dsh, overridable via $DSH_HOME or `configured`).
 */
export function profileDirOf(profile: string, configured?: string): string {
  if (!isSafeProfileName(profile)) {
    throw new Error(`invalid profile name: ${profile}`)
  }
  const root = dshHomeOf(configured)
  const dir = resolve(root, 'profiles', profile)
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (!dir.startsWith(prefix)) {
    throw new Error(`profile path escapes DSH home: ${profile}`)
  }
  return dir
}

export interface OfficialState {
  dependencies: string[]
  bundles: string[]
}

/**
 * Read the OFFICIAL installed state — profile package.json dependencies +
 * dsh.profile.bundles — never a private manifest. Missing profile → empty.
 * `home` pins the harness home (default ~/.dsh, else $DSH_HOME / configured).
 */
export function readOfficialState(profile: string, home?: string): OfficialState {
  const manifest = join(profileDirOf(profile, home), 'package.json')
  if (!existsSync(manifest)) return { dependencies: [], bundles: [] }
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    return {
      dependencies: Object.keys(pkg.dependencies ?? {}),
      bundles: pkg.dsh?.profile?.bundles ?? [],
    }
  } catch {
    return { dependencies: [], bundles: [] }
  }
}

/**
 * Installed detection against the official dependency list: an npm-published
 * plugin matches by pkg_name; a git-only plugin matches by repository name
 * (pnpm resolves git specs to their true package name).
 */
export function isInstalled(entry: RegistryEntry, state: OfficialState): boolean {
  const candidates = new Set<string>()
  if (entry.pkg_name) candidates.add(entry.pkg_name)
  candidates.add(entry.name)
  return state.dependencies.some((dep) => candidates.has(dep))
}

/**
 * Refresh from the GitHub Search API (topic:dsh-plugin), best-effort:
 * on any failure the snapshot stays authoritative. ~10 req/min unauthenticated.
 */
export async function refreshFromGitHub(token?: string): Promise<RegistryEntry[] | null> {
  const url =
    'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=stars&order=desc&per_page=100'
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'coeasy-dsh-market',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
    if (!Array.isArray(body.items)) return null
    return body.items
      .filter(
        (it) =>
          typeof it.full_name === 'string' &&
          isGithubRepo(it.full_name) &&
          !EXCLUDED.has(it.full_name as string),
      )
      .map((it) => ({
        name: String(it.name ?? ''),
        full_name: String(it.full_name),
        description: String(it.description ?? '').slice(0, 200),
        url: String(it.html_url ?? `https://github.com/${it.full_name}`),
        stars: Number(it.stargazers_count ?? 0),
        updated_at: String(it.updated_at ?? ''),
        topics: Array.isArray(it.topics) ? (it.topics as string[]).slice(0, 6) : [],
        license:
          it.license && typeof it.license === 'object' && 'spdx_id' in it.license
            ? String((it.license as { spdx_id?: string }).spdx_id ?? '')
            : null,
        pkg_name: null,
        market_tags: [],
      }))
  } catch {
    return null
  }
}

/** Fetch README fragment for a repo (best-effort, raw.githubusercontent). */
export async function fetchReadme(fullName: string, branch = 'main'): Promise<string | null> {
  if (
    !isGithubRepo(fullName) ||
    !/^[A-Za-z0-9._/-]{1,100}$/u.test(branch) ||
    branch.includes('..')
  ) {
    return null
  }
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${fullName}/${branch}/README.md`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const text = await res.text()
    return text.slice(0, 3000)
  } catch {
    return null
  }
}
