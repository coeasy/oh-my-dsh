/**
 * Pre-install safety verification (P-B).
 *
 * Two checks that run BEFORE the official CLI touches anything:
 *
 *  1. name-squatting guard — a package name that exists on the npm registry
 *     but whose resolved repository points somewhere OTHER than the source's
 *     `full_name` may be a typosquat / hijacked name. We surface a warning
 *     (we never block the official CLI, only inform), so a user who picked a
 *     registry entry whose `pkg_name` no longer matches its repo can see the
 *     mismatch before installing.
 *  2. lifecycle-script disclosure — packages whose latest build runs
 *     install/preinstall/postinstall/prepare can execute arbitrary code at
 *     install time. pnpm (and thus the official `dsh plugin add`) gates
 *     these behind its allowBuilds allowlist, but we still surface which
 *     scripts exist so the confirmation dialog can warn.
 *
 * Verification is read-only against the public npm registry and never
 * blocks the official install path — the CLI remains the single authority.
 */

import { createHash } from 'node:crypto'

/** Lifecycle hooks that can run code during `pnpm add`. */
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const

/**
 * Curated publisher allowlist (C1): npm maintainers of the official / curated
 * packages. Publishers outside this list are surfaced as `publisherUnknown`
 * (warning, not a block) so the confirmation dialog can inform the user.
 */
const TRUSTED_PUBLISHERS: ReadonlySet<string> = new Set(['coeasy', 'deepseek-ai'])

/** Tarballs larger than this are refused during integrity pre-check (64 MB). */
const MAX_TARBALL_BYTES = 64 * 1024 * 1024

export interface NpmVerifyResult {
  /** Registry reachable and the lookup succeeded (HTTP 200). */
  ok: boolean
  /** Package exists on the registry under this name. */
  exists: boolean
  /** Resolved package name (scope decoded). */
  name: string
  /** Latest published version. */
  latest: string | null
  /** GitHub `owner/repo` derived from the package's repository field, if any. */
  repository: string | null
  /** Package homepage, if any. */
  homepage: string | null
  /** `dist.integrity` (sha512) of the published tarball, for install-time pinning. */
  integrity: string | null
  /** Tarball download URL from the registry metadata. */
  tarball: string | null
  /** npm maintainer names (publishers). */
  maintainers: string[]
  /** True when at least one maintainer is on the curated allowlist. */
  publisherKnown: boolean
  /**
   * Tarball integrity pre-check result (C1), set by the install route:
   * match / mismatch / unavailable, or null when no check ran.
   */
  tarballCheck?: 'match' | 'mismatch' | 'unavailable' | null
  /** Detected lifecycle hooks (subset of LIFECYCLE_SCRIPTS). */
  lifecycle: string[]
  /**
   * True when the package's npm repository does NOT match the catalog entry
   * the user is about to install — a possible name-squatting signal.
   * Null when we cannot compare (no repo on either side).
   */
  squat: boolean | null
  /** Human-readable mismatch detail (bilingual). */
  note: string
}

/** Strip a `git+`, trailing `.git`, and expand github scp form → owner/repo. */
export function githubRepoFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const clean = url.replace(/^git\+/, '').replace(/\.git$/, '')
  // https://github.com/owner/repo(.git) and git@github.com:owner/repo.git
  const m = /github\.com[/:]([^/]+)\/([^/?#]+)/.exec(clean)
  if (!m) return null
  const owner = m[1]
  const repo = m[2].replace(/\.git$/, '').replace(/#.*$/, '')
  if (!owner || !repo) return null
  return `${owner}/${repo}`
}

function encodePkg(name: string): string {
  // scoped packages → registry path form: @scope/name → %40scope%2Fname
  return encodeURIComponent(name).replace(/^%40/, '%40')
}

const LIFECYCLE: readonly string[] = LIFECYCLE_SCRIPTS

/** Normalize maintainer entries: `"name <email>"` or `{ name }` → name. */
function maintainerNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const names: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const name = entry.split('<')[0].trim()
      if (name) names.push(name)
    } else if (entry && typeof entry === 'object') {
      const name = (entry as { name?: unknown }).name
      if (typeof name === 'string' && name) names.push(name)
    }
  }
  return names
}

const EMPTY_RESULT = (clean: string, note: string): NpmVerifyResult => ({
  ok: false,
  exists: false,
  name: clean,
  latest: null,
  repository: null,
  homepage: null,
  integrity: null,
  tarball: null,
  maintainers: [],
  publisherKnown: false,
  lifecycle: [],
  squat: null,
  note,
})

const REGISTRY_RETRIES = 3
const REGISTRY_RETRY_DELAY_MS = 350

/**
 * Query the npm `latest` endpoint with retries. npm's CDN (Fastly) responds
 * 406/429/5xx to some well-formed requests (per-connection quirks, rate
 * limits), so a single-shot lookup would randomly refuse installable
 * packages. 404 is definitive and returned as-is; every other non-2xx and
 * network error is retried with backoff before giving up.
 */
async function fetchRegistryLatest(
  url: string,
  timeoutMs: number,
  retries = REGISTRY_RETRIES,
): Promise<Response> {
  let lastError: unknown = new Error('registry lookup failed')
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 404 || res.ok) return res
      // 406/429/5xx — transient, back off and retry.
      lastError = new Error(`HTTP ${res.status}`)
      await new Promise((resolve) => setTimeout(resolve, REGISTRY_RETRY_DELAY_MS * attempt))
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, REGISTRY_RETRY_DELAY_MS * attempt))
    }
  }
  throw lastError
}

/**
 * Query the npm registry `latest` metadata for a package.
 * @param spec - npm package name (not a git/url spec).
 * @param expectRepo - the catalog full_name to compare against (squat check).
 * @param timeoutMs - network timeout.
 */
export async function verifyNpmPackage(
  spec: string,
  expectRepo?: string | null,
  timeoutMs = 12_000,
): Promise<NpmVerifyResult> {
  const clean = spec.replace(/^npm:/, '').trim()
  if (clean === '' || /[;|&`$><\n]/.test(clean)) {
    return EMPTY_RESULT(clean, '非法包名 / invalid package name')
  }
  try {
    const res = await fetchRegistryLatest(
      `https://registry.npmjs.org/${encodePkg(clean)}/latest`,
      timeoutMs,
    )
    if (!res.ok) {
      // 404 → the name is not taken; not a squat risk, but not installable as
      // npm either. ANY other status (406/429/5xx) is a transient registry
      // failure, NOT a "package missing" verdict — mark it as a lookup
      // failure (ok:false) so the install route can tell the user to retry
      // instead of refusing an installable package.
      if (res.status === 404) {
        return {
          ok: true,
          exists: false,
          name: clean,
          latest: null,
          repository: null,
          homepage: null,
          integrity: null,
          tarball: null,
          maintainers: [],
          publisherKnown: false,
          lifecycle: [],
          squat: false,
          note: 'npm registry 上不存在该包名 / package name not published on npm',
        }
      }
      return EMPTY_RESULT(
        clean,
        `npm registry 查询失败 HTTP ${res.status}（非包名不存在，请重试）/ registry lookup HTTP ${res.status} (transient; retry)`,
      )
    }
    const d = (await res.json()) as {
      name?: unknown
      version?: unknown
      repository?: unknown
      homepage?: unknown
      maintainers?: unknown
      dist?: { integrity?: unknown; tarball?: unknown }
      scripts?: Record<string, string>
    }
    const name = typeof d.name === 'string' ? d.name : clean
    const latest = typeof d.version === 'string' ? d.version : null
    const repositoryRaw =
      typeof d.repository === 'string'
        ? d.repository
        : d.repository && typeof d.repository === 'object'
          ? ((d.repository as { url?: unknown }).url as string | undefined)
          : undefined
    const repository = githubRepoFromUrl(repositoryRaw)
    const homepage = typeof d.homepage === 'string' ? d.homepage : null
    const integrity = d.dist && typeof d.dist.integrity === 'string' ? d.dist.integrity : null
    const tarball =
      d.dist && typeof d.dist.tarball === 'string' && /^https:/.test(d.dist.tarball)
        ? d.dist.tarball
        : null
    const maintainers = maintainerNames(d.maintainers)
    const publisherKnown = maintainers.some((m) => TRUSTED_PUBLISHERS.has(m.toLowerCase()))
    const scripts = d.scripts && typeof d.scripts === 'object' ? d.scripts : {}
    const lifecycle = LIFECYCLE.filter((s) => typeof scripts[s] === 'string' && scripts[s] !== '')

    let squat: boolean | null = null
    let note = ''
    if (expectRepo && repository && expectRepo.toLowerCase() !== repository.toLowerCase()) {
      squat = true
      note = `包在 npm 的仓库 ${repository} 与所选来源 ${expectRepo} 不一致——可能是改名或占用，请谨慎 / the npm package resolves to ${repository}, not ${expectRepo} — possible squat, proceed with care`
    } else {
      squat = false
    }
    return {
      ok: true,
      exists: true,
      name,
      latest,
      repository,
      homepage,
      integrity,
      tarball,
      maintainers,
      publisherKnown,
      lifecycle,
      squat,
      note,
    }
  } catch {
    return EMPTY_RESULT(clean, 'npm registry 查询失败 / registry lookup failed')
  }
}

export interface TarballIntegrityResult {
  /** 'match' | 'mismatch' | 'unavailable' (no tarball/integrity or network issue). */
  status: 'match' | 'mismatch' | 'unavailable'
  note: string
}

/**
 * C1 hard gate: download the published tarball and compare its sha512 with the
 * registry's `dist.integrity` BEFORE the official CLI installs anything.
 * A mismatched tarball means the artifact was tampered with (registry cache
 * poisoning, MITM on a mirror) — the install must be refused.
 */
export async function verifyTarballIntegrity(
  input: { tarball: string | null; integrity: string | null },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<TarballIntegrityResult> {
  if (!input.tarball || !input.integrity) {
    return {
      status: 'unavailable',
      note: '缺少 tarball 或 integrity 元数据 / missing tarball or integrity metadata',
    }
  }
  const expected = /^sha512-([A-Za-z0-9+/=]+)$/.exec(input.integrity)
  if (!expected) {
    return {
      status: 'unavailable',
      note: 'integrity 算法不受支持 / unsupported integrity algorithm',
    }
  }
  try {
    const res = await fetchImpl(input.tarball, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      return {
        status: 'unavailable',
        note: `tarball 下载失败 HTTP ${res.status} / tarball fetch HTTP ${res.status}`,
      }
    }
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > MAX_TARBALL_BYTES) {
      return { status: 'unavailable', note: 'tarball 超过大小上限 / tarball exceeds size cap' }
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_TARBALL_BYTES) {
      return { status: 'unavailable', note: 'tarball 超过大小上限 / tarball exceeds size cap' }
    }
    const actual = createHash('sha512').update(buf).digest('base64')
    if (actual === expected[1]) {
      return {
        status: 'match',
        note: 'tarball 与 registry integrity 一致 / tarball matches registry integrity',
      }
    }
    return {
      status: 'mismatch',
      note: `tarball integrity 不一致（疑似篡改），已拒绝安装 / tarball integrity mismatch (possible tampering); install refused`,
    }
  } catch {
    return {
      status: 'unavailable',
      note: 'tarball 校验无法完成 / tarball verification unavailable',
    }
  }
}
