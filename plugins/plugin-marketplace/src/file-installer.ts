import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { dshHomeOf, isGithubRepo } from './registry.ts'
import type { RunResult } from './install.ts'

const MAX_FILES = 2_000
const MAX_BYTES = 64 * 1024 * 1024
const GIT_TIMEOUT_MS = 120_000

export function commitFromLsRemote(output: string): string | undefined {
  const sha = String(output || '')
    .trim()
    .split(/\s+/u)[0]
  return /^[0-9a-f]{40}$/iu.test(sha) ? sha.toLowerCase() : undefined
}

export function validateInstallTree(root: string, type: 'skill' | 'preset'): void {
  let files = 0
  let bytes = 0
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const path = join(dir, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error(`symbolic links are not allowed: ${path}`)
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) {
        files += 1
        bytes += stat.size
        if (files > MAX_FILES) throw new Error(`repository exceeds ${MAX_FILES} files`)
        if (bytes > MAX_BYTES) throw new Error(`repository exceeds ${MAX_BYTES} bytes`)
      } else {
        throw new Error(`unsupported filesystem entry: ${path}`)
      }
    }
  }
  visit(root)
  if (type === 'skill' && !existsSync(join(root, 'SKILL.md'))) {
    throw new Error('skill repository must contain SKILL.md')
  }
  if (
    type === 'preset' &&
    !['preset.json', 'agent-preset.json', 'README.md'].some((name) => existsSync(join(root, name)))
  ) {
    throw new Error('preset repository must contain preset.json, agent-preset.json, or README.md')
  }
}

export function atomicActivateDirectory(source: string, target: string): void {
  const root = join(target, '..')
  const name = basename(target)
  const suffix = randomBytes(6).toString('hex')
  const staging = join(root, `.${name}.staging-${suffix}`)
  const backup = join(root, `.${name}.backup-${suffix}`)
  mkdirSync(root, { recursive: true })
  try {
    cpSync(source, staging, {
      recursive: true,
      filter: (path) => basename(path) !== '.git',
    })
    if (existsSync(target)) renameSync(target, backup)
    renameSync(staging, target)
    rmSync(backup, { recursive: true, force: true })
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (!existsSync(target) && existsSync(backup)) renameSync(backup, target)
    throw error
  }
}

function runGit(args: string[], cwd?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true, shell: false })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString()}`.slice(-64 * 1024)
    const finish = (result: RunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, GIT_TIMEOUT_MS)
    child.on('error', (error) => finish({ code: 1, stdout, stderr: `${stderr}${error}` }))
    child.on('close', (code) =>
      finish({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}git command timed out` : stderr,
      }),
    )
  })
}

export async function installFileTypeAtomic(
  type: 'skill' | 'preset',
  fullName: string,
  home?: string,
): Promise<RunResult> {
  if (!isGithubRepo(fullName)) {
    return { code: 400, stdout: '', stderr: 'invalid GitHub repository' }
  }
  const url = `https://github.com/${fullName}.git`
  const resolved = await runGit(['ls-remote', url, 'HEAD'])
  const commit = resolved.code === 0 ? commitFromLsRemote(resolved.stdout) : undefined
  if (!commit) {
    return {
      code: resolved.code || 1,
      stdout: '',
      stderr: resolved.stderr || 'cannot resolve HEAD',
    }
  }
  const temp = mkdtempSync(join(tmpdir(), `coeasy-${type}-`))
  try {
    const clone = await runGit(['clone', '--filter=blob:none', '--no-checkout', url, temp])
    if (clone.code !== 0) return clone
    const checkout = await runGit(['checkout', '--detach', commit], temp)
    if (checkout.code !== 0) return checkout
    validateInstallTree(temp, type)
    const homeDir = dshHomeOf(home)
    const targetRoot = type === 'skill' ? join(homeDir, 'skills') : join(homeDir, '.agent-presets')
    const target = join(targetRoot, fullName.split('/').pop() ?? fullName)
    atomicActivateDirectory(temp, target)
    return {
      code: 0,
      stdout: `installed ${type} ${fullName}@${commit} → ${target}`,
      stderr: '',
    }
  } catch (error) {
    return { code: 1, stdout: '', stderr: `install failed: ${String(error)}` }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
