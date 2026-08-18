/**
 * Resolve a DeepSeek Harness git ref from GitHub releases without editing the clone.
 * Channels:
 *   lock    — engine.lock.json ref
 *   stable  — latest GitHub release with prerelease=false; if none, latest release
 *   latest  — newest GitHub release including prereleases
 * An explicit DSH_ENGINE_REF=vX.Y.Z wins over the channel.
 * GitHub API 403/empty falls back to `git ls-remote --tags`, then
 * `git ls-remote --heads` (master/main), then `engine.lock.json`.
 * `GITHUB_TOKEN` or `GH_TOKEN` raises the GitHub API rate limit.
 */
import { spawnSync } from 'node:child_process'

export function githubRepoFromGitUrl(url) {
  const raw = String(url || '').trim()
  const match = raw.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/#.]+)/u)
  if (!match?.groups?.owner || !match.groups.repo) {
    throw new Error(`not a GitHub repository URL: ${raw}`)
  }
  return { owner: match.groups.owner, repo: match.groups.repo.replace(/\.git$/u, '') }
}

export function isPrereleaseTag(tag) {
  return /-(?:rc|alpha|beta|pre|preview)(?:\.|$)/iu.test(String(tag || ''))
}

export function pickLatestRelease(releases) {
  if (!Array.isArray(releases) || releases.length === 0) return undefined
  return releases[0]
}

export function pickStableRelease(releases) {
  if (!Array.isArray(releases) || releases.length === 0) return undefined
  const stable = releases.find((item) => item && item.prerelease === false && !isPrereleaseTag(item.tag_name))
  return stable || pickLatestRelease(releases)
}

export function releaseToRef(release) {
  const tag = typeof release?.tag_name === 'string' ? release.tag_name.trim() : ''
  if (!tag) throw new Error('GitHub release is missing tag_name')
  return tag
}

export function parseLsRemoteTags(stdout) {
  const tags = []
  for (const line of String(stdout).split(/\r?\n/u)) {
    const match = line.match(/refs\/tags\/(.+)$/u)
    if (match?.[1]) tags.push(match[1].trim())
  }
  return tags
}

export function parseLsRemoteHeads(stdout) {
  const heads = []
  for (const line of String(stdout).split(/\r?\n/u)) {
    const match = line.match(/refs\/heads\/(.+)$/u)
    if (match?.[1]) heads.push(match[1].trim())
  }
  return heads
}

export function pickDefaultHead(heads) {
  if (!Array.isArray(heads) || heads.length === 0) return undefined
  if (heads.includes('master')) return 'master'
  if (heads.includes('main')) return 'main'
  return heads[0]
}

export function compareTags(left, right) {
  const parts = (tag) =>
    String(tag)
      .replace(/^v/u, '')
      .split(/[.-]/u)
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = parts(left)
  const b = parts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const l = a[index] ?? 0
    const r = b[index] ?? 0
    if (l > r) return 1
    if (l < r) return -1
  }
  if (isPrereleaseTag(left) !== isPrereleaseTag(right)) return isPrereleaseTag(left) ? -1 : 1
  return 0
}

export function pickLatestTag(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return undefined
  return [...tags].sort(compareTags).at(-1)
}

export function pickStableTag(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return undefined
  const stable = tags.filter((tag) => !isPrereleaseTag(tag))
  return pickLatestTag(stable.length > 0 ? stable : tags)
}

export function githubAuthToken() {
  return String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
}

export function listTagsViaGit(repository) {
  const result = spawnSync('git', ['ls-remote', '--tags', '--refs', repository], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  })
  if (result.status !== 0) {
    throw new Error(`git ls-remote failed (exit ${result.status})`)
  }
  return parseLsRemoteTags(result.stdout || '')
}

export function listHeadsViaGit(repository) {
  const result = spawnSync('git', ['ls-remote', '--heads', repository], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  })
  if (result.status !== 0) {
    throw new Error(`git ls-remote --heads failed (exit ${result.status})`)
  }
  return parseLsRemoteHeads(result.stdout || '')
}

function fromTags(channel, tags, lock, reason) {
  const ref = channel === 'stable' ? pickStableTag(tags) : pickLatestTag(tags)
  if (!ref) {
    return {
      channel,
      ref: lock.ref,
      repository: lock.repository,
      source: 'engine.lock.json',
      fallback: reason,
    }
  }
  return {
    channel,
    ref,
    repository: lock.repository,
    source: 'git-ls-remote',
    prerelease: isPrereleaseTag(ref),
    fallback: reason,
  }
}

function listTagsSafe(listTags, repository) {
  try {
    return { tags: listTags(repository) || [], error: '' }
  } catch (error) {
    return { tags: [], error: error instanceof Error ? error.message : String(error) }
  }
}

function fromHeadsOrLock(channel, listHeads, lock, reason) {
  if (!listHeads) {
    return {
      channel,
      ref: lock.ref,
      repository: lock.repository,
      source: 'engine.lock.json',
      fallback: reason,
    }
  }
  const { tags: heads, error } = listTagsSafe(listHeads, lock.repository)
  const head = pickDefaultHead(heads)
  if (!head) {
    return {
      channel,
      ref: lock.ref,
      repository: lock.repository,
      source: 'engine.lock.json',
      fallback: error ? `${reason}; ${error}` : reason,
    }
  }
  return {
    channel,
    ref: head,
    repository: lock.repository,
    source: 'git-ls-remote-heads',
    fallback: error ? `${reason}; ${error}` : reason,
  }
}

function fromTagsOrLock(channel, listTags, lock, reason, listHeads) {
  const { tags, error } = listTagsSafe(listTags, lock.repository)
  if (tags.length > 0) {
    return fromTags(channel, tags, lock, error ? `${reason}; ${error}` : reason)
  }
  return fromHeadsOrLock(channel, listHeads, lock, error ? `${reason}; ${error}` : reason)
}

/**
 * @param {{
 *   channel?: string,
 *   explicitRef?: string,
 *   lock: { repository: string, ref: string },
 *   fetchJson?: (url: string) => Promise<unknown>,
 *   listTags?: (repository: string) => string[],
 *   listHeads?: (repository: string) => string[],
 * }} input
 */
export async function resolveEngineRef(input) {
  const explicit = (input.explicitRef || '').trim()
  if (explicit && explicit !== 'lock' && explicit !== 'stable' && explicit !== 'latest') {
    return {
      channel: 'explicit',
      ref: explicit,
      repository: input.lock.repository,
      source: 'DSH_ENGINE_REF',
    }
  }
  const channel = (input.channel || explicit || 'lock').trim().toLowerCase() || 'lock'
  if (channel === 'lock') {
    return {
      channel: 'lock',
      ref: input.lock.ref,
      repository: input.lock.repository,
      source: 'engine.lock.json',
    }
  }
  if (channel !== 'stable' && channel !== 'latest') {
    throw new Error(`DSH_ENGINE_CHANNEL must be lock|stable|latest, got ${channel}`)
  }

  const { owner, repo } = githubRepoFromGitUrl(input.lock.repository)
  const fetchJson =
    input.fetchJson ||
    (async (url) => {
      const headers = { 'User-Agent': 'dsh-client-pack', Accept: 'application/vnd.github+json' }
      const token = githubAuthToken()
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`GitHub ${response.status} fetching ${url}`)
      }
      return response.json()
    })
  const listTags = input.listTags || listTagsViaGit
  const listHeads = input.listHeads || (input.listTags ? undefined : listHeadsViaGit)
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`)
    if (!Array.isArray(releases) || releases.length === 0) {
      return fromTagsOrLock(channel, listTags, input.lock, 'empty-releases', listHeads)
    }
    const picked = channel === 'stable' ? pickStableRelease(releases) : pickLatestRelease(releases)
    const ref = releaseToRef(picked)
    return {
      channel,
      ref,
      repository: input.lock.repository,
      source: 'github-releases',
      prerelease: picked.prerelease === true || isPrereleaseTag(ref),
    }
  } catch (error) {
    return fromTagsOrLock(
      channel,
      listTags,
      input.lock,
      error instanceof Error ? error.message : String(error),
      listHeads,
    )
  }
}
