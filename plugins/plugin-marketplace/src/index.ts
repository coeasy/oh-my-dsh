/**
 * @coeasy/dsh-plugin-marketplace host entry: mounts the market's HTTP API on
 * the webServer. Every mutating route re-invokes the OFFICIAL dsh CLI (or
 * writes the official cordis.patch.yml / skills dir), so installs land in the
 * official profile — pnpm-tracked, reconcile-registered, removable by
 * `dsh plugin --profile web remove <pkg>`. No manual copying of cordis
 * plugins, no private registration.
 *
 * Security: mutating routes accept same-origin loopback POSTs only.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  CURATED,
  EXCLUDED,
  REDIRECTS,
  CATEGORIES,
  classify,
  dshHomeOf,
  detectType,
  fetchReadme,
  isInstalled,
  profileDirOf,
  readOfficialState,
  type RegistryEntry,
} from './registry.ts'
import { childEnv, installSpecOf, runPluginCommand, type RunResult } from './install.ts'
import { loadCatalog, scanSource } from './catalog.ts'
import { verifyNpmPackage, verifyTarballIntegrity } from './verify.ts'
import { buildBackup, restoreBackup, BACKUP_FORMAT, type BackupFile } from './backup.ts'
import { uninstallApp, MARKET_PACKAGE } from './uninstall.ts'

export const name = 'coeasy-market'

export interface Config {
  profile?: string
  githubToken?: string
  /** Optional harness home override (default ~/.dsh, else $DSH_HOME). */
  home?: string
}

interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

function argvProfile(): string | undefined {
  const argv = process.argv
  const flag = argv.indexOf('--profile')
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-'))
    return argv[flag + 1]
  return undefined
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function trustedRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  const host = request.headers.host
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function requirePost(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end()
    return false
  }
  return true
}

function isNpmSpec(spec: string): boolean {
  return /^(@[^/]+\/)?[\w.-]+$/.test(spec) && !spec.includes('/')
    ? true
    : /^@[^/]+\/[\w.-]+$/.test(spec)
}

function entryView(entry: RegistryEntry, state: ReturnType<typeof readOfficialState>) {
  const redirect = REDIRECTS.get(entry.full_name)
  const fullName = redirect ?? entry.full_name
  return {
    ...entry,
    full_name: fullName,
    url: redirect ? `https://github.com/${fullName}` : entry.url,
    curated: CURATED.has(entry.full_name),
    installed: isInstalled(entry, state),
    installSpec: installSpecOf(entry),
    type: detectType(entry),
    category: classify(entry),
  }
}

/* ---------- 热启停：写官方 cordis.patch.yml（唯一写入点） ---------- */

function readPatch(profile: string, home?: string): string | null {
  const p = join(profileDirOf(profile, home), 'cordis.patch.yml')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/** Write a `disabled` toggle for one bundle id. Refuses to touch a patch that
 * contains any user-edited (non-empty, non-comment) content other than our
 * own toggle lines — protecting manual edits (plan §4.4). */
function writeToggle(
  profile: string,
  home: string | undefined,
  bundleId: string,
  disabled: boolean,
): { ok: boolean; error?: string } {
  const path = join(profileDirOf(profile, home), 'cordis.patch.yml')
  const raw = readPatch(profile, home) ?? ''
  const headerLines: string[] = []
  let body = ''
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      headerLines.push(line)
      continue
    }
    body += `${line}\n`
  }
  // Find our toggle lines `- id: <bundleId>` (optionally followed by disabled:).
  const own = new RegExp(
    `-\\s*id:\\s*${bundleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:\\r?\\n\\s*disabled:\\s*\\w+)?`,
    'g',
  )
  const other = body.replace(own, '')
  const residual = other.trim()
  if (residual !== '' && residual !== '[]') {
    return { ok: false, error: 'patch 文件包含手工条目，热启停已跳过（只读保护）' }
  }
  const header = headerLines.join('\n') + (headerLines.length ? '\n' : '')
  const newBody = `- id: ${bundleId}\n  disabled: ${disabled}\n`
  try {
    writeFileSync(path, `${header}${newBody}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `写入失败: ${String(e)}` }
  }
}

/* ---------- skill / preset 安装：官方目录，无脚本执行 ---------- */

function installFileType(
  type: 'skill' | 'preset',
  fullName: string,
  home: string | undefined,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const tmp = join(process.env.TEMP ?? '/tmp', `coeasy-${type}-${Date.now()}`)
    const child = spawn(
      'git',
      ['clone', '--depth', '1', `https://github.com/${fullName}.git`, tmp],
      { windowsHide: true },
    )
    child.on('close', (code) => {
      if (code !== 0) {
        rmSync(tmp, { recursive: true, force: true })
        return resolve({ code: code ?? 1, stdout: '', stderr: `git clone 失败 (${code})` })
      }
      const homeDir = dshHomeOf(home)
      const targetRoot =
        type === 'skill' ? join(homeDir, 'skills') : join(homeDir, '.agent-presets')
      const target = join(targetRoot, fullName.split('/').pop() ?? fullName)
      try {
        mkdirSync(targetRoot, { recursive: true })
        rmSync(target, { recursive: true, force: true })
        cpSync(tmp, target, { recursive: true })
        rmSync(tmp, { recursive: true, force: true })
        resolve({ code: 0, stdout: `installed ${type} → ${target}`, stderr: '' })
      } catch (e) {
        rmSync(tmp, { recursive: true, force: true })
        resolve({ code: 1, stdout: '', stderr: `install 失败: ${String(e)}` })
      }
    })
  })
}

/* ---------- pnpm 保障 ---------- */

async function detectPnpm(): Promise<string | null> {
  // Windows: pnpm is almost always pnpm.cmd — Node cannot exec .cmd directly.
  const commands = process.platform === 'win32' ? ['pnpm.cmd', 'pnpm'] : ['pnpm']
  for (const cmd of commands) {
    const result = await new Promise<string | null>((resolve) => {
      const child = spawn(cmd, ['--version'], {
        env: childEnv(),
        windowsHide: true,
        shell: process.platform === 'win32',
      })
      let out = ''
      child.stdout?.on('data', (c: Buffer) => {
        out += c.toString()
      })
      child.on('error', () => resolve(null))
      child.on('close', (code) => resolve(code === 0 ? out.trim() : null))
    })
    if (result !== null) return result
  }
  return null
}

export function apply(ctx: Context, config: Config = {}): void {
  ctx.inject(['webServer'], (hostCtx: Context) => {
    const webServer = hostCtx.get('webServer') as WebServerService
    const profile = config.profile ?? argvProfile() ?? 'web'
    const home = config.home
    const state = () => readOfficialState(profile, home)

    const disposers = [
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/list',
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
          const refresh = url.searchParams.get('refresh') === '1'
          const source = url.searchParams.get('source') ?? 'all'
          const s = state()
          if (source !== 'all') {
            // Single-source request (progressive loading): scan only this
            // adapter, bounded to MAX_PER_SOURCE, so the client can fill the
            // list as each source arrives instead of waiting for all of them.
            const { entries, sources } = await scanSource(source)
            sendJson(response, 200, {
              profile,
              profileDir: profileDirOf(profile, home),
              categories: CATEGORIES,
              generated_at: new Date().toISOString(),
              refreshedAt: new Date().toISOString(),
              official: s,
              sources,
              source,
              repos: entries.filter((e) => !EXCLUDED.has(e.full_name)).map((e) => entryView(e, s)),
            })
            return
          }
          const index = await loadCatalog(refresh)
          sendJson(response, 200, {
            profile,
            profileDir: profileDirOf(profile, home),
            categories: CATEGORIES,
            generated_at: index.generated_at,
            refreshedAt: index.generated_at,
            official: s,
            sources: index.sources,
            source,
            repos: index.entries
              .filter((e) => !EXCLUDED.has(e.full_name))
              .map((e) => entryView(e, s)),
          })
        },
      }),

      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/detail',
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
          const fullName = url.searchParams.get('full_name') ?? ''
          const readme = await fetchReadme(fullName)
          sendJson(response, 200, { full_name: fullName, readme })
        },
      }),

      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/install',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !trustedRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          const spec = typeof body.spec === 'string' ? body.spec.trim() : ''
          const type = typeof body.type === 'string' ? body.type : 'cordis'
          if (spec === '' || /[;&|`$><\n]/.test(spec)) {
            sendJson(response, 400, { error: 'invalid spec' })
            return
          }
          if (type === 'skill' || type === 'preset') {
            const repo = spec.replace(/^github:/, '')
            const result = await installFileType(type as 'skill' | 'preset', repo, home)
            return sendJson(response, result.code === 0 ? 200 : 500, {
              ok: result.code === 0,
              output: `${result.stdout}${result.stderr}`,
              official: state(),
            })
          }
          // P-B: verify npm-published specs before (and alongside) the install.
          const verify =
            isNpmSpec(spec) && type !== 'skill' && type !== 'preset'
              ? await verifyNpmPackage(
                  spec,
                  typeof body.full_name === 'string' ? body.full_name : null,
                )
              : null
          // C1 hard gate: the tarball must match the registry's dist.integrity
          // before the official CLI runs. A mismatch is tampering — refuse.
          if (verify?.integrity || verify?.tarball) {
            const tarball = await verifyTarballIntegrity({
              tarball: verify.tarball,
              integrity: verify.integrity,
            })
            verify.tarballCheck = tarball.status
            verify.note =
              tarball.status === 'mismatch'
                ? `${tarball.note}${verify.note ? `\n${verify.note}` : ''}`
                : verify.note
            if (tarball.status === 'mismatch') {
              return sendJson(response, 403, {
                ok: false,
                spec,
                error: 'integrity mismatch',
                output: tarball.note,
                official: state(),
                verify,
              })
            }
          }
          const result = await runPluginCommand(profile, ['add', spec], { home })
          sendJson(response, result.code === 0 ? 200 : 500, {
            ok: result.code === 0,
            spec,
            output: `${result.stdout}${result.stderr}`.slice(-8000),
            official: state(),
            verify,
          })
        },
      }),

      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/remove',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !trustedRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          const pkg = typeof body.pkg === 'string' ? body.pkg.trim() : ''
          if (pkg === '' || !/^[@\w./-]+$/.test(pkg)) {
            sendJson(response, 400, { error: 'invalid package' })
            return
          }
          const result = await runPluginCommand(profile, ['remove', pkg], { home })
          sendJson(response, result.code === 0 ? 200 : 500, {
            ok: result.code === 0,
            pkg,
            output: `${result.stdout}${result.stderr}`.slice(-8000),
            official: state(),
          })
        },
      }),

      // 更新 = 官方 add（重装即更新，reconcile 保证安全）
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/update',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !trustedRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          const spec = typeof body.spec === 'string' ? body.spec.trim() : ''
          if (spec === '') {
            sendJson(response, 400, { error: 'invalid spec' })
            return
          }
          const result = await runPluginCommand(profile, ['add', spec])
          sendJson(response, result.code === 0 ? 200 : 500, {
            ok: result.code === 0,
            spec,
            output: `${result.stdout}${result.stderr}`.slice(-8000),
            official: state(),
          })
        },
      }),

      // 热启停：写官方 cordis.patch.yml
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/toggle',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !trustedRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          const bundleId = typeof body.id === 'string' ? body.id : ''
          const disabled = Boolean(body.disabled)
          if (bundleId === '') {
            sendJson(response, 400, { error: 'invalid id' })
            return
          }
          const result = writeToggle(profile, home, bundleId, disabled)
          if (!result.ok) return sendJson(response, 409, { ok: false, error: result.error })
          sendJson(response, 200, { ok: true, id: bundleId, disabled })
        },
      }),

      // pnpm 保障：检测 + 一键安装
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/pnpm',
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          try {
            const version = await detectPnpm()
            sendJson(response, 200, { installed: version !== null, version })
          } catch {
            sendJson(response, 200, { installed: false, version: null, error: 'detect failed' })
          }
        },
      }),

      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/status',
        handler: (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          sendJson(response, 200, { profile, official: state() })
        },
      }),

      // P-B: pre-install safety verification against the npm registry.
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/verify',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !trustedRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          const spec = typeof body.spec === 'string' ? body.spec.trim() : ''
          const fullName = typeof body.full_name === 'string' ? body.full_name : null
          if (spec === '' || !isNpmSpec(spec)) {
            sendJson(response, 400, { error: 'invalid npm spec', verify: null })
            return
          }
          const verify = await verifyNpmPackage(spec, fullName)
          sendJson(response, 200, { spec, full_name: fullName, verify })
        },
      }),

      // P-C: export the installed plugin set as a portable backup JSON.
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/backup',
        handler: (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          sendJson(response, 200, { backup: buildBackup(profile, home) })
        },
      }),

      // P-C: restore a backup by re-adding each package via the official CLI.
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/restore',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !trustedRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          const backup = body.backup as BackupFile | undefined
          if (!backup || backup.format !== BACKUP_FORMAT) {
            sendJson(response, 400, { error: 'invalid backup format' })
            return
          }
          const result = await restoreBackup(profile, backup, home)
          sendJson(response, result.ok ? 200 : 409, { ...result, official: state() })
        },
      }),

      // Uninstall the market plugin itself (official CLI remove — reversible).
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/uninstall-market',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !trustedRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const result = await runPluginCommand(profile, ['remove', MARKET_PACKAGE], { home })
          sendJson(response, result.code === 0 ? 200 : 500, {
            ok: result.code === 0,
            output: `${result.stdout}${result.stderr}`.slice(-8000),
            official: state(),
          })
        },
      }),

      // Uninstall the whole my-dsh desktop client (OS-native uninstaller).
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/uninstall-app',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !trustedRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const result = await uninstallApp()
          sendJson(response, result.ok ? 200 : 409, result)
        },
      }),

      // P-D: diagnosis — installed set, bundles, source attribution, conflicts.
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/diagnose',
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          const s = state()
          const index = await loadCatalog(false)
          // Attach source + type per installed dependency, where known.
          const byPkg = new Map<string, RegistryEntry>()
          for (const e of index.entries) {
            if (e.pkg_name) byPkg.set(e.pkg_name, e)
            if (!e.pkg_name && e.name) byPkg.set(e.name, e)
          }
          const installed = s.dependencies.map((dep) => {
            const known = byPkg.get(dep)
            return {
              name: dep,
              inBundles: s.bundles.includes(dep),
              source: known ? 'catalog' : 'manual/unknown',
              category: known ? classify(known) : null,
              type: known ? detectType(known) : 'unknown',
            }
          })
          const unknown = installed.filter((i) => i.source === 'manual/unknown')
          sendJson(response, 200, {
            profile,
            profileDir: profileDirOf(profile, home),
            dependencies: s.dependencies,
            bundles: s.bundles,
            installCount: s.dependencies.length,
            bundleCount: s.bundles.length,
            installed,
            conflicts: {
              // deps present in bundles but not catalog-listed may shadow.
              manualOnly: unknown.map((i) => i.name),
              note: unknown.length
                ? '以下依赖未在目录中匹配到来源，可能是手动安装或已下架 / these deps have no catalog match — manually installed or unpublished'
                : '无 / none',
            },
            // Bundle order == load order.
            loadOrder: s.bundles,
            sources: index.sources,
          })
        },
      }),
    ]

    // Cordis Context.on is typed against its event map; dispose is a lifecycle
    // event provided by the runtime, so widen the surface to a string event.
    ;(hostCtx as unknown as { on(event: string, listener: () => void): () => void }).on(
      'dispose',
      () => {
        for (const dispose of disposers) dispose()
      },
    )
  })
}
