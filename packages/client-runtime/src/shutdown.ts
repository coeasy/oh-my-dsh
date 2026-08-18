import { spawnSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { ChildLike } from './types.ts'

export interface ShutdownOptions {
  eofGraceMs?: number
  termGraceMs?: number
  wait?: (ms: number) => Promise<void>
}

const DEFAULT_EOF_GRACE_MS = 6000
const DEFAULT_TERM_GRACE_MS = 3000

function waitForExit(child: ChildLike): Promise<void> {
  if (child.killed || child.exitCode != null) return Promise.resolve()
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True when two executable paths name the same image after slash and case folding. */
export function sameExecutablePath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase()
}

/**
 * Windows must tree-kill while the parent is still alive. Waiting on stdin EOF
 * or a fake SIGTERM orphans Cordis workers, and later `taskkill /T` cannot see them.
 *
 * @param platform Host platform
 */
export function engineStopPlan(platform = process.platform): 'tree-kill' | 'ladder-then-tree' {
  return platform === 'win32' ? 'tree-kill' : 'ladder-then-tree'
}

export function killProcessTree(pid: number, platform = process.platform): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 5_000,
    })
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

/**
 * Kill leftover processes whose executable path matches `imagePath`.
 * Never targets the current process image (Electron / the test runner).
 *
 * @param imagePath Absolute path of the engine `node` image
 * @param platform Host platform
 * @param selfPath Current process image; matching paths are ignored
 */
export function killExecutable(
  imagePath: string,
  platform = process.platform,
  selfPath = process.execPath,
): void {
  const raw = String(imagePath || '').trim()
  if (!raw || !isAbsolute(raw) || sameExecutablePath(raw, selfPath)) return
  if (platform === 'win32') {
    // Scanning every process by image path blocks Electron's UI thread
    // (and can hang past spawnSync timeouts). Windows uses taskkill /T
    // against the recorded engine pid instead.
    return
  }
  spawnSync('pkill', ['-KILL', '-f', `^${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($| )`], {
    stdio: 'ignore',
    timeout: 4_000,
  })
}

export async function shutdownLadder(
  child: ChildLike,
  options: ShutdownOptions = {},
): Promise<void> {
  const eofGraceMs = options.eofGraceMs ?? DEFAULT_EOF_GRACE_MS
  const termGraceMs = options.termGraceMs ?? DEFAULT_TERM_GRACE_MS
  const wait = options.wait ?? sleep

  const exited = waitForExit(child)
  try {
    child.stdin?.end()
  } catch {
    // ignore
  }
  await Promise.race([exited, wait(eofGraceMs)])
  if (child.killed || child.exitCode != null) return

  try {
    child.kill('SIGTERM')
  } catch {
    // ignore
  }
  await Promise.race([exited, wait(termGraceMs)])
  if (child.killed || child.exitCode != null) return

  try {
    child.kill('SIGKILL')
  } catch {
    // ignore
  }
  await exited
}
