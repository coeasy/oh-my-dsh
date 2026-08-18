import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { defaultEngineRoot, ENGINE_CLONE_DIRNAME } from '../../../scripts/engine-root.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('engine clone root', () => {
  it('defaults to a gitignored directory at the repository root', () => {
    assert.equal(ENGINE_CLONE_DIRNAME, 'deepseek-harness')
    assert.equal(defaultEngineRoot(root, {}), join(root, 'deepseek-harness'))
  })

  it('honors DSH_ENGINE_ROOT', () => {
    assert.equal(
      defaultEngineRoot(root, { DSH_ENGINE_ROOT: 'D:\\tmp\\harness-clone' }),
      'D:\\tmp\\harness-clone',
    )
  })
})
