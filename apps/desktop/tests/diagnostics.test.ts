import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildDiagnosticsReport } from '../src/diagnostics.ts'

describe('diagnostics report', () => {
  it('redacts keys in the log tail', () => {
    const report = buildDiagnosticsReport({
      appVersion: '0.1.0',
      engineRef: 'master',
      workspace: 'D:\\proj',
      packaged: true,
      logTail: 'DEEPSEEK_API_KEY=sk-live\nready',
    })
    assert.match(report, /appVersion=0\.1\.0/)
    assert.match(report, /engineRef=master/)
    assert.match(report, /DEEPSEEK_API_KEY=\*\*\*/)
    assert.doesNotMatch(report, /sk-live/)
  })
})
