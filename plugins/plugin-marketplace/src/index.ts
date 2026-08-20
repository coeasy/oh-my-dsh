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

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  CURATED,
  EXCLUDED,
  REDIRECTS,
  CATEGORIES,
  classify,
  detectType,
  fetchReadme,
  isInstalled,
  profileDirOf,
  readOfficialState,
  safeExternalUrl,
  type RegistryEntry,
} from './registry.ts'
import { childEnv, installSpecOf, isNpmSpec, runPluginCommand } from './install.ts'
import { loadCatalog, paginateCatalog, resolveCatalogEntry, scanSource } from './catalog.ts'
import { installFileTypeAtomic } from './file-installer.ts'
import { verifyNpmPackage, verifyTarballIntegrity } from './verify.ts'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackup,
  restoreBackup,
  type BackupFile,
} from './backup.ts'
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

const MAX_JSON_BODY_BYTES = 64 * 1024

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    size += chunk.byteLength
    if (size > MAX_JSON_BODY_BYTES) return null
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function requireJsonBody(
  body: Record<string, unknown> | null,
  response: ServerResponse,
): body is Record<string, unknown> {
  if (body !== null) return true
  sendJson(response, 413, { error: 'request body too large' })
  return false
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

function brokerRequest(request: IncomingMessage): boolean {
  const expected = process.env.DSH_MARKET_BROKER_TOKEN
  const supplied = request.headers['x-dsh-market-broker']
  if (!expected || typeof supplied !== 'string') return false
  const left = Buffer.from(expected)
  const right = Buffer.from(supplied)
  return left.length === right.length && timingSafeEqual(left, right)
}

function requirePost(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end()
    return false
  }
  return true
}

function isSafeBundleId(value: string): boolean {
  return /^[A-Za-z0-9@._/-]{1,200}$/u.test(value)
}

function entryView(entry: RegistryEntry, state: ReturnType<typeof readOfficialState>) {
  const redirect = REDIRECTS.get(entry.full_name)
  const fullName = redirect ?? entry.full_name
  return {
    ...entry,
    full_name: fullName,
    url: redirect
      ? `https://github.com/${fullName}`
      : safeExternalUrl(entry.url, `https://github.com/${fullName}`),
    curated: CURATED.has(entry.full_name),
    installed: isInstalled(entry, state),
    installSpec: installSpecOf({ ...entry, full_name: fullName }),
    type: detectType(entry),
    category: classify(entry),
  }
}

interface CatalogTarget {
  fullName: string
  entry: RegistryEntry
  spec: string
  type: ReturnType<typeof detectType>
}

async function catalogTarget(body: Record<string, unknown>): Promise<CatalogTarget | undefined> {
  const requested = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const fullName = REDIRECTS.get(requested) ?? requested
  const entry = await resolveCatalogEntry(fullName)
  if (!entry) return undefined
  return {
    fullName,
    entry,
    spec: installSpecOf(entry),
    type: detectType(entry),
  }
}

async function installCatalogTarget(
  target: CatalogTarget,
  profile: string,
  home: string | undefined,
): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  if (target.type === 'skill' || target.type === 'preset') {
    const result = await installFileTypeAtomic(target.type, target.fullName, home)
    return {
      status: result.code === 0 ? 200 : 500,
      body: { ok: result.code === 0, output: `${result.stdout}${result.stderr}`.slice(-8000) },
    }
  }
  if (!isNpmSpec(target.spec)) {
    return {
      status: 400,
      body: { ok: false, error: 'catalog entry has no verified npm package' },
    }
  }
  const verify = await verifyNpmPackage(target.spec, target.fullName)
  if (
    !verify.ok ||
    !verify.exists ||
    verify.squat === true ||
    !verify.integrity ||
    !verify.tarball
  ) {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'catalog package identity could not be verified',
        output: verify.note || 'registry identity or integrity metadata is unavailable',
        verify,
      },
    }
  }
  const tarball = await verifyTarballIntegrity({
    tarball: verify.tarball,
    integrity: verify.integrity,
  })
  verify.tarballCheck = tarball.status
  if (tarball.status !== 'match') {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'tarball integrity is not verified',
        output: tarball.note,
        verify,
      },
    }
  }
  const result = await runPluginCommand(profile, ['add', target.spec], { home })
  return {
    status: result.code === 0 ? 200 : 500,
    body: {
      ok: result.code === 0,
      spec: target.spec,
      output: `${result.stdout}${result.stderr}`.slice(-8000),
      verify,
    },
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
          const page = Number(url.searchParams.get('page') ?? 1)
          const pageSize = Number(url.searchParams.get('page_size') ?? 50)
          const query = url.searchParams.get('q') ?? ''
          const s = state()
          if (source !== 'all') {
            const { entries, sources } = await scanSource(source, refresh)
            const result = paginateCatalog(
              entries.filter((entry) => !EXCLUDED.has(entry.full_name)),
              { page, pageSize, query },
            )
            sendJson(response, 200, {
              profile,
              profileDir: profileDirOf(profile, home),
              categories: CATEGORIES,
              generated_at: new Date().toISOString(),
              refreshedAt: new Date().toISOString(),
              official: s,
              sources,
              source,
              page: result.page,
              pageSize: result.pageSize,
              total: result.total,
              hasMore: result.hasMore,
              repos: result.entries.map((entry) => entryView(entry, s)),
            })
            return
          }
          const index = await loadCatalog(refresh)
          const result = paginateCatalog(
            index.entries.filter((entry) => !EXCLUDED.has(entry.full_name)),
            { page, pageSize, query },
          )
          sendJson(response, 200, {
            profile,
            profileDir: profileDirOf(profile, home),
            categories: CATEGORIES,
            generated_at: index.generated_at,
            refreshedAt: index.generated_at,
            official: s,
            sources: index.sources,
            source,
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            hasMore: result.hasMore,
            repos: result.entries.map((entry) => entryView(entry, s)),
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
          if (!requirePost(request, response) || !brokerRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          if (!requireJsonBody(body, response)) return
          const target = await catalogTarget(body)
          if (!target) return sendJson(response, 404, { error: 'catalog entry not found' })
          const result = await installCatalogTarget(target, profile, home)
          sendJson(response, result.status, { ...result.body, official: state() })
        },
      }),

      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/remove',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !brokerRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          if (!requireJsonBody(body, response)) return
          const target = await catalogTarget(body)
          if (!target) return sendJson(response, 404, { error: 'catalog entry not found' })
          const pkg = target.entry.pkg_name || target.entry.name
          if (!isNpmSpec(pkg)) {
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
          if (!requirePost(request, response) || !brokerRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          if (!requireJsonBody(body, response)) return
          const target = await catalogTarget(body)
          if (!target) return sendJson(response, 404, { error: 'catalog entry not found' })
          const result = await installCatalogTarget(target, profile, home)
          sendJson(response, result.status, { ...result.body, official: state() })
        },
      }),

      // 热启停：写官方 cordis.patch.yml
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/toggle',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !brokerRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          if (!requireJsonBody(body, response)) return
          const bundleId = typeof body.id === 'string' ? body.id : ''
          const disabled = Boolean(body.disabled)
          if (!isSafeBundleId(bundleId)) {
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
          if (!requireJsonBody(body, response)) return
          const target = await catalogTarget(body)
          if (!target || !isNpmSpec(target.spec)) {
            sendJson(response, 400, { error: 'invalid npm spec', verify: null })
            return
          }
          const verify = await verifyNpmPackage(target.spec, target.fullName)
          sendJson(response, 200, {
            spec: target.spec,
            full_name: target.fullName,
            verify,
          })
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
          if (!requirePost(request, response) || !brokerRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          if (!requireJsonBody(body, response)) return
          const backup = body.backup as BackupFile | undefined
          if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
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
          if (!requirePost(request, response) || !brokerRequest(request)) {
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
          if (!requirePost(request, response) || !brokerRequest(request)) {
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
