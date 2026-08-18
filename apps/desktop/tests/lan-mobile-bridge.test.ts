import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import {
  isPrivateAddress,
  LanMobileBridge,
  normalizeRemoteAddress,
} from '../src/mobile/lan-mobile-bridge.ts'

const bridges: LanMobileBridge[] = []
const servers: ReturnType<typeof createServer>[] = []

after(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

describe('LAN mobile bridge address policy', () => {
  it('allows loopback and RFC1918 addresses', () => {
    assert.equal(isPrivateAddress('127.0.0.1'), true)
    assert.equal(isPrivateAddress('10.1.2.3'), true)
    assert.equal(isPrivateAddress('172.16.0.1'), true)
    assert.equal(isPrivateAddress('192.168.1.10'), true)
  })

  it('rejects public addresses and out-of-range 172 networks', () => {
    assert.equal(isPrivateAddress('8.8.8.8'), false)
    assert.equal(isPrivateAddress('172.15.0.1'), false)
    assert.equal(isPrivateAddress('172.32.0.1'), false)
  })

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    assert.equal(normalizeRemoteAddress('::ffff:192.168.1.4'), '192.168.1.4')
  })
})

describe('LAN mobile bridge pairing surface', () => {
  it('serves the desktop pairing page only on loopback', async () => {
    const bridge = new LanMobileBridge({
      harnessUrl: () => 'http://127.0.0.1:9999',
      lanAddress: () => '192.168.1.10',
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    assert.ok(snapshot.desktopUrl)
    const response = await fetch(snapshot.desktopUrl)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /Connect your phone/)
    assert.match(html, /<svg[\s\S]*<\/svg>/i)
  })

  it('does not expose the mobile UI before pairing', async () => {
    const bridge = new LanMobileBridge({
      harnessUrl: () => 'http://127.0.0.1:9999',
      lanAddress: () => '192.168.1.10',
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    const response = await fetch(`http://127.0.0.1:${snapshot.port}/`)
    assert.equal(response.status, 401)
  })

  it('requires approval, then forwards only allowlisted RPC methods', async () => {
    const harness = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { rpcId: string }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value: { items: [], archivedSessionIds: [] } },
        }),
      )
    })
    servers.push(harness)
    await new Promise<void>((resolve) => harness.listen(0, '127.0.0.1', resolve))
    const harnessPort = (harness.address() as AddressInfo).port
    const bridge = new LanMobileBridge({
      harnessUrl: () => `http://127.0.0.1:${harnessPort}`,
      lanAddress: () => '192.168.1.10',
    })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    const token = new URL(snapshot.pairingUrl!).searchParams.get('token')
    const pairingPage = await fetch(`http://127.0.0.1:${snapshot.port}/pair?token=${token}`)
    const pairingHtml = await pairingPage.text()
    const pairingId = /const id="([^"]+)"/.exec(pairingHtml)?.[1]
    assert.ok(pairingId)
    const pending = await fetch(`http://127.0.0.1:${snapshot.port}/desktop/pending`)
    assert.deepEqual(await pending.json(), { id: pairingId, remoteAddress: '127.0.0.1' })
    await fetch(`http://127.0.0.1:${snapshot.port}/desktop/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pairingId, approved: true }),
    })
    const paired = await fetch(`http://127.0.0.1:${snapshot.port}/pair/status?id=${pairingId}`, {
      redirect: 'manual',
    })
    assert.deepEqual(await paired.clone().json(), { approved: true })
    const cookie = paired.headers.get('set-cookie')!.split(';', 1)[0]!

    const forwarded = await fetch(`http://127.0.0.1:${snapshot.port}/api/rpc`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'workspace.list', payload: {} }),
    })
    assert.equal(forwarded.status, 200)
    assert.deepEqual(await forwarded.json(), {
      ok: true,
      value: { items: [], archivedSessionIds: [] },
    })

    const blocked = await fetch(`http://127.0.0.1:${snapshot.port}/api/rpc`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'host.openPath', payload: { path: '/tmp/secret' } }),
    })
    assert.equal(blocked.status, 403)

    const mobileStatus = await fetch(`http://127.0.0.1:${snapshot.port}/api/status`, {
      headers: { cookie },
    })
    assert.equal(mobileStatus.status, 200)
    assert.deepEqual(await mobileStatus.json(), { connected: true })
  })
})
