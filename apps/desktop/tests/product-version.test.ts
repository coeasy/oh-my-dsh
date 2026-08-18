import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { assertAlignedVersions, loadProductVersion } from '../../../scripts/product-version.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('product version', () => {
  it('pins the unofficial client pack at 0.1.0 across every workspace package', () => {
    assert.equal(loadProductVersion(root), '0.1.0')
    assert.equal(assertAlignedVersions(root), '0.1.0')
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
    assert.match(changelog, /^## 0\.1\.0$/m)
    assert.doesNotMatch(changelog, /^## 0\.2\.0$/m)
  })
})
