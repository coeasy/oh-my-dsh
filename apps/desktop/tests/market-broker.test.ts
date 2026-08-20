import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  executeMarketBrokerAction,
  isTrustedMarketSender,
  validateMarketActionRequest,
} from '../src/market-broker.ts'

describe('trusted marketplace broker', () => {
  it('binds actions to the exact Harness origin', () => {
    assert.equal(
      isTrustedMarketSender('http://127.0.0.1:4100/settings', 'http://127.0.0.1:4100/session'),
      true,
    )
    assert.equal(isTrustedMarketSender('http://127.0.0.1:4101', 'http://127.0.0.1:4100'), false)
  })

  it('drops client supplied specs and keeps only the catalog id', () => {
    assert.deepEqual(
      validateMarketActionRequest({
        kind: 'install',
        payload: { full_name: 'owner/repo', spec: 'evil-package' },
      }),
      { kind: 'install', payload: { full_name: 'owner/repo' } },
    )
  })

  it('adds the private broker token only after native confirmation', async () => {
    let header = ''
    const result = await executeMarketBrokerAction({
      request: { kind: 'remove', payload: { full_name: 'owner/repo' } },
      senderUrl: 'http://127.0.0.1:4100/settings',
      harnessUrl: 'http://127.0.0.1:4100',
      token: 'secret',
      confirm: async () => true,
      fetchImpl: async (_url, init) => {
        header = String((init.headers as Record<string, string>)['x-dsh-market-broker'])
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    })
    assert.equal(header, 'secret')
    assert.equal(result.ok, true)
  })
})
