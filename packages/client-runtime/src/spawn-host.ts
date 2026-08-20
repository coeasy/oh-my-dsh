import { spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertLoopbackUrl } from './loopback.ts'
import { assertLauncherUsable, resolveDirectSpawn } from './launcher-check.ts'
import { assertAbsolutePluginPath, assertSafeReadyPath } from './paths.ts'
import { spawnArgv, buildWebArgs, normalizeDshCommand, quoteWinArg } from './spawn-args.ts'
import { buildPatchYaml } from './patch.ts'
import { parseReadyFile, parseStdoutUrl, urlToPort } from './parse.ts'
import { defaultCacheDir, resolveRuntime, resolveRuntimeMode } from './resolve-runtime.ts'
import { ensureDownloadedRuntime } from './download.ts'
import { shutdownLadder, killProcessTree, killExecutable, engineStopPlan } from './shutdown.ts'
import type { ChildLike, LaunchOptions, RunningHost } from './types.ts'

const DEFAULT_OUTPUT_TAIL_BYTES = 256 * 1024
const DEFAULT_LOG_BYTES = 5 * 1024 * 1024
const LOG_BACKUPS = 3

export function appendOutputTail(current: string, next: string, maxBytes: number): string {
  const combined = `${current}${next}`
  if (Buffer.byteLength(combined, 'utf8') <= maxBytes) return combined
  return Buffer.from(combined, 'utf8').subarray(-maxBytes).toString('utf8')
}

export function rotateLogFile(path: string, maxBytes = DEFAULT_LOG_BYTES): void {
  try {
    if (!existsSync(path) || statSync(path).size < maxBytes) return
    rmSync(`${path}.${LOG_BACKUPS}`, { force: true })
    for (let index = LOG_BACKUPS - 1; index >= 1; index -= 1) {
      const from = `${path}.${index}`
      if (existsSync(from)) renameSync(from, `${path}.${index + 1}`)
    }
    renameSync(path, `${path}.1`)
  } catch {
    // Logging must never block Harness startup.
  }
}

function defaultPluginPath(): string {
  const compiled = fileURLToPath(
    new URL('../../../plugins/embedded-client/out/index.js', import.meta.url),
  )
  if (existsSync(compiled)) return compiled
  return fileURLToPath(new URL('../../../plugins/embedded-client/src/index.ts', import.meta.url))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function reapEngineProcess(
  child: ChildLike & { pid?: number },
  execPath: string | undefined,
): Promise<void> {
  if (engineStopPlan() === 'tree-kill') {
    if (child.pid) killProcessTree(child.pid)
    if (execPath) killExecutable(execPath)
    return
  }
  await shutdownLadder(child)
  if (child.pid) killProcessTree(child.pid)
  if (execPath) killExecutable(execPath)
}

function closeLog(stream: ReturnType<typeof createWriteStream> | undefined): Promise<void> {
  if (!stream) return Promise.resolve()
  return new Promise((resolve) => {
    stream.end(() => resolve())
  })
}

export async function waitForReady(options: {
  readyFile: string
  stdoutBuffer: { text: string }
  timeoutMs: number
  readFile?: (path: string) => string
  isDead?: () => { dead: boolean; detail?: string }
}): Promise<{ url: string; port: number }> {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const start = Date.now()
  while (Date.now() - start < options.timeoutMs) {
    try {
      const payload = parseReadyFile(readFile(options.readyFile))
      return { url: payload.url, port: payload.port }
    } catch {
      const fromStdout = parseStdoutUrl(options.stdoutBuffer.text)
      if (fromStdout) return { url: fromStdout, port: urlToPort(fromStdout) }
    }
    const dead = options.isDead?.()
    if (dead?.dead) {
      const tail = options.stdoutBuffer.text.trim().slice(-1500)
      throw new Error(
        `dsh web exited before ready${dead.detail ? `: ${dead.detail}` : ''}${tail ? `\n${tail}` : ''}`,
      )
    }
    await wait(50)
  }
  const fromStdout = parseStdoutUrl(options.stdoutBuffer.text)
  if (fromStdout) return { url: fromStdout, port: urlToPort(fromStdout) }
  const tail = options.stdoutBuffer.text.trim().slice(-1500)
  throw new Error(
    `dsh web did not become ready within ${options.timeoutMs}ms${tail ? `\n${tail}` : ''}`,
  )
}

export async function launchHost(options: LaunchOptions): Promise<RunningHost> {
  const report = options.onProgress
  const env: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env),
  }
  report?.('resolving')
  const mode = resolveRuntimeMode(options.mode, env)
  const resolved =
    mode === 'download'
      ? {
          mode,
          command: await ensureDownloadedRuntime({
            url: options.downloadUrl || env.DSH_RUNTIME_URL || '',
            cacheDir: options.cacheDir || defaultCacheDir(env),
            openWriteStream: (path: string) => createWriteStream(path),
            onProgress: (stage: 'download-started' | 'downloaded') => {
              if (stage === 'download-started') report?.('downloading')
            },
          }),
        }
      : resolveRuntime({
          mode,
          dshCommand: options.dshCommand,
          env,
        })
  const readyFile = assertSafeReadyPath(
    options.readyFile || join(mkdtempSync(join(tmpdir(), 'dsh-ready-')), 'ready.json'),
  )
  writeFileSync(readyFile, '', 'utf8')
  const generatedDir = mkdtempSync(join(tmpdir(), 'dsh-patch-'))
  const pluginPath = assertAbsolutePluginPath(options.pluginPath || defaultPluginPath())
  const patchPath = options.patchPath || join(generatedDir, 'cordis.patch.yml')
  if (!options.patchPath) {
    writeFileSync(patchPath, buildPatchYaml(pluginPath), 'utf8')
  }
  const webArgs = buildWebArgs(patchPath, options.extraArgs)
  env.DSH_READY_FILE = readyFile
  env.DSH_WORKSPACE_CWD = options.workspaceCwd
  const command = normalizeDshCommand(resolved.command)
  const launcherIo = {
    exists: existsSync,
    read: (path: string) => readFileSync(path, 'utf8'),
  }
  assertLauncherUsable(command, launcherIo)
  const direct = resolveDirectSpawn(command, launcherIo)
  report?.('spawning')
  const child = direct
    ? spawn(direct.exec, [...direct.prefixArgs, ...webArgs], {
        cwd: options.workspaceCwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        detached: false,
      })
    : spawn(process.platform === 'win32' ? quoteWinArg(command) : command, spawnArgv(webArgs), {
        cwd: options.workspaceCwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        windowsVerbatimArguments: process.platform === 'win32',
        windowsHide: true,
        detached: false,
      })
  const stdoutBuffer = { text: '' }
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_TAIL_BYTES
  const logStream = options.logPath
    ? (mkdirSync(dirname(options.logPath), { recursive: true }),
      rotateLogFile(options.logPath, options.maxLogBytes),
      createWriteStream(options.logPath, { flags: 'a' }))
    : undefined
  const appendLog = (source: 'stdout' | 'stderr', chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stdoutBuffer.text = appendOutputTail(stdoutBuffer.text, text, maxOutputBytes)
    logStream?.write(`[${source}] ${text}`)
  }
  child.stdout?.on('data', (buf: Buffer) => appendLog('stdout', buf))
  child.stderr?.on('data', (buf: Buffer) => appendLog('stderr', buf))
  let spawnErr: Error | undefined
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined
  child.once('error', (err) => {
    spawnErr = err
  })
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal }
  })
  const timeoutMs = options.readyTimeoutMs ?? 30_000
  try {
    report?.('waiting-ready')
    const ready = await waitForReady({
      readyFile,
      stdoutBuffer,
      timeoutMs,
      isDead: () => {
        if (spawnErr) return { dead: true, detail: spawnErr.message }
        if (exitInfo) return { dead: true, detail: `exit ${exitInfo.code ?? exitInfo.signal}` }
        return { dead: false }
      },
    })
    assertLoopbackUrl(ready.url)
    report?.('ready', ready.url)
    return {
      url: ready.url,
      port: ready.port,
      pid: child.pid ?? 0,
      execPath: direct?.exec,
      async stop() {
        await reapEngineProcess(child as ChildLike, direct?.exec)
        await closeLog(logStream)
        try {
          rmSync(readyFile, { force: true })
          rmSync(generatedDir, { recursive: true, force: true })
        } catch {
          // ignore
        }
      },
    }
  } catch (err) {
    await reapEngineProcess(child as ChildLike, direct?.exec)
    await closeLog(logStream)
    throw err
  }
}
