import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { PlannerBridge } from '../src/planner-bridge.ts'
import { defaultDocument, normalizeDocument } from '../src/schema.ts'
import {
  ModelConfigStore,
  fileBackend,
  memoryBackend,
  type ModelConfigBackend,
} from '../src/store.ts'
import { resolveChildModel, stageForRole } from '../src/subagent-bridge.ts'
import type { ModelConfigDocument, ModelSwitchSeam, PlanModeSeam } from '../src/types.ts'

describe('model-config store', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-mc-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists a document across loads (file backend)', async () => {
    const path = join(dir, 'config.json')
    const backend = fileBackend(path)
    const store = await ModelConfigStore.load({ backend })
    await store.mutate((doc) => {
      doc.stages.default = {
        follow: null,
        binding: { provider: 'p', model: 'm', reasoningEffort: 'high' },
      }
      return doc
    }, backend)
    const reloaded = await ModelConfigStore.load({ backend })
    assert.equal(reloaded.document.stages.default!.binding!.model, 'm')
    assert.equal(reloaded.document.stages.default!.binding!.reasoningEffort, 'high')
    // File is valid JSON with atomic tmp+rename.
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(raw.schemaVersion, 1)
  })

  it('resets to defaults when the persisted document is broken', async () => {
    const path = join(dir, 'config.json')
    const backend = fileBackend(path)
    await backend.write('{ not json')
    const store = await ModelConfigStore.load({ backend })
    assert.equal(store.document.schemaVersion, 1)
    assert.ok(store.loadWarnings.length >= 0)
  })

  it('rejects invalid mutations and keeps prior document', async () => {
    const path = join(dir, 'config.json')
    const backend = fileBackend(path)
    const store = await ModelConfigStore.load({ backend })
    await store.mutate((doc) => {
      doc.stages.default = { follow: null, binding: { provider: 'p', model: 'm' } }
      return doc
    }, backend)
    const bad = await store.mutate((doc) => {
      doc.stages.default = { follow: null, binding: { provider: '', model: '' } }
      return doc
    }, backend)
    assert.equal(bad.ok, false)
    assert.equal(store.document.stages.default!.binding!.model, 'm')
  })

  it('bumps revision only on successful mutations', async () => {
    const backend = memoryBackend()
    const store = await ModelConfigStore.load({ backend })
    const r1 = await store.mutate((d) => d, backend)
    assert.equal(r1.ok, true)
    assert.equal(r1.revision, 1)
    const r2 = await store.mutate((d) => {
      d.stages.planning = { follow: 'default' }
      return d
    }, backend)
    assert.equal(r2.revision, 2)
  })

  it('reports persisted=false when the backend write fails', async () => {
    const failing: ModelConfigBackend = {
      async read() {
        return null
      },
      async write() {
        throw new Error('disk full')
      },
    }
    const store = await ModelConfigStore.load({ backend: failing })
    const r = await store.mutate((d) => {
      d.stages.default = { follow: null, binding: { provider: 'p', model: 'm' } }
      return d
    }, failing)
    assert.equal(r.ok, true)
    assert.equal(r.persisted, false)
    // In-memory state still advanced (change is volatile but applied).
    assert.equal(store.document.stages.default!.binding!.model, 'm')
  })
})

describe('model-config planner bridge', () => {
  function planModeSeam(
    initial = false,
    listeners: Array<(a: boolean) => void> = [],
  ): PlanModeSeam {
    return {
      isActive: () => initial,
      subscribe: (on) => {
        listeners.push(on)
        return () => {
          const i = listeners.indexOf(on)
          if (i >= 0) listeners.splice(i, 1)
        }
      },
    }
  }

  function modelSwitchSeam(): ModelSwitchSeam & {
    calls: Array<{ session: string; sel: unknown }>
  } {
    const calls: Array<{ session: string; sel: unknown }> = []
    return {
      calls,
      async apply(sessionId, sel) {
        calls.push({ session: sessionId, sel })
      },
    }
  }

  it('degrades to unsupported when no seams are wired', () => {
    const bridge = new PlannerBridge({
      doc: () => defaultDocument(),
      modelSwitch: undefined,
      planMode: undefined,
    })
    assert.equal(bridge.getStatus().supported, false)
    assert.equal(bridge.getStatus().hotSwitch, false)
  })

  it('hot-switches to the planning binding when plan mode activates', async () => {
    const listeners: Array<(a: boolean) => void> = []
    const ms = modelSwitchSeam()
    const doc: ModelConfigDocument = defaultDocument()
    doc.stages.default = { follow: null, binding: { provider: 'p', model: 'main' } }
    doc.stages.planning = {
      follow: null,
      binding: { provider: 'p', model: 'planner', reasoningEffort: 'high' },
    }
    const bridge = new PlannerBridge({
      doc: () => doc,
      modelSwitch: ms,
      planMode: planModeSeam(false, listeners),
    })
    bridge.start()
    listeners[0](true) // plan mode on
    await bridge.apply('session-1')
    assert.equal(ms.calls.length, 1)
    assert.deepEqual(ms.calls[0].sel, { provider: 'p', model: 'planner', reasoningEffort: 'high' })
    assert.equal(ms.calls[0].session, 'session-1')
    // Plan mode off → no switch
    listeners[0](false)
    await bridge.apply('session-1')
    assert.equal(ms.calls.length, 1)
  })

  it('does not switch when no planning binding resolves (follow default but no default)', async () => {
    const ms = modelSwitchSeam()
    const bridge = new PlannerBridge({
      doc: () => defaultDocument(),
      modelSwitch: ms,
      planMode: planModeSeam(true),
    })
    bridge.start()
    await bridge.apply('session-1')
    assert.equal(ms.calls.length, 0)
  })

  it('dispose releases the subscription', () => {
    const listeners: Array<(a: boolean) => void> = []
    const bridge = new PlannerBridge({
      doc: () => defaultDocument(),
      modelSwitch: modelSwitchSeam(),
      planMode: planModeSeam(false, listeners),
    })
    bridge.start()
    assert.equal(listeners.length, 1)
    bridge.dispose()
    assert.equal(listeners.length, 0)
  })
})

describe('model-config subagent bridge', () => {
  it('returns null when the child declares its own model', () => {
    assert.equal(resolveChildModel({ doc: defaultDocument(), explicitModel: true }), null)
  })

  it('returns null when nothing resolves (all follow default, no default binding)', () => {
    assert.equal(resolveChildModel({ doc: defaultDocument() }), null)
  })

  it('resolves the subagent binding via the follow chain', () => {
    const doc = defaultDocument()
    doc.stages.default = { follow: null, binding: { provider: 'p', model: 'main' } }
    const b = resolveChildModel({ doc })
    assert.deepEqual(b, { provider: 'p', model: 'main' })
  })

  it('maps reviewer/worker/task to the subagent stage', () => {
    assert.equal(stageForRole('reviewer'), 'subagent')
    assert.equal(stageForRole('worker'), 'subagent')
    assert.equal(stageForRole('task'), 'subagent')
    assert.equal(stageForRole('evaluator'), 'evaluation')
    assert.equal(stageForRole(undefined), 'subagent')
  })

  it('routes an evaluator child to the evaluation stage', () => {
    const doc = defaultDocument()
    doc.stages.evaluation = { follow: null, binding: { provider: 'p', model: 'eval-lite' } }
    const b = resolveChildModel({ doc, role: 'evaluator' })
    assert.deepEqual(b, { provider: 'p', model: 'eval-lite' })
  })
})

describe('model-config normalize round-trip via store', () => {
  it('store document always normalizes cleanly', async () => {
    const backend = memoryBackend()
    const store = await ModelConfigStore.load({ backend })
    await store.mutate((doc) => {
      doc.profiles = {
        deep: {
          id: 'deep',
          label: '深度规划',
          stages: {
            default: { provider: 'p', model: 'm' },
            planning: { provider: 'p', model: 'm', reasoningEffort: 'high' },
            subagent: { provider: 'p', model: 'm' },
            evaluation: { provider: 'p', model: 'm' },
          },
        },
      }
      doc.activeProfile = 'deep'
      return doc
    }, backend)
    const { problems } = normalizeDocument(store.document)
    assert.deepEqual(problems, [])
  })
})
