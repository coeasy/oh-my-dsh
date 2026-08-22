import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateBindingAgainstCatalog } from '../src/catalog.ts'
import { defaultDocument, normalizeDocument } from '../src/schema.ts'
import { resolveStage, resolveStages } from '../src/resolver.ts'
import type { ModelConfigDocument } from '../src/types.ts'

describe('model-config schema', () => {
  it('default document is valid', () => {
    const { problems, doc } = normalizeDocument(defaultDocument())
    assert.deepEqual(problems, [])
    assert.ok(doc)
    assert.equal(doc!.schemaVersion, 1)
    assert.equal(doc!.activeProfile, null)
  })

  it('rejects a document without schemaVersion', () => {
    const { problems, doc } = normalizeDocument({ stages: {} })
    assert.ok(problems.some((p) => p.code === 'doc.schema_version_missing'))
    assert.equal(doc, null)
  })

  it('rejects future schema versions', () => {
    const { problems, doc } = normalizeDocument({ ...defaultDocument(), schemaVersion: 999 })
    assert.ok(problems.some((p) => p.code === 'doc.schema_version_future'))
    assert.equal(doc, null)
  })

  it('rejects a binding without provider', () => {
    const doc = defaultDocument()
    doc.stages.default!.binding = { provider: '', model: 'm1' }
    const { problems } = normalizeDocument(doc)
    assert.ok(problems.some((p) => p.code === 'binding.provider_required'))
  })

  it('rejects an invalid reasoningEffort type', () => {
    const doc = defaultDocument()
    ;(doc.stages.default!.binding as unknown) = { provider: 'p', model: 'm', reasoningEffort: 42 }
    const { problems } = normalizeDocument(doc)
    assert.ok(problems.some((p) => p.code === 'binding.effort_invalid'))
  })

  it('accepts a valid stage binding with effort and budget', () => {
    const doc = defaultDocument()
    doc.stages.default!.binding = {
      provider: 'p',
      model: 'm',
      reasoningEffort: 'high',
      thinkingBudget: 4096,
    }
    const { problems, doc: out } = normalizeDocument(doc)
    assert.deepEqual(problems, [])
    assert.equal(out!.stages.default!.binding!.reasoningEffort, 'high')
    assert.equal(out!.stages.default!.binding!.thinkingBudget, 4096)
  })

  it('rejects a follow cycle', () => {
    const doc = defaultDocument()
    doc.stages.planning = { follow: 'subagent' }
    doc.stages.subagent = { follow: 'planning' }
    const { problems } = normalizeDocument(doc)
    assert.ok(problems.some((p) => p.code === 'stage.follow_cycle'))
  })

  it('validates profiles and activeProfile references', () => {
    const doc = defaultDocument()
    doc.profiles = {
      fast: {
        id: 'fast',
        label: '快速日常',
        stages: {
          default: { provider: 'p', model: 'fast' },
          planning: { provider: 'p', model: 'fast' },
          subagent: { provider: 'p', model: 'fast' },
          evaluation: { provider: 'p', model: 'fast' },
        },
      },
    }
    doc.activeProfile = 'fast'
    const { problems } = normalizeDocument(doc)
    assert.deepEqual(problems, [])
  })

  it('resets activeProfile when it points at a missing profile', () => {
    const doc = defaultDocument()
    doc.activeProfile = 'nope'
    const { problems, doc: out } = normalizeDocument(doc)
    assert.ok(problems.some((p) => p.code === 'doc.active_profile_missing'))
    assert.equal(out!.activeProfile, null)
  })
})

describe('model-config catalog validation', () => {
  const catalog = {
    providers: [
      {
        id: 'deepseek',
        models: ['deepseek-v4-flash', 'deepseek-r2'],
        efforts: {
          'deepseek-v4-flash': [
            { id: 'low', label: '低' },
            { id: 'high', label: '高' },
          ],
        },
      },
    ],
  }

  it('accepts a known provider/model/effort', () => {
    assert.deepEqual(
      validateBindingAgainstCatalog(
        { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
        catalog,
      ),
      [],
    )
  })

  it('rejects an unknown provider', () => {
    const p = validateBindingAgainstCatalog({ provider: 'openai', model: 'gpt-x' }, catalog)
    assert.ok(p.some((x) => x.code === 'catalog.provider_unknown'))
  })

  it('rejects an unknown model on a known provider', () => {
    const p = validateBindingAgainstCatalog({ provider: 'deepseek', model: 'ghost' }, catalog)
    assert.ok(p.some((x) => x.code === 'catalog.model_unknown'))
  })

  it('rejects an effort the model does not publish', () => {
    const p = validateBindingAgainstCatalog(
      { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'ultra' },
      catalog,
    )
    assert.ok(p.some((x) => x.code === 'catalog.effort_unknown'))
  })

  it('passes through with a null catalog (unverified)', () => {
    assert.deepEqual(validateBindingAgainstCatalog({ provider: 'anything', model: 'x' }, null), [])
  })
})

describe('model-config resolver', () => {
  function docWith(partial: Partial<ModelConfigDocument> = {}): ModelConfigDocument {
    return { ...defaultDocument(), ...partial }
  }

  it('default stage falls back to engine default, then null', () => {
    const doc = docWith()
    assert.deepEqual(resolveStage('default', { doc, engineDefault: null }), null)
    assert.deepEqual(
      resolveStage('default', { doc, engineDefault: { provider: 'p', model: 'engine-default' } }),
      {
        provider: 'p',
        model: 'engine-default',
      },
    )
  })

  it('follow chain: planning inherits default binding', () => {
    const doc = docWith()
    doc.stages.default = { follow: null, binding: { provider: 'p', model: 'main' } }
    doc.stages.planning = { follow: 'default' }
    assert.deepEqual(resolveStage('planning', { doc }), { provider: 'p', model: 'main' })
  })

  it('stage own binding wins over the follow target', () => {
    const doc = docWith()
    doc.stages.default = { follow: null, binding: { provider: 'p', model: 'main' } }
    doc.stages.planning = { follow: 'default', binding: { provider: 'p', model: 'planner' } }
    assert.deepEqual(resolveStage('planning', { doc }), { provider: 'p', model: 'planner' })
  })

  it('active profile wins over stage own binding', () => {
    const doc = docWith()
    doc.stages.planning = { follow: 'default', binding: { provider: 'p', model: 'own' } }
    doc.profiles = {
      fast: {
        id: 'fast',
        label: '快速',
        stages: {
          default: { provider: 'p', model: 'pf' },
          planning: { provider: 'p', model: 'pp' },
          subagent: { provider: 'p', model: 'pf' },
          evaluation: { provider: 'p', model: 'pf' },
        },
      },
    }
    doc.activeProfile = 'fast'
    assert.deepEqual(resolveStage('planning', { doc }), { provider: 'p', model: 'pp' })
  })

  it('session selection overrides everything', () => {
    const doc = docWith()
    doc.profiles = {
      fast: {
        id: 'fast',
        label: '快速',
        stages: {
          default: { provider: 'p', model: 'pf' },
          planning: { provider: 'p', model: 'pp' },
          subagent: { provider: 'p', model: 'pf' },
          evaluation: { provider: 'p', model: 'pf' },
        },
      },
    }
    doc.activeProfile = 'fast'
    assert.deepEqual(
      resolveStage('planning', { doc, sessionSelection: { provider: 'p', model: 'session-pick' } }),
      { provider: 'p', model: 'session-pick' },
    )
  })

  it('resolveStages returns only stages with a binding', () => {
    const doc = docWith()
    doc.stages.default = { follow: null, binding: { provider: 'p', model: 'main' } }
    const out = resolveStages({ doc })
    assert.deepEqual(Object.keys(out).sort(), ['default', 'evaluation', 'planning', 'subagent'])
    for (const stage of Object.keys(out) as (keyof typeof out)[]) {
      assert.deepEqual(out[stage], { provider: 'p', model: 'main' })
    }
  })
})
