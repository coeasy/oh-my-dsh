import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPatchYaml, toPatchModuleName } from '../src/patch.ts'

describe('patch overlay', () => {
  it('uses a file: URL module specifier, not an npm package name', () => {
    const yaml = buildPatchYaml(
      'D:\\workspace\\deepseek_hre\\plugins\\embedded-client\\out\\index.js',
    )
    assert.equal(
      toPatchModuleName('D:\\workspace\\deepseek_hre\\plugins\\embedded-client\\out\\index.js'),
      'file:///D:/workspace/deepseek_hre/plugins/embedded-client/out/index.js',
    )
    assert.match(
      yaml,
      /name: "file:\/\/\/D:\/workspace\/deepseek_hre\/plugins\/embedded-client\/out\/index.js"/,
    )
    assert.doesNotMatch(yaml, /@dsh\/plugin-embedded-client/)
    assert.match(yaml, /host: 127\.0\.0\.1/)
    assert.match(yaml, /port: 0/)
    assert.match(yaml, /!!js process\.env\.DSH_READY_FILE/)
  })

  it('rejects an empty plugin path', () => {
    assert.throws(() => buildPatchYaml(''), /empty/)
  })

  it('rejects an npm package name', () => {
    assert.throws(() => buildPatchYaml('@dsh/plugin-embedded-client'), /npm package/)
    assert.throws(() => buildPatchYaml('./src/index.ts'), /absolute/)
  })
})
