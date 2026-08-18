import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildHarnessSpawnOptions,
  formatExitCode,
  parseDotEnv,
  resolveSidecarDotEnvPath,
  sanitizeBundledSpawnEnv,
} from '../src/harness-env.ts'

describe('Harness launch environment', () => {
  it('persists DSH_HOME and strips ELECTRON_RUN_AS_NODE', () => {
    const options = buildHarnessSpawnOptions(
      'C:\\Users\\tester\\AppData\\Roaming\\dsh-client-desktop\\launch-root',
      'C:\\Users\\tester\\AppData\\Roaming\\dsh-client-desktop\\harness',
      'win32',
      {
        ELECTRON_RUN_AS_NODE: '1',
        PATH: 'fallback-path',
        Path: 'windows-path',
      },
      { DEEPSEEK_API_KEY: 'from-sidecar' },
    )
    assert.equal(options.env?.DEEPSEEK_API_KEY, 'from-sidecar')
    assert.equal(
      options.cwd,
      'C:\\Users\\tester\\AppData\\Roaming\\dsh-client-desktop\\launch-root',
    )
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe'])
    assert.equal(options.windowsHide, true)
    assert.equal(
      options.env?.DSH_HOME,
      'C:\\Users\\tester\\AppData\\Roaming\\dsh-client-desktop\\harness',
    )
    assert.equal(options.env?.NO_COLOR, '1')
    assert.equal(options.env?.Path, 'windows-path')
    assert.equal(options.env?.ELECTRON_RUN_AS_NODE, undefined)
  })

  it('parses dotenv sidecars and does not override a set environment key', () => {
    const parsed = parseDotEnv('# comment\nDEEPSEEK_API_KEY=sk-test\nEMPTY=\n')
    assert.equal(parsed.DEEPSEEK_API_KEY, 'sk-test')
    const options = buildHarnessSpawnOptions(
      'C:\\tmp\\launch',
      'C:\\tmp\\home',
      'win32',
      { Path: 'windows-path', DEEPSEEK_API_KEY: 'from-env' },
      { DEEPSEEK_API_KEY: 'from-sidecar' },
    )
    assert.equal(options.env?.DEEPSEEK_API_KEY, 'from-env')
  })

  it('reads the sidecar next to a portable SFX, not the extracted temp exe', () => {
    assert.equal(
      resolveSidecarDotEnvPath(
        'C:\\Users\\tester\\AppData\\Local\\Temp\\DeepSeek Harness',
        'D:\\usb',
      ),
      'D:\\usb\\.env',
    )
    assert.equal(resolveSidecarDotEnvPath('D:\\app'), 'D:\\app\\.env')
  })

  it('drops DSH_RUNTIME and DSH_BIN so a packaged exe cannot spawn PATH dsh', () => {
    const env = sanitizeBundledSpawnEnv({
      DSH_RUNTIME: 'local',
      DSH_BIN: 'D:\\workspace\\deepseek_hre\\dsh.cmd',
      Path: 'windows-path',
    })
    assert.equal(env.DSH_RUNTIME, undefined)
    assert.equal(env.DSH_BIN, undefined)
    assert.equal(env.Path, 'windows-path')
  })

  it('makes native Windows termination codes diagnosable', () => {
    assert.match(formatExitCode(4294930435), /0xFFFF7003, Crashpad handler unavailable/)
  })
})
