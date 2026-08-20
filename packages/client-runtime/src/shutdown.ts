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
  if (platform === 'win32') return
  spawnSync('pkill', ['-KILL', '-f', `^${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($| )`], {
    stdio: 'ignore',
    timeout: 4_000,
  })
}

/**
 * Strong reap: kill every live process whose command line matches any of the
 * given patterns. This closes the "orphaned / reparented worker" gap that
 * taskkill /T cannot reach (detached or reparented processes are not part of
 * the engine pid tree). Patterns are anchored to our own artifacts
 * (e.g. `bin.js` + dsh, `plugin-marketplace`) to keep the blast radius tight.
 *
 * Windows enumerates processes via wmic, falling back to PowerShell
 * `Get-CimInstance` on hosts where wmic has been removed (Win11 24H2+).
 *
 * @param patterns Command-line substring patterns; a matching process is killed.
 * @param platform Host platform
 * @param selfPid Current process pid; matching pids are ignored.
 * @param run Pluggable sync runner (tests); defaults to spawnSync.
 */
export function killMatchingProcesses(
  patterns: ReadonlyArray<string>,
  platform = process.platform,
  selfPid = process.pid,
  run: typeof spawnSync = spawnSync,
): void {
  if (patterns.length === 0) return
  if (platform === 'win32') {
    // Enumerate node/dsh/cmd processes with their command lines via wmic,
    // kill every match (excluding self). spawnSync keeps this off the event
    // loop and bounded by timeout.
    const wmic = run(
      'wmic',
      [
        'process',
        'where',
        "name='node.exe' or name='dsh.exe' or name='dsh.cmd' or name='cmd.exe' or name='pnpm.exe' or name='git.exe'",
        'get',
        'ProcessId,CommandLine',
        '/format:csv',
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 8_000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    if (wmic.status === 0 && wmic.stdout) {
      reapWindowsMatches(wmic.stdout, patterns, selfPid, run, parseWmicLine)
      return
    }
    // wmic is deprecated and removed on recent Windows builds — fall back to
    // PowerShell CIM, emitting "pid<TAB>commandline" lines.
    const ps = run(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Where-Object { $_.Name -match \'^(node|dsh|cmd|pnpm|git)(\\.exe|\\.cmd)?$\' } | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    if (ps.status === 0 && ps.stdout) {
      reapWindowsMatches(ps.stdout, patterns, selfPid, run, parseTsvLine)
    }
    return
  }
  for (const pattern of patterns) {
    run('pkill', ['-KILL', '-f', pattern], { stdio: 'ignore', timeout: 4_000 })
  }
}

/**
 * wmic CSV rows: `host,"command line",pid` (verified live: columns are
 * Node,CommandLine,ProcessId with the pid last). Strip the trailing pid, then
 * everything after the host's comma is the command line (outer quotes removed).
 */
function parseWmicLine(line: string): { pid: number; cmd: string } | undefined {
  const match = line.match(/,([0-9]+)\s*$/)
  if (!match || match.index === undefined) return undefined
  const pid = Number.parseInt(match[1], 10)
  const rest = line.slice(0, match.index)
  const firstComma = rest.indexOf(',')
  let cmd = firstComma >= 0 ? rest.slice(firstComma + 1) : rest
  cmd = cmd.trim().replace(/^"/, '').replace(/"$/, '')
  return { pid, cmd }
}

/** PowerShell TSV rows: `pid\tcommand line` → { pid, cmd }. */
function parseTsvLine(line: string): { pid: number; cmd: string } | undefined {
  const tab = line.indexOf('\t')
  if (tab <= 0) return undefined
  const pid = Number.parseInt(line.slice(0, tab), 10)
  if (!Number.isInteger(pid)) return undefined
  return { pid, cmd: line.slice(tab + 1) }
}

/** Parse enumeration output and taskkill every matching pid (excluding self). */
function reapWindowsMatches(
  stdout: string,
  patterns: ReadonlyArray<string>,
  selfPid: number,
  run: typeof spawnSync,
  parseLine: (line: string) => { pid: number; cmd: string } | undefined,
): void {
  // Windows command lines use backslashes while our anchored artifact
  // patterns are written with forward slashes — normalize both sides.
  const norm = (value: string): string => value.replace(/\\/g, '/')
  for (const line of stdout.split(/\r?\n/)) {
    const row = parseLine(line)
    if (!row) continue
    if (!Number.isInteger(row.pid) || row.pid <= 0 || row.pid === selfPid) continue
    const cmd = norm(row.cmd)
    if (patterns.some((p) => cmd.includes(norm(p)))) {
      run('taskkill', ['/pid', String(row.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5_000,
      })
    }
  }
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
