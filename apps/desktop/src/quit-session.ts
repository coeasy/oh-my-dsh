import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { posix, win32, join } from 'node:path'
import type { RuntimeSnapshot } from './contracts.ts'

/** Wall-clock budget before the desktop shell force-kills leftover engine processes. */
export const QUIT_BUDGET_MS = 2000

/** Packaged extraResources `runtime/node.exe` (or `runtime/node` on POSIX). */
export function bundledRuntimeNodePath(resourcesPath: string, platform = process.platform): string {
  const path = platform === 'win32' ? win32 : posix
  return path.join(resourcesPath, 'runtime', platform === 'win32' ? 'node.exe' : 'node')
}

/** Snapshot published while the shell is tearing down the engine. */
export function stoppingSnapshot(locale: 'en' | 'zh', launchDirectory?: string): RuntimeSnapshot {
  return {
    phase: 'stopping',
    message: locale === 'zh' ? '正在退出…' : 'Stopping…',
    logs: [],
    launchDirectory,
  }
}

/** Pid file for the last bundled engine so the next launch can taskkill it without PowerShell. */
export function enginePidFile(userDataPath: string): string {
  return join(userDataPath, 'engine.pid')
}

/** Persist the live engine pid for the next cold start. */
export function writeEnginePid(userDataPath: string, pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  writeFileSync(enginePidFile(userDataPath), `${pid}\n`, 'utf8')
}

/** Remove the engine pid file after a clean stop. */
export function clearEnginePid(userDataPath: string): void {
  rmSync(enginePidFile(userDataPath), { force: true })
}

/** Read a previously recorded engine pid, or `0` when missing. */
export function readEnginePid(userDataPath: string): number {
  const file = enginePidFile(userDataPath)
  if (!existsSync(file)) return 0
  const pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10)
  return Number.isInteger(pid) && pid > 0 ? pid : 0
}
