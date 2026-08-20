/**
 * One-click multi-scenario client build.
 * Resolves a Harness ref (lock|stable|latest), fetches it, builds the engine,
 * then packs VS Code VSIX + Electron NSIS/portable/zip.
 *
 *   pnpm build:clients
 *   pnpm build:clients:stable
 *   pnpm build:clients:latest
 *   DSH_CLIENTS=vscode,nsis,zip pnpm build:clients
 *   DSH_SKIP_ENGINE_BUILD=1 pnpm build:clients   # reuse an already built clone
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEngineLock } from './engine-lock.mjs'
import { defaultEngineRoot } from './engine-root.mjs'
import { githubAuthToken, resolveEngineRef } from './github-engine.mjs'
import { CLIENT_SCENARIOS, parseClientScenarios } from './client-scenarios.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const channel = (process.argv[2] || process.env.DSH_ENGINE_CHANNEL || 'stable').trim()
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
    shell: true,
    windowsHide: true,
    stdio: 'inherit',
    timeout: 3_600_000,
    env: { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) {
    throw new Error(`build-clients: pnpm ${args.join(' ')} failed (exit ${result.status})`)
  }
}

const resolved = await resolveEngineRef({
  channel,
  explicitRef: process.env.DSH_ENGINE_REF,
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

run('fetch-engine.mjs', {
  DSH_ENGINE_REF: resolved.ref,
  ...(process.env.DSH_FETCH_ENGINE_FORCE
    ? { DSH_FETCH_ENGINE_FORCE: process.env.DSH_FETCH_ENGINE_FORCE }
    : {}),
})

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
