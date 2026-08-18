import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  githubRepoFromGitUrl,
  isPrereleaseTag,
  pickLatestRelease,
  pickStableRelease,
  resolveEngineRef,
} from '../../../scripts/github-engine.mjs'

const lock = {
  repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
  ref: 'v0.1.0-rc.5',
}

describe('GitHub engine resolution', () => {
  it('parses the upstream GitHub repository', () => {
    assert.deepEqual(githubRepoFromGitUrl(lock.repository), {
      owner: 'deepseek-ai',
      repo: 'deepseek-harness',
    })
  })

  it('prefers a non-prerelease tag for the stable channel', async () => {
    assert.equal(isPrereleaseTag('v0.1.0-rc.5'), true)
    assert.equal(isPrereleaseTag('v1.0.0'), false)
    const releases = [
      { tag_name: 'v1.1.0-rc.1', prerelease: true },
      { tag_name: 'v1.0.0', prerelease: false },
      { tag_name: 'v0.9.0', prerelease: false },
    ]
    assert.equal(pickLatestRelease(releases)?.tag_name, 'v1.1.0-rc.1')
    assert.equal(pickStableRelease(releases)?.tag_name, 'v1.0.0')
    const stable = await resolveEngineRef({
      channel: 'stable',
      lock,
      fetchJson: async () => releases,
    })
    assert.equal(stable.ref, 'v1.0.0')
    assert.equal(stable.channel, 'stable')
  })

  it('falls back to git tags when GitHub API is forbidden', async () => {
    const resolved = await resolveEngineRef({
      channel: 'latest',
      lock,
      fetchJson: async () => {
        throw new Error('GitHub 403 fetching releases')
      },
      listTags: () => ['v0.1.0-rc.4', 'v0.1.0-rc.5', 'v0.0.9'],
    })
    assert.equal(resolved.ref, 'v0.1.0-rc.5')
    assert.equal(resolved.source, 'git-ls-remote')
  })

  it('lets an explicit ref win', async () => {
    const resolved = await resolveEngineRef({
      channel: 'stable',
      explicitRef: 'v9.9.9',
      lock,
      fetchJson: async () => {
        throw new Error('network should not run')
      },
    })
    assert.equal(resolved.channel, 'explicit')
    assert.equal(resolved.ref, 'v9.9.9')
  })

  it('falls back to engine.lock.json when GitHub and git both fail', async () => {
    const resolved = await resolveEngineRef({
      channel: 'stable',
      lock,
      fetchJson: async () => {
        throw new Error('GitHub 403 fetching releases')
      },
      listTags: () => {
        throw new Error('git ls-remote failed (exit 128)')
      },
    })
    assert.equal(resolved.ref, lock.ref)
    assert.equal(resolved.source, 'engine.lock.json')
    const fallback = (resolved as { fallback?: unknown }).fallback
    assert.match(String(fallback), /403/)
    assert.match(String(fallback), /ls-remote/)
  })

  it('uses master/main when the upstream has no tags', async () => {
    const resolved = await resolveEngineRef({
      channel: 'stable',
      lock,
      fetchJson: async () => [],
      listTags: () => [],
      listHeads: () => ['develop', 'master'],
    })
    assert.equal(resolved.ref, 'master')
    assert.equal(resolved.source, 'git-ls-remote-heads')
  })
})
