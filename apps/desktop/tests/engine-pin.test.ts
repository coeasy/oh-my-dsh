import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('engine pin', () => {
  it('locks an upstream git ref and does not vendor the clone', () => {
    const lock = JSON.parse(readFileSync(join(root, 'engine.lock.json'), 'utf8')) as {
      repository: string
      ref: string
    }
    assert.match(lock.repository, /deepseek-harness/)
    assert.equal(typeof lock.ref, 'string')
    assert.ok(lock.ref.length > 0)
    const ignore = readFileSync(join(root, '.gitignore'), 'utf8')
    assert.match(ignore, /\/deepseek-harness\//)
    const fetch = readFileSync(join(root, 'scripts', 'fetch-engine.mjs'), 'utf8')
    assert.match(fetch, /DSH_ENGINE_REF/)
    assert.match(fetch, /loadEngineLock/)
    assert.match(fetch, /defaultEngineRoot/)
    assert.match(fetch, /fetchRefCandidates/)
    assert.match(fetch, /shouldKeepExistingEngine/)
    const clients = readFileSync(join(root, 'scripts', 'build-clients.mjs'), 'utf8')
    assert.match(clients, /resolveEngineRef/)
    assert.match(clients, /build-engine\.mjs/)
    assert.match(clients, /install-clients\.mjs/)
    assert.doesNotMatch(clients, /DSH_FETCH_ENGINE_FORCE \|\| '1'/)
    const originWriter = readFileSync(join(root, 'scripts', 'stage-payload.mjs'), 'utf8')
    assert.match(originWriter, /lock\.ref/)
    assert.match(originWriter, /clientVersion/)
    assert.match(originWriter, /loadProductVersion/)
    const install = readFileSync(join(root, 'scripts', 'install-clients.mjs'), 'utf8')
    assert.match(install, /--install-extension/)
    assert.match(install, /cursor/)
  })
})
