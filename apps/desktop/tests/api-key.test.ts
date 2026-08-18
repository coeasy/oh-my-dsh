import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasDeepSeekApiKey, redactSecrets, upsertEnvKey } from '../src/api-key.ts'

describe('API key helpers', () => {
  it('detects a non-empty DeepSeek key', () => {
    assert.equal(hasDeepSeekApiKey({}), false)
    assert.equal(hasDeepSeekApiKey({ DEEPSEEK_API_KEY: '  ' }), false)
    assert.equal(hasDeepSeekApiKey({ DEEPSEEK_API_KEY: 'sk-test' }), true)
  })

  it('upserts without dropping sibling keys', () => {
    const next = upsertEnvKey('FOO=1\nDEEPSEEK_API_KEY=old\n', 'DEEPSEEK_API_KEY', 'new')
    assert.match(next, /FOO=1/)
    assert.match(next, /DEEPSEEK_API_KEY=new/)
    assert.doesNotMatch(next, /old/)
  })

  it('redacts secret assignments in diagnostics', () => {
    const redacted = redactSecrets('DEEPSEEK_API_KEY=sk-live\nPath=C:\\Windows\n')
    assert.match(redacted, /DEEPSEEK_API_KEY=\*\*\*/)
    assert.match(redacted, /Path=C:\\Windows/)
  })
})
