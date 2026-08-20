import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

const pathFor = (platform: NodeJS.Platform | undefined) =>
  (platform ?? process.platform) === 'win32' ? win32 : posix

export type RuntimeMode = 'local' | 'download'

export type VscodeLaunchMode = RuntimeMode | 'bundled'

export interface VscodeEngineLaunch {
  mode: VscodeLaunchMode
  dshCommand?: string
  cloneBin?: string
}

/** Installed VSIX defaults to download; F5 / development stays local unless the user set the setting. */
export function resolveVscodeRuntimeMode(input: {
  production: boolean
  configured?: RuntimeMode
}): RuntimeMode {
  if (input.configured) return input.configured
  return input.production ? 'download' : 'local'
}

/**
 * F5 prefers `runtime/stage` then the gitignored clone so PATH `dsh` cannot
 * point at an old workspace. An explicit setting still wins.
 */
export function resolveVscodeEngineLaunch(input: {
  production: boolean
  configured?: RuntimeMode
  repoRoot: string
  exists?: (path: string) => boolean
  platform?: NodeJS.Platform
}): VscodeEngineLaunch {
  if (input.configured) return { mode: input.configured }
  if (input.production) return { mode: 'download' }
  const exists = input.exists ?? existsSync
  const platform = input.platform ?? process.platform
  const join = pathFor(platform)
  const name = platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const staged = join.join(input.repoRoot, 'runtime', 'stage', name)
  if (exists(staged)) return { mode: 'bundled', dshCommand: staged }
  const cloneBin = join.join(input.repoRoot, 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
  if (exists(cloneBin)) {
    return {
      mode: 'bundled',
      dshCommand: join.join(input.repoRoot, 'runtime', 'dev', name),
      cloneBin,
    }
  }
  return { mode: 'local' }
}
