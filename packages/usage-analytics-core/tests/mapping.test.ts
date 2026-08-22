import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyUsageMapping,
  isValidPath,
  validateMappingConfig,
  resolvePath,
} from '../src/mapping.ts'

const openaiLike = {
  usage: {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    prompt_tokens_details: { cached_tokens: 8 },
  },
}

const anthropicLike = {
  usage: {
    input_tokens: 20,
    output_tokens: 9,
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: 7,
  },
}

describe('isValidPath', () => {
  it('accepts plain and nested paths', () => {
    assert.equal(isValidPath('$'), true)
    assert.equal(isValidPath('$.usage.prompt_tokens'), true)
    assert.equal(isValidPath('$.usage.prompt_tokens_details.cached_tokens'), true)
  })
  it('accepts index and wildcard brackets', () => {
    assert.equal(isValidPath('$.choices[0].usage'), true)
    assert.equal(isValidPath('$.list[*].x'), true)
  })
  it('rejects unsafe paths', () => {
    assert.equal(isValidPath('usage.prompt_tokens'), false) // no leading $
    assert.equal(isValidPath('$.a..b'), false)
    assert.equal(isValidPath('$.a[b]'), false) // need dot before bracket
    assert.equal(isValidPath('$.a[0]x'), false)
    assert.equal(isValidPath('$..'), false)
    assert.equal(isValidPath(''), false)
  })
})

describe('resolvePath', () => {
  it('resolves nested object', () => {
    assert.equal(resolvePath(openaiLike, '$.usage.prompt_tokens'), 10)
    assert.equal(resolvePath(openaiLike, '$.usage.prompt_tokens_details.cached_tokens'), 8)
  })
  it('resolves array index', () => {
    const v = { choices: [{ message: { x: 3 } }, { message: { x: 4 } }] }
    assert.equal(resolvePath(v, '$.choices[1].message.x'), 4)
  })
  it('returns undefined for missing', () => {
    assert.equal(resolvePath(openaiLike, '$.usage.nope'), undefined)
  })
})

describe('applyUsageMapping', () => {
  it('maps openai-style fields', () => {
    const r = applyUsageMapping(openaiLike, {
      id: 'openai',
      match: {},
      usage: {
        input_tokens: ['$.usage.prompt_tokens', '$.usage.input_tokens'],
        output_tokens: ['$.usage.completion_tokens', '$.usage.output_tokens'],
        total_tokens: ['$.usage.total_tokens'],
        cache_read_tokens: ['$.usage.prompt_tokens_details.cached_tokens'],
      },
      streaming: { strategy: 'final_usage_preferred' },
    })
    assert.deepEqual(r.found, {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      cache_read_tokens: 8,
    })
    assert.deepEqual(r.missing, [])
  })

  it('maps anthropic-style fields', () => {
    const r = applyUsageMapping(anthropicLike, {
      id: 'anthropic',
      match: {},
      usage: {
        input_tokens: ['$.usage.prompt_tokens', '$.usage.input_tokens'],
        output_tokens: ['$.usage.completion_tokens', '$.usage.output_tokens'],
        cache_read_tokens: ['$.usage.cache_read_input_tokens'],
        cache_creation_tokens: ['$.usage.cache_creation_input_tokens'],
      },
      streaming: { strategy: 'final_usage_preferred' },
    })
    assert.equal(r.found.input_tokens, 20)
    assert.equal(r.found.output_tokens, 9)
    assert.equal(r.found.cache_read_tokens, 7)
    assert.equal(r.found.cache_creation_tokens, 3)
  })

  it('marks missing fields as missing (unknown)', () => {
    const r = applyUsageMapping(openaiLike, {
      id: 'openai',
      match: {},
      usage: {
        input_tokens: ['$.usage.prompt_tokens'],
        cache_write_tokens: ['$.usage.cache_write_tokens'],
      },
      streaming: { strategy: 'final_usage_preferred' },
    })
    assert.equal(r.found.input_tokens, 10)
    assert.deepEqual(r.missing, ['cache_write_tokens'])
  })

  it('falls back to second candidate', () => {
    const r = applyUsageMapping(openaiLike, {
      id: 'x',
      match: {},
      usage: { input_tokens: ['$.usage.nope', '$.usage.prompt_tokens'] },
      streaming: { strategy: 'final_usage_preferred' },
    })
    assert.equal(r.found.input_tokens, 10)
  })
})

describe('validateMappingConfig', () => {
  it('accepts a valid declarative config', () => {
    assert.deepEqual(validateMappingConfig({
      id: 'p',
      usage: { input_tokens: ['$.usage.prompt_tokens'] },
      streaming: { strategy: 'final_usage_preferred' },
    }), [])
  })
  it('rejects executable fields', () => {
    const problems = validateMappingConfig({ id: 'p', usage: {}, code: 'evil()' })
    assert.ok(problems.some((p) => p.includes('executable')))
  })
  it('rejects invalid path', () => {
    const problems = validateMappingConfig({ id: 'p', usage: { input_tokens: ['not-a-path'] } })
    assert.ok(problems.some((p) => p.includes('invalid path')))
  })
})
