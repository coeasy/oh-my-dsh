import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isNewerVersion, parseGithubRepo } from '../src/updates.ts'

describe('update checks', () => {
  it('parses GitHub HTTPS and SSH URLs', () => {
    assert.deepEqual(parseGithubRepo('https://github.com/acme/dsh-client-pack.git'), {
      owner: 'acme',
      repo: 'dsh-client-pack',
    })
    assert.deepEqual(parseGithubRepo('git@github.com:acme/dsh-client-pack.git'), {
      owner: 'acme',
      repo: 'dsh-client-pack',
    })
    assert.equal(parseGithubRepo(''), undefined)
  })

  it('compares dotted versions', () => {
    assert.equal(isNewerVersion('0.3.0', '0.2.0'), true)
    assert.equal(isNewerVersion('v0.2.0', '0.2.0'), false)
    assert.equal(isNewerVersion('0.2.0', '0.3.0'), false)
  })
})
