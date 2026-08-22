/**
 * One-click multi-scenario client build.
 * Resolves a Harness ref (lock|stable|latest), fetches it, builds the engine,
 * then packs VS Code VSIX + Electron NSIS/portable/zip for this OS.
 *
 *   pnpm build:clients
 *   pnpm build:clients stable|latest|lock|<ref>
 *   DSH_CLIENTS=vscode,nsis,zip pnpm build:clients
 *   DSH_SKIP_ENGINE_BUILD=1 pnpm build:clients   # reuse an already built clone
 *   DSH_SKIP_FETCH=1 pnpm build:clients          # reuse fetched clone for this ref
 *   DSH_SKIP_PNPM_INSTALL=1 pnpm build:clients   # skip root pnpm install
 *   DSH_AUTO_UPDATE_LOCK=1 pnpm build:clients    # pin engine.lock.json to resolved ref
 *   DSH_INSTALL=1 pnpm build:clients             # install packed clients afterwards
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEngineLock, writeEngineLock } from './engine-lock.mjs'
import { defaultEngineRoot } from './engine-root.mjs'
import { githubAuthToken, resolveEngineRef } from './github-engine.mjs'
import { CLIENT_SCENARIOS, parseClientScenarios } from './client-scenarios.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const namedChannels = new Set(['lock', 'stable', 'latest'])
const argRef = (process.argv[2] || '').trim()
const envChannel = (process.env.DSH_ENGINE_CHANNEL || '').trim()
const channel = namedChannels.has(argRef)
  ? argRef
  : namedChannels.has(envChannel)
    ? envChannel
    : 'stable'
const explicitRef =
  process.env.DSH_ENGINE_REF || (argRef && !namedChannels.has(argRef) ? argRef : '')
const scenarios = parseClientScenarios(process.env.DSH_CLIENTS)
const dest = defaultEngineRoot(root)

function run(script, extraEnv = {}) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script)], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
    timeout: 3_600_000,
    env: { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) {
    throw new Error(`build-clients: ${script} failed (exit ${result.status})`)
  }
}

function runPnpm(args, extraEnv = {}) {
  const result = spawnSync('pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    // Windows resolves `pnpm` through its .cmd shim, which needs a shell;
    // elsewhere pnpm is an executable and shell:false avoids deprecation.
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: 'inherit',
    timeout: 3_600_000,
    env: { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) {
    throw new Error(`build-clients: pnpm ${args.join(' ')} failed (exit ${result.status})`)
  }
}

function onPath(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(probe, [command], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  return result.status === 0
}

// Pre-flight: the tools every scenario path needs. Clear, early failures beat
// obscure mid-build errors on machines without the toolchain.
const missing = []
if (!onPath('node')) missing.push('Node.js 22+ (https://nodejs.org/)')
if (!onPath('pnpm')) missing.push('pnpm (npm install -g pnpm@10)')
if (!onPath('git')) missing.push('git (https://git-scm.com/)')
if (missing.length > 0) {
  throw new Error(`build-clients: missing required tools — ${missing.join('; ')}`)
}

const resolved = await resolveEngineRef({
  channel,
  explicitRef: explicitRef || undefined,
  lock: loadEngineLock(root),
})
console.log(
  `build-clients: engine ${resolved.repository}#${resolved.ref} (${resolved.channel} via ${resolved.source})`,
)
if (resolved.fallback && /GitHub 403/u.test(String(resolved.fallback)) && !githubAuthToken()) {
  console.warn(
    'build-clients: hint: set GITHUB_TOKEN or GH_TOKEN to read GitHub Releases; currently falling back after 403',
  )
}
console.log(`build-clients: scenarios ${scenarios.join(',')}`)

// Optional: pin engine.lock.json to the ref this build actually resolved.
// Useful with latest/stable so the next lock-based build is deterministic.
if (process.env.DSH_AUTO_UPDATE_LOCK === '1' && resolved.ref !== loadEngineLock(root).ref) {
  console.log(`build-clients: pinning engine.lock.json → ${resolved.ref}`)
  writeEngineLock(root, { ref: resolved.ref })
}

if (process.env.DSH_SKIP_PNPM_INSTALL !== '1') {
  const ci = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true'
  runPnpm(ci ? ['install', '--frozen-lockfile'] : ['install'])
}

if (process.env.DSH_SKIP_FETCH !== '1') {
  run('fetch-engine.mjs', {
    DSH_ENGINE_REF: resolved.ref,
    ...(process.env.DSH_FETCH_ENGINE_FORCE
      ? { DSH_FETCH_ENGINE_FORCE: process.env.DSH_FETCH_ENGINE_FORCE }
      : {}),
  })
}

if (process.env.DSH_SKIP_ENGINE_BUILD !== '1') {
  run('build-engine.mjs')
}

runPnpm(['compile'])

const wantVscode = scenarios.includes('vscode')
const desktopIds = scenarios.filter((name) => name !== 'vscode')
if (wantVscode) runPnpm(['pack:vscode'])
if (desktopIds.length > 0) {
  run('pack-desktop-editions.mjs', { DSH_ELECTRON_TARGETS: desktopIds.join(',') })
}

mkdirSync(join(root, 'runtime'), { recursive: true })
writeFileSync(
  join(root, 'runtime', 'engine-resolved.json'),
  `${JSON.stringify({ ...resolved, scenarios, dest, builtAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
)
console.log(`OK: build-clients`)
for (const name of scenarios) {
  const row = CLIENT_SCENARIOS.find((item) => item.id === name)
  if (row) console.log(`  ${row.id}: ${row.artifact}`)
}

if (process.env.DSH_INSTALL === '1') {
  run('install-clients.mjs')
}
