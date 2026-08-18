export function parseGithubRepo(
  repositoryUrl: string | undefined,
): { owner: string; repo: string } | undefined {
  const raw = repositoryUrl?.trim() ?? ''
  if (!raw) return undefined
  const match = raw.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/#.]+)/u)
  if (!match?.groups?.owner || !match.groups.repo) return undefined
  return { owner: match.groups.owner, repo: match.groups.repo }
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest
    .replace(/^v/u, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  const b = current
    .replace(/^v/u, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return false
}
