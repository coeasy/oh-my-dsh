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
import {
  childEnv,
  homeMatrix,
  installSpecOf,
  isNpmSpec,
  runOfficialAdd,
  runPluginCommand,
  syncAllMirrors,
  syncToMirrors,
  withSyncGate,
  writePatchToggle,
} from './install.ts'
import type { MirrorSyncSummary } from './install.ts'
import {
  isFirstPartyEntry,
  loadCatalog,
  paginateCatalog,
  resolveCatalogEntry,
  scanSource,
} from './catalog.ts'
import { installFileTypeAtomic } from './file-installer.ts'
import { verifyNpmPackage, verifyTarballIntegrity } from './verify.ts'
import { validateInstalledBundle } from './bundle-check.ts'
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
    firstParty: isFirstPartyEntry(entry),
    installed: isInstalled(entry, state),
    inBundles: state.bundles.some(
      (bundle) => bundle === (entry.pkg_name || '') || bundle === entry.name || bundle === fullName,
    ),
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
    // Broadcast file-type installs to every mirror home too (idempotent clone).
    const mirrored =
      result.code === 0
        ? await syncToMirrors({
            action: target.type,
            fullName: target.fullName,
            profile,
            primary: home,
          })
        : { mirrors: [] }
    return {
      status: result.code === 0 ? 200 : 500,
      body: {
        ok: result.code === 0,
        output: `${result.stdout}${result.stderr}`.slice(-8000),
        mirrors: mirrored.mirrors,
      },
    }
  }
  if (!isNpmSpec(target.spec)) {
    return {
      status: 400,
      body: { ok: false, error: 'catalog entry has no verified npm package' },
    }
  }
  const verify = await verifyNpmPackage(target.spec, target.fullName)
  // Registry lookup itself failed (network / timeout / 5xx): that is NOT a
  // verdict that the package is missing — tell the user to retry instead of
  // refusing an installable package.
  if (!verify.ok) {
    return {
      status: 503,
      body: {
        ok: false,
        error: '插件包注册表暂不可用，请重试 / registry temporarily unavailable; retry',
        output: verify.note || 'registry lookup failed',
        verify,
      },
    }
  }
  // HTTP 404 — the package is definitively not published under this name.
  if (!verify.exists) {
    return {
      status: 403,
      body: {
        ok: false,
        error: 'catalog package identity could not be verified',
        output: verify.note || 'registry identity is unavailable',
        verify,
      },
    }
  }
  // squat / missing integrity metadata are WARNINGS, not blocks — verify.ts
  // documents "we never block the official CLI, only inform", and the
  // confirmation dialog already surfaces them. A bare pnpm install still gets
  // pinned by the official bundles reconcile.
  const tarball = await verifyTarballIntegrity({
    tarball: verify.tarball,
    integrity: verify.integrity,
  })
  verify.tarballCheck = tarball.status
  // Only a verified MISMATCH (tampering) is refused; 'unavailable' just means
  // we could not complete the check (network / missing metadata) — surfacing
  // it is enough, refusing it would block installs during network hiccups.
  if (tarball.status === 'mismatch') {
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
  const { result, registered, healed } = await runOfficialAdd(profile, target.spec, { home })
  // Anti-brick: once registered, parse-check the module the engine will import.
  // The engine is fail-loud — a bundle whose entry cannot even parse would take
  // down the whole profile on next boot. Roll back through the official CLI.
  let entryCheck: ReturnType<typeof validateInstalledBundle> | null = null
  if (result.code === 0 && registered) {
    entryCheck = validateInstalledBundle(profileDirOf(profile, home), target.spec)
    if (!entryCheck.ok) {
      const rollback = await runPluginCommand(profile, ['remove', target.spec], { home })
      // Also remove from every mirror so a bad bundle can't brick another home.
      const mirrored = await syncToMirrors({
        action: 'remove',
        spec: target.spec,
        profile,
        primary: home,
      })
      return {
        status: 422,
        body: {
          ok: false,
          error: '插件入口校验失败，已自动回滚（不会影响现有插件）',
          spec: target.spec,
          registered: false,
          rolledBack: true,
          rollbackCode: rollback.code,
          entryCheck,
          mirrors: mirrored.mirrors,
          output:
            `${result.stdout}${result.stderr}\n\n[entry check failed → rolled back]\n` +
            entryCheck.errors.join('\n'),
          verify,
        },
      }
    }
  }
  // Broadcast the install to every mirror home (idempotent official replay).
  const mirrored =
    result.code === 0
      ? await syncToMirrors({ action: 'add', spec: target.spec, profile, primary: home })
      : { mirrors: [] }
  const mirrorFailures = mirrored.mirrors.filter((m) => !m.ok)
  return {
    status: result.code === 0 ? 200 : 500,
    body: {
      ok: result.code === 0,
      spec: target.spec,
      registered,
      healed,
      entryCheck: entryCheck ? { ok: entryCheck.ok, errors: entryCheck.errors } : null,
      // A cordis bundle only loads after the engine restarts; surface that
      // so the user doesn't expect it in the live page.
      restartRequired: registered,
      output: `${result.stdout}${result.stderr}`.slice(-8000),
      verify,
      mirrors: mirrored.mirrors,
      mirrorFailures,
      mirrorNote:
        mirrorFailures.length > 0
          ? '主目录安装成功，但部分镜像目录同步失败（可稍后使用“同步”修复）'
          : undefined,
    },
  }
}

/* ---------- 热启停：写官方 cordis.patch.yml ----------
 * writePatchToggle now lives in install.ts (generalized to any home so it can
 * be replayed against mirrors); the primary-home toggle route delegates to it.
 */

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
          // P0-4: “已安装” view — the server filters the FULL catalog (not just
          // the first page) so installed cards (incl. first-party built-ins with
          // stars: 0) surface reliably regardless of star ordering.
          const installedOnly = url.searchParams.get('installed_only') === '1'
          const s = state()
          const catalogFilter = (entry: RegistryEntry): boolean =>
            !EXCLUDED.has(entry.full_name) && (!installedOnly || isInstalled(entry, s))
          if (source !== 'all') {
            const { entries, sources } = await scanSource(source, refresh)
            const result = paginateCatalog(entries.filter(catalogFilter), { page, pageSize, query })
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
          const result = paginateCatalog(index.entries.filter(catalogFilter), {
            page,
            pageSize,
            query,
          })
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
          // Broadcast the removal to every mirror (idempotent — a mirror that
          // never had the package counts as converged).
          const mirrored =
            result.code === 0
              ? await syncToMirrors({ action: 'remove', spec: pkg, profile, primary: home })
              : { mirrors: [] }
          sendJson(response, result.code === 0 ? 200 : 500, {
            ok: result.code === 0,
            pkg,
            output: `${result.stdout}${result.stderr}`.slice(-8000),
            mirrors: mirrored.mirrors,
            mirrorFailures: mirrored.mirrors.filter((m) => !m.ok),
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
          const result = writePatchToggle(profile, home, bundleId, disabled)
          if (!result.ok) return sendJson(response, 409, { ok: false, error: result.error })
          // Replay the disable/enable against every mirror's patch too.
          const mirrored = await syncToMirrors({
            action: 'toggle',
            bundleId,
            disabled,
            profile,
            primary: home,
          })
          sendJson(response, 200, {
            ok: true,
            id: bundleId,
            disabled,
            mirrors: mirrored.mirrors,
            mirrorFailures: mirrored.mirrors.filter((m) => !m.ok),
          })
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

      // Multi-home: the primary + mirror matrix (read-only consistency view).
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/homes',
        handler: (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          const matrix = homeMatrix(profile, { primary: home })
          sendJson(response, 200, {
            profile,
            primary: matrix.primary,
            homes: matrix.homes,
            official: state(),
          })
        },
      }),

      // Multi-home: lazy repair — bring every mirror up to the primary's set.
      webServer.register({
        kind: 'exact',
        path: '/coeasy-market/api/sync',
        handler: async (request, response) => {
          if (!requirePost(request, response) || !brokerRequest(request)) {
            sendJson(response, 403, { error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          if (!requireJsonBody(body, response)) return
          const force = body.force === true
          // Skip when already aligned unless explicitly forced. `extra` homes
          // are intentionally richer — they need no repair; `missing`/`drifted`
          // do (absent packages / version misalignment).
          if (!force) {
            const matrix = homeMatrix(profile, { primary: home })
            if (matrix.homes.every((h) => h.status === 'in-sync' || h.status === 'extra')) {
              sendJson(response, 200, {
                ok: true,
                skipped: true,
                note: '所有镜像目录已与主目录同步',
                homes: matrix.homes,
              })
              return
            }
          }
          const gated = await withSyncGate(() => syncAllMirrors(profile, { primary: home }))
          if (gated.skipped) {
            sendJson(response, 409, {
              ok: false,
              skipped: true,
              note: '已有同步任务进行中，请稍后重试',
            })
            return
          }
          const { results } = gated.value
          const failures = results.filter((r) => !r.ok)
          const drifted = results.filter((r) => (r.updated ?? []).length > 0)
          sendJson(response, failures.length === 0 ? 200 : 500, {
            ok: failures.length === 0,
            results,
            failures,
            note: failures.length
              ? '部分镜像目录同步失败，请查看结果'
              : drifted.length
                ? '镜像目录已对齐（含版本更新）'
                : '所有镜像目录已与主目录同步',
          })
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
          // Restoring rewrites the primary's dependency set — lazily bring every
          // mirror back onto it (add what the restored set needs; never remove).
          let mirrorSummary:
            | { ok: boolean; skipped?: boolean; results: MirrorSyncSummary[]; note: string }
            | undefined
          if (result.ok) {
            const gated = await withSyncGate(() => syncAllMirrors(profile, { primary: home }))
            if (!gated.skipped) {
              const failures = gated.value.results.filter((r) => !r.ok)
              mirrorSummary = {
                ok: failures.length === 0,
                results: gated.value.results,
                note: failures.length
                  ? '镜像目录补齐部分失败，可稍后手动同步'
                  : '镜像目录已随恢复结果同步',
              }
            }
          }
          sendJson(response, result.ok ? 200 : 409, {
            ...result,
            mirrorSummary,
            official: state(),
          })
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
            // Multi-home consistency matrix (primary vs mirrors).
            homes: homeMatrix(profile, { primary: home }).homes,
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
