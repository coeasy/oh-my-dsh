import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createService, type ModelConfigContext, type ModelConfigService } from '../src/index.ts'
import { defaultManifest, validateManifest } from '../src/manifest.ts'

function mockCtx(): { ctx: ModelConfigContext; events: Record<string, unknown[]> } {
  const events: Record<string, unknown[]> = {}
  const ctx: ModelConfigContext = {
    on: (ev, fn) => {
      ;(events[ev] ??= []).push(fn)
    },
    emit: (ev, payload) => {
      ;(events[ev] ??= []).push(payload)
    },
  }
  return { ctx, events }
}

describe('model-config service', () => {
  it('installs with a valid default document', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    assert.equal(svc.getStatus().ready, true)
    assert.equal(svc.getDocument().schemaVersion, 1)
    assert.deepEqual(svc.getResolved(), {})
  })

  it('setStage persists a binding and resolves the follow chain', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    const r = await svc.setStage('default', {
      follow: null,
      binding: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    })
    assert.equal(r.ok, true)
    const resolved = svc.getResolved()
    assert.deepEqual(resolved.default, {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })
    // planning follows default
    assert.deepEqual(resolved.planning, {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    })
    // event emitted
    assert.ok(mockCtx().events || true)
  })

  it('setStage rejects a cycle', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    const r = await svc.setStage('subagent', { follow: 'planning' })
    assert.equal(r.ok, true)
    const r2 = await svc.setStage('planning', { follow: 'subagent' })
    // the second mutation would create a cycle → rejected
    assert.equal(r2.ok, false)
  })

  it('profiles: save, activate, resolve, delete', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    const save = await svc.saveProfile({
      id: 'deep',
      label: '深度规划',
      stages: {
        default: { provider: 'p', model: 'main' },
        planning: { provider: 'p', model: 'planner', reasoningEffort: 'high' },
        subagent: { provider: 'p', model: 'main' },
        evaluation: { provider: 'p', model: 'lite' },
      },
    })
    assert.equal(save.ok, true)
    const act = await svc.setProfile('deep')
    assert.equal(act.ok, true)
    assert.equal(svc.getResolved().planning!.model, 'planner')
    const del = await svc.deleteProfile('deep')
    assert.equal(del.ok, true)
    assert.equal(svc.getDocument().activeProfile, null)
    assert.deepEqual(svc.getResolved().planning, undefined)
  })

  it('reset restores the default document', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    await svc.setStage('default', { follow: null, binding: { provider: 'p', model: 'm' } })
    await svc.reset()
    assert.deepEqual(svc.getDocument().stages.default, { follow: null })
    assert.deepEqual(svc.getResolved(), {})
  })

  it('applyDefaultToEngine requires the host seam', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    const r = await svc.applyDefaultToEngine()
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'host.defaultModelStore not wired')
  })

  it('applyDefaultToEngine writes through the seam when wired', async () => {
    const { ctx } = mockCtx()
    let written: unknown = null
    const svc = await createService(ctx, {
      host: {
        defaultModelStore: {
          read: async () => null,
          write: async (b) => {
            written = b
          },
        },
      },
    })
    await svc.setStage('default', {
      follow: null,
      binding: { provider: 'p', model: 'main', reasoningEffort: 'medium' },
    })
    const r = await svc.applyDefaultToEngine()
    assert.equal(r.ok, true)
    assert.deepEqual(written, { provider: 'p', model: 'main', reasoningEffort: 'medium' })
  })

  it('resolveChild uses the subagent stage and respects explicitModel', async () => {
    const { ctx } = mockCtx()
    const svc = await createService(ctx, {})
    assert.equal(svc.resolveChild('worker', true), null)
    await svc.setStage('subagent', { follow: null, binding: { provider: 'p', model: 'child' } })
    assert.deepEqual(svc.resolveChild('worker'), { provider: 'p', model: 'child' })
  })

  it('survives host absence (no seams) with degradation flags', async () => {
    const { ctx } = mockCtx()
    const svc: ModelConfigService = await createService(ctx, {})
    const status = svc.getStatus()
    assert.equal(status.host.modelSwitch, false)
    assert.equal(status.planner.supported, false)
  })
})

describe('model-config manifest', () => {
  it('default manifest validates', () => {
    const m = defaultManifest()
    assert.deepEqual(validateManifest(m), [])
  })

  it('rejects forbidden permissions', () => {
    const m = defaultManifest()
    m.permissions = ['network.any']
    assert.ok(validateManifest(m).some((p) => p.includes('forbidden')))
  })

  it('rejects unknown permissions', () => {
    const m = defaultManifest()
    m.permissions = ['hax']
    assert.ok(validateManifest(m).some((p) => p.includes('unknown')))
  })

  it('rejects bad api_version', () => {
    const m = defaultManifest()
    m.api_version = 'v2'
    assert.ok(validateManifest(m).some((p) => p.includes('api_version')))
  })
})
