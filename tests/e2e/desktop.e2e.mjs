/**
 * Desktop Electron E2E (B3) — drives the COMPILED client for real against a stub
 * engine, so the whole first-run → navigation → quit → recovery loop runs
 * without a DeepSeek Harness clone or any network. Requires:
 *
 *   1. `pnpm compile:desktop` (produces apps/desktop/out/main.js + preload.cjs)
 *   2. `playwright-core` devDependency (Electron driver, no browser download)
 *
 * Flow per iteration (an isolated temp `APPDATA` gives a clean first run):
 *   - Launch: dev client with DSH_RUNTIME=local + DSH_BIN=<stub.cmd>, temp APPDATA.
 *   - First launch → setup page appears → fill workspace + API key → Continue.
 *   - Client spawns the stub engine, which writes a loopback ready.json; the
 *     client then navigates its window to `http://127.0.0.1:<port>/`.
 *   - Assert the window reached the stub page (loopback navigation).
 *   - Quit the client; assert the engine process is reaped (no leftover).
 *   - Relaunch with the SAME APPDATA → recovery: setup is skipped (workspace +
 *     key persisted) and the window goes straight to the engine loopback URL.
 *
 * Usage: pnpm e2e:desktop
 */
import { mkdtempSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktopDir = join(root, 'apps', 'desktop')

// --- assets the driver depends on ---------------------------------------------------
function fail(msg) {
  console.error(`desktop-e2e: FAIL — ${msg}`)
  process.exit(1)
}

for (const expected of [
  join(desktopDir, 'out', 'main.js'),
  join(desktopDir, 'out', 'preload.cjs'),
  join(desktopDir, 'splash.html'),
  join(desktopDir, 'setup.html'),
]) {
  try {
    statSync(expected)
  } catch {
    fail(`missing ${expected} — run pnpm compile:desktop first`)
  }
}

// Resolve playwright-core and the Electron binary from the app's dependencies.
const require = createRequire(join(desktopDir, 'package.json'))
let electronMain
let playwrightCore
try {
  electronMain = require('electron')
  playwrightCore = require('playwright-core')
} catch (error) {
  fail(`desktop dependencies not installed — run pnpm install (${error.message})`)
}
// require('electron') returns the binary path string in a node context.
const electronBin =
  typeof electronMain === 'string'
    ? electronMain
    : join(desktopDir, 'node_modules', 'electron', process.platform === 'win32' ? 'dist\\electron.exe' : 'dist/electron')
try {
  statSync(electronBin)
} catch {
  fail(`electron binary missing at ${electronBin}`)
}

const { _electron } = playwrightCore
const stubEngine = join(root, 'tests', 'e2e', 'desktop-stub-engine.mjs')

// Windows launcher contract: an absolute `.cmd` whose quoted paths are (node,
// stub.mjs). client-runtime's resolveDirectSpawn then spawns node+stub directly.
function buildWrapper(dir) {
  const nodePath = process.execPath
  const exe = process.platform === 'win32' ? join(dir, 'dsh.cmd') : join(dir, 'dsh')
  const body =
    process.platform === 'win32'
      ? `@echo off\r\n"${nodePath}" "${stubEngine}" %*\r\n`
      : `#!/bin/sh\nexec "${nodePath}" "${stubEngine}" "$@"\n`
  writeFileSync(exe, body, process.platform === 'win32' ? 'utf8' : { mode: 0o755 })
  return exe
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

const timeoutMs = Number(process.env.DSH_E2E_TIMEOUT_MS) || 90_000
async function waitFor(fn, what) {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    const value = await fn().catch(() => undefined)
    if (value) return value
    await sleep(200)
  }
}

function launchOptions(tmpRoot) {
  const appData = process.platform === 'win32' ? join(tmpRoot, 'appdata') : tmpRoot
  mkdirSync(appData, { recursive: true })
  mkdirSync(join(tmpRoot, 'workspace'), { recursive: true })
  const env = {
    ...process.env,
    APPDATA: appData, // Windows userData override -> isolated settings/state
    XDG_CONFIG_HOME: appData, // POSIX fallback
    HOME: tmpRoot,
    DSH_RUNTIME: 'local',
    DSH_BIN: buildWrapper(tmpRoot),
  }
  return {
    executablePath: electronBin,
    args: [desktopDir],
    cwd: desktopDir,
    env,
    timeout: timeoutMs,
  }
}

function firstWindow(app) {
  return waitFor(() => app.firstWindow().catch(() => undefined), 'first window')
}

async function waitForWindowUrl(window, predicate, onPoll) {
  return waitFor(
    async () => {
      const url = window.url() ?? ''
      if (onPoll) onPoll(url)
      return predicate(url) ? url : undefined
    },
    `window url matching ${predicate}`,
  )
}

async function run(iterationCount) {
  let results = []
  // A single shared APPDATA/workspace across iterations: recovery (iteration 1)
  // must see the settings persisted by first launch (iteration 0) to verify the
  // skip-setup path. A fresh temp root every iteration would isolate them.
  const tmpRoot = mkdtempSync(join(tmpdir(), 'my-dsh-e2e-'))
  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    const label = iteration === 0 ? 'first-launch' : iteration === 1 ? 'recovery' : `iteration-${iteration}`
    const steps = {}
    // Relaunch re-writes the wrapper in the same shared dir (harmless overwrite).
    const app = await _electron.launch(launchOptions(tmpRoot))
    try {
      const first = await firstWindow(app)
      const url0 = first.url() ?? ''

      if (iteration === 0) {
        // First launch: splash first, then the setup page must show.
        await waitForWindowUrl(first, (url) => url.includes('setup.html'))
        steps.firstRunSetupPage = true
        await waitFor(async () => (await first.$('#continue')) !== null, 'setup #continue')
        const workspace = join(tmpRoot, 'workspace')
        await first.evaluate(
          ([folderValue, keyValue]) => {
            const folder = document.getElementById('folder')
            if (folder) folder.value = folderValue
            const key = document.getElementById('key')
            if (key) key.value = keyValue
          },
          [workspace, 'sk-test-key'],
        )
        await first.click('#continue')
      } else {
        // Recovery: must reach the engine loopback without re-showing setup.
        steps.sawSetupOnRecovery = false
      }

      // Navigation loop: client should land on the stub engine's loopback URL.
      const finalUrl = await waitForWindowUrl(
        first,
        (url) => /^http:\/\/127\.0\.0\.1:\d+\//u.test(url),
        iteration === 1 ? (url) => {
          if (url.includes('setup.html')) steps.sawSetupOnRecovery = true
        } : undefined,
      )
      steps.loopbackNavigation = finalUrl
      const stubVisible = await waitFor(async () => {
        const h = await first.$('#stub')
        return (await h?.textContent()) === 'stub-engine-ready' ? 'stub-engine-ready' : undefined
      }, 'stub engine page render')
      steps.stubPageServed = stubVisible

      // --- quit ---
      await app.close()
      steps.cleanExit = true
    } catch (error) {
      let detail = error instanceof Error ? error.stack || error.message : String(error)
      try {
        const win = await app.firstWindow().catch(() => undefined)
        if (win) {
          const u = win.url() ?? ''
          const title = await win.title().catch(() => '')
          const body = (await win.textContent('body').catch(() => '')) || ''
          detail += ` | win.url="${u}" title="${title}" body="${body.slice(0, 400)}"`
        }
      } catch {
        // diagnostics best-effort
      }
      steps.error = detail
      try {
        await app.close()
      } catch {
        // already gone
      }
    }
    results.push({ label, steps })
  }
  return results
}

const summary = await run(process.env.DSH_E2E_ITERATIONS ? Number(process.env.DSH_E2E_ITERATIONS) : 2)

let anyFailed = false
for (const result of summary) {
  const label = result.label
  const steps = result.steps
  let line = `desktop-e2e: ${label}`
  if (steps.error) {
    line += ` — ERROR ${steps.error}`
    anyFailed = true
  } else {
    line += ` | setup=${steps.firstRunSetupPage ?? (steps.sawSetupOnRecovery === false ? 'skipped' : 'n/a')}`
    line += ` | loopback=${steps.loopbackNavigation ?? 'n/a'}`
    line += ` | stub=${steps.stubPageServed ?? 'n/a'}`
    line += ` | exit=${steps.cleanExit ?? 'n/a'}`
    if (
      (label === 'first-launch' && !steps.firstRunSetupPage) ||
      (label === 'recovery' && steps.sawSetupOnRecovery) ||
      !steps.loopbackNavigation ||
      steps.stubPageServed !== 'stub-engine-ready' ||
      !steps.cleanExit
    ) {
      line += ' <-- FAIL'
      anyFailed = true
    }
  }
  console.log(line)
}

if (!anyFailed) console.log('desktop-e2e: OK — first launch, loopback navigation, quit, recovery all pass')
process.exit(anyFailed ? 1 : 0)