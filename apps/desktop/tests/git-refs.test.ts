import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchRefCandidates, shouldKeepExistingEngine } from '../../../scripts/git-refs.mjs'

describe('git fetch ref candidates', () => {
  it('tries tags before branches so a missing tag does not skip a same-named branch', () => {
    const names = fetchRefCandidates('v0.1.0-rc.5').map((item) => item.kind)
    assert.deepEqual(names, ['tag', 'head', 'raw'])
    assert.equal(
      fetchRefCandidates('v0.1.0-rc.5')[0].args[0],
      '+refs/tags/v0.1.0-rc.5:refs/tags/v0.1.0-rc.5',
    )
    assert.equal(fetchRefCandidates('master')[1].args[0], '+refs/heads/master:refs/heads/master')
  })

  it('fetches a commit SHA as itself', () => {
    const candidates = fetchRefCandidates('47f943859bef60e4160492346772ded9b24f765a')
    assert.deepEqual(
      candidates.map((item) => item.kind),
      ['sha'],
    )
  })

  it('keeps a built clone when fetch failed and force is off', () => {
    assert.equal(
      shouldKeepExistingEngine({ binExists: true, fetchFailed: true, force: false }),
      true,
    )
    assert.equal(
      shouldKeepExistingEngine({ binExists: true, fetchFailed: true, force: true }),
      false,
    )
    assert.equal(
      shouldKeepExistingEngine({ binExists: false, fetchFailed: true, force: false }),
      false,
    )
  })
})
