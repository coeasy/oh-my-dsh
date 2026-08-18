import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, posix, win32 } from 'node:path'

export interface DirectSpawn {
  /** Absolute `node` / Electron image. */
  exec: string
  /** Engine entry, typically `bin.js`. */
  prefixArgs: string[]
}

export interface LauncherIo {
  exists: (path: string) => boolean
  read: (path: string) => string
}

/** Quoted absolute paths inside a Windows `.cmd` wrapper. */
export function quotedWinPaths(text: string): string[] {
  const matches = String(text || '').matchAll(/"([^"\r\n]+)"/gu)
  return [...matches].map((match) => match[1])
}

export function buildWinDevLauncher(nodePath: string, binPath: string): string {
  return `@echo off\r\n"${nodePath}" "${binPath}" %*\r\n`
}

export function buildPosixDevLauncher(nodePath: string, binPath: string): string {
  return `#!/bin/sh\nexec "${nodePath}" "${binPath}" "$@"\n`
}

/** Write `runtime/dev/dsh(.cmd)` that runs the gitignored clone's `bin.js`. */
export function writeDevLauncher(input: {
  command: string
  cloneBin: string
  nodePath?: string
  platform?: NodeJS.Platform
}): void {
  const platform = input.platform ?? process.platform
  const nodePath = input.nodePath ?? process.execPath
  mkdirSync(dirname(input.command), { recursive: true })
  const body =
    platform === 'win32'
      ? buildWinDevLauncher(nodePath, input.cloneBin)
      : buildPosixDevLauncher(nodePath, input.cloneBin)
  writeFileSync(input.command, body, 'utf8')
  if (platform !== 'win32') chmodSync(input.command, 0o755)
}

/**
 * Fail before spawn when a `.cmd` wrapper points at a missing engine bin.
 * Bare PATH names such as `dsh` are left to the shell.
 */
export function assertLauncherUsable(command: string, io: LauncherIo): string {
  const raw = String(command || '').trim()
  if (!raw) throw new Error('engine launcher path is empty')
  if (!isAbsolute(raw)) return raw
  if (!io.exists(raw)) {
    throw new Error(`engine launcher missing at ${raw}`)
  }
  if (!/\.cmd$/iu.test(raw)) return raw
  const text = io.read(raw)
  for (const target of quotedWinPaths(text)) {
    if (!isAbsolute(target)) continue
    if (io.exists(target)) continue
    throw new Error(
      `stale engine launcher ${raw} points at missing ${target}. Run .\\build-clients.cmd or pnpm fetch:engine && pnpm engine:build`,
    )
  }
  return raw
}

/**
 * Spawn `node` + `bin.js` without a shell when the wrapper is relocatable or
 * quotes absolute paths. PATH names such as `dsh` stay on the shell.
 *
 * @param command Absolute launcher path or a PATH name
 * @param io File existence and wrapper text
 * @param platform Host platform
 * @returns Direct spawn argv, or `undefined` to keep the shell wrapper
 */
export function resolveDirectSpawn(
  command: string,
  io: LauncherIo,
  platform: NodeJS.Platform = process.platform,
): DirectSpawn | undefined {
  const raw = String(command || '').trim()
  if (!raw || !isAbsolute(raw) || !io.exists(raw)) return undefined
  const path = platform === 'win32' ? win32 : posix
  const dir = path.dirname(raw)
  const siblingNode = path.join(dir, platform === 'win32' ? 'node.exe' : 'node')
  const siblingBin = path.join(dir, 'harness', 'apps', 'cli', 'lib', 'bin.js')
  if (io.exists(siblingNode) && io.exists(siblingBin)) {
    return { exec: siblingNode, prefixArgs: [siblingBin] }
  }
  if (platform === 'win32' && !/\.cmd$/iu.test(raw)) return undefined
  const quoted = quotedWinPaths(io.read(raw))
  const isScript = (item: string) => /\.[cm]?js$/iu.test(item)
  const bin = quoted.find((item) => path.isAbsolute(item) && isScript(item) && io.exists(item))
  const exec = quoted.find(
    (item) => path.isAbsolute(item) && item !== bin && !isScript(item) && io.exists(item),
  )
  if (exec && bin) return { exec, prefixArgs: [bin] }
  return undefined
}
