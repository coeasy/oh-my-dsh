export type RuntimeMode = 'local' | 'download' | 'bundled'

/**
 * Launch lifecycle stages, reported through `LaunchOptions.onProgress` so
 * hosts can surface a real progress indicator instead of a black-box wait.
 */
export type LaunchStage = 'resolving' | 'downloading' | 'spawning' | 'waiting-ready' | 'ready'

export interface LaunchOptions {
  workspaceCwd: string
  mode?: RuntimeMode
  patchPath?: string
  /** Absolute path to the embedded-client module. Required for --patch overlays (not an npm name). */
  pluginPath?: string
  dshCommand?: string
  readyFile?: string
  readyTimeoutMs?: number
  cacheDir?: string
  downloadUrl?: string
  extraArgs?: string[]
  env?: NodeJS.ProcessEnv
  /** Append child stdout/stderr when set. */
  logPath?: string
  /** Stage progress callback (resolving → downloading → spawning → waiting-ready → ready). */
  onProgress?: (stage: LaunchStage, detail?: string) => void
}

export interface ReadyPayload {
  url: string
  host: string
  port: number
  pid: number
  workspaceCwd?: string
}

export interface RunningHost {
  url: string
  port: number
  pid: number
  /** Absolute node/electron image used for a direct spawn, when known. */
  execPath?: string
  stop(): Promise<void>
}

export interface ChildLike {
  pid?: number
  stdin?: { end(): void } | null
  killed?: boolean
  exitCode?: number | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
}
