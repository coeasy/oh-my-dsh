/**
 * Git refspecs used to update the gitignored Harness clone.
 * Tags are tried before branches because `git fetch origin vX` looks up a
 * branch first and fails when the name only exists as a tag — or, as with
 * this upstream, when the lock file names a tag that was never published.
 */
export function fetchRefCandidates(ref) {
  const trimmed = String(ref || '').trim()
  if (!trimmed) throw new Error('git ref is empty')
  if (/^[0-9a-f]{7,40}$/iu.test(trimmed)) {
    return [{ kind: 'sha', args: [trimmed] }]
  }
  return [
    { kind: 'tag', args: [`+refs/tags/${trimmed}:refs/tags/${trimmed}`] },
    { kind: 'head', args: [`+refs/heads/${trimmed}:refs/heads/${trimmed}`] },
    { kind: 'raw', args: [trimmed] },
  ]
}

/** Keep a built clone when update fails unless the caller demanded a force refresh. */
export function shouldKeepExistingEngine(input) {
  return Boolean(input.binExists) && Boolean(input.fetchFailed) && !input.force
}
