import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  screen,
  shell,
  type MessageBoxOptions,
  WebContentsView,
} from 'electron'
import {
  assertLoopbackUrl,
  killMatchingProcesses,
  killProcessTree,
  launchHost,
  writeDevLauncher,
  type RunningHost,
} from '@dsh/client-runtime'
import { hasDeepSeekApiKey, upsertEnvKey } from './api-key.ts'
import { normalizeEngineJunction } from './engine-junction.ts'
import { checkForAppUpdates } from './app-update-service.ts'
import { createStatusTray, type StatusTray } from './app-tray.ts'
import {
  installMarket,
  isMarketInstalled,
  killBootstrapProcesses,
  marketBundledVersion,
  marketNeedsRefresh,
  refreshMarket,
} from './market-bootstrap.ts'
import { executeMarketBrokerAction, type MarketActionRequest } from './market-broker.ts'
import {
  ensureFirstPartyPlugins,
  firstPartyPluginsFromRepo,
  firstPartyPluginsFromResources,
} from './first-party-plugins.ts'
import { disableCommunityBundles, disableNewestCommunityBundlesMany } from './plugin-recovery.ts'
import {
  discoverHarnessHomes,
  importHarnessHome,
  resolveHarnessHome,
  resolvePluginHomes,
  type HarnessHomeMode,
} from './harness-home.ts'
import {
  dispatchUsageAnalyticsAction,
  setUsageAnalyticsHttpClient,
} from './plugins/usage-analytics-host.ts'
import { dispatchModelConfigAction, setModelConfigHttpClient } from './plugins/model-config-host.ts'
import {
  dispatchDegenerationGuardAction,
  setDegenerationGuardHttpClient,
} from './plugins/degeneration-guard-host.ts'
import { modelConfigPageHtml } from './plugins/model-config-ui-page.ts'
import { guardPageHtml } from './plugins/degeneration-guard-ui-page.ts'
import { usageAnalyticsPageHtml } from './plugins/usage-analytics-ui-page.ts'
import type { RuntimeSnapshot } from './contracts.ts'
import { buildDiagnosticsReport } from './diagnostics.ts'
import {
  loadDesktopSettings,
  saveDesktopSettings,
  type DesktopSettings,
  type WindowBounds,
} from './desktop-settings.ts'
import {
  buildHarnessSpawnOptions,
  loadDotEnvFile,
  resolveSidecarDotEnvPath,
  sanitizeBundledSpawnEnv,
} from './harness-env.ts'
import { ensureLaunchRoot, desktopUserDataPath } from './launch-root.ts'
import { LanMobileBridge } from './mobile/lan-mobile-bridge.ts'
import {
  parseRuntimeFile,
  resolveDesktopDownloadUrl,
  resolveEngineLaunch,
  resolvePluginPath,
} from './launch-config.ts'
import {
  QUIT_BUDGET_MS,
  stoppingSnapshot,
  clearEnginePid,
  readEnginePid,
  writeEnginePid,
} from './quit-session.ts'
import { secureWindow } from './security.ts'
import { initObservability, logInfo, logWarn } from './observability.ts'
import { isNewerVersion, parseGithubRepo } from './updates.ts'
import {
  activateEngineVersion,
  clearActiveEngineVersion,
  downloadEnginePayload,
  engineLauncherName,
  engineVersionDir,
  parseEngineUpdateManifest,
  parseLatestRelease,
  resolveActiveEngineDir,
  rollbackCandidate,
  writeActiveEngineVersion,
  type EngineUpdateManifest,
} from './engine-updater.ts'
import {
  desktopChromeOptions,
  FILL_VIEWPORT_CSS,
  HARNESS_WINDOW_TITLE,
  NO_DRAG_INTERACTIVES_CSS,
} from './window-chrome.ts'
import { isUsableWorkspace, resolveLaunchDirectory } from './workspace-choice.ts'
import { isAbortedNavigationError, shouldLoadHarnessUrl } from './window-navigation.ts'

let mainWindow: BrowserWindow | undefined
let mobileWindow: BrowserWindow | undefined
let host: RunningHost | undefined
let mobileBridge: LanMobileBridge | undefined
let statusTray: StatusTray | undefined
let lastSnapshot: RuntimeSnapshot = { phase: 'idle', message: 'Harness is not running.', logs: [] }
let lastEnginePid = 0
let launchDirectory = ''
let quitting = false
let forceExiting = false
let failureDialogVisible = false
let setupWaiter: ((result: { workspace: string; apiKey: string }) => void) | undefined
let marketBrokerToken = ''
// Boot fusing: how many community bundles were auto-disabled this session so a
// bad plugin can't brick the engine (fail-loud) while good plugins survive.
let bootFuseSteps = 0
const MAX_AUTO_FUSE_STEPS = 3
/** Launch failures that smell like a bad plugin vs. a runtime/network issue. */
const PLUGIN_FAILURE_HINTS =
  /plugin tree failed|failed to load|failed to import loader entry|failed to apply loader entry|cannot resolve profile bundle|failed to activate|fatal load failure/i

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/**
 * Resolve a path to its canonical long form. Portable builds run from
 * %TEMP%, which on some systems is an 8.3 short-name path (e.g.
 * C:\Users\ADMINI~1\...). Electron exposes that short name via
 * process.resourcesPath, and paths handed to the engine sidecar then carry
 * the short name. Node's ESM resolver can fail to load such paths, so we
 * canonicalize every engine-facing path to its long-name form.
 */
function canonicalEnginePath(path: string): string {
  try {
    // realpathSync.native resolves 8.3 short names to their long form, which
    // the engine's ESM loader needs to find files under a short-named %TEMP%.
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function repoRoot(): string {
  return join(moduleDir(), '..', '..', '..')
}

function configureAppIdentity(): void {
  app.setName('my-dsh')
  app.setAppUserModelId('com.mydsh.desktop')
  app.setPath('userData', desktopUserDataPath())
  migrateLegacyUserData()
}

/**
 * One-time migration from the legacy user-data folder name
 * (`dsh-client-desktop`) to the renamed `my-dsh` folder, so existing users
 * keep their workspace, API key and engine settings after the rename. Only
 * copies user-authored configuration, never the engine's runtime state
 * (`profiles`, `node_modules`, `sessions`, `storages`) — those are managed by
 * the engine at first launch and must not be copied, or the engine's symlink
 * handling breaks. Only runs when the new folder is absent but the legacy one
 * exists; the legacy folder is left untouched.
 */
function migrateLegacyUserData(): void {
  const current = app.getPath('userData')
  const legacy = join(app.getPath('appData'), 'dsh-client-desktop')
  if (legacy === current || existsSync(current) || !existsSync(legacy)) return
  const copyIfPresent = (relative: string): void => {
    const src = join(legacy, relative)
    if (!existsSync(src)) return
    const dest = join(current, relative)
    mkdirSync(dirname(dest), { recursive: true })
    try {
      cpSync(src, dest, { recursive: true, force: true })
      if (relative.endsWith('.env')) chmodSync(dest, 0o600)
    } catch (error) {
      console.error(`[my-dsh] migration skipped ${relative}`, error)
    }
  }
  mkdirSync(current, { recursive: true })
  copyIfPresent('desktop-settings.json')
  copyIfPresent(join('harness', 'settings.yaml'))
  copyIfPresent(join('harness', '.env'))
  copyIfPresent(join('harness', '.env.example'))
}

function desktopResourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(moduleDir(), '..', name)
}

function preloadPath(): string {
  return join(moduleDir(), 'preload.cjs')
}

function loadBundledRuntime(): ReturnType<typeof parseRuntimeFile> {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'runtime.json')
    : join(moduleDir(), '..', 'runtime.json')
  if (!existsSync(path)) return {}
  return parseRuntimeFile(readFileSync(path, 'utf8'))
}

function harnessLogPath(): string {
  return join(app.getPath('logs'), 'harness.log')
}

function harnessLocale(): 'en' | 'zh' {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** Stage labels for the splash window's status line (B6 launch progress). */
const LAUNCH_STAGE_TEXT: Record<string, { en: string; zh: string }> = {
  resolving: { en: 'Locating engine…', zh: '正在定位引擎…' },
  downloading: { en: 'Downloading engine…', zh: '正在下载引擎…' },
  spawning: { en: 'Starting engine…', zh: '正在启动引擎…' },
  'waiting-ready': { en: 'Waiting for engine…', zh: '等待引擎就绪…' },
  ready: { en: 'Ready', zh: '就绪' },
}

function setSplashStatus(text: string): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  if (!window) return
  // The splash page exposes #status; update it in place without a preload round-trip.
  window.webContents
    .executeJavaScript(
      `(() => { const el = document.getElementById('status'); if (el) el.textContent = ${JSON.stringify(text)}; })()`,
      true,
    )
    .catch(() => undefined)
}

function launchStageMessage(stage: string): string {
  const label = LAUNCH_STAGE_TEXT[stage] ?? { en: 'Starting…', zh: '正在启动…' }
  return harnessLocale() === 'zh' ? label.zh : label.en
}

/**
 * The harness home the client actually runs, honoring the `harnessHome`
 * setting (auto/custom/official/explicit path). Every subsystem (launch,
 * marketplace install, boot-fusing) must use THIS so they never diverge.
 */
function effectiveHarnessHome(): string {
  const settings = loadDesktopSettings(app.getPath('userData'))
  return resolveHarnessHome(
    (settings.harnessHome as HarnessHomeMode | undefined) ?? 'auto',
    app.getPath('userData'),
  )
}

function sidecarDotEnvPath(): string {
  return resolveSidecarDotEnvPath(dirname(app.getPath('exe')), process.env.PORTABLE_EXECUTABLE_DIR)
}

function currentApiKeyPresent(): boolean {
  const dshHome = effectiveHarnessHome()
  return (
    hasDeepSeekApiKey(process.env) ||
    hasDeepSeekApiKey(loadDotEnvFile(sidecarDotEnvPath())) ||
    hasDeepSeekApiKey(loadDotEnvFile(join(dshHome, '.env')))
  )
}

function persistApiKey(apiKey: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) return
  const dshHome = effectiveHarnessHome()
  mkdirSync(dshHome, { recursive: true })
  const dest = join(dshHome, '.env')
  const previous = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  writeFileSync(dest, upsertEnvKey(previous, 'DEEPSEEK_API_KEY', trimmed), 'utf8')
  chmodSync(dest, 0o600)
}

function publishSnapshot(next: RuntimeSnapshot): void {
  lastSnapshot = next
  statusTray?.update(next)
}

function rememberEngine(next: RunningHost | undefined): void {
  host = next
  lastEnginePid = next?.pid ?? 0
  const userData = app.getPath('userData')
  if (next?.pid) writeEnginePid(userData, next.pid)
  else clearEnginePid(userData)
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(moduleDir(), '..', 'build', 'icon.png')
}

function showMainWindow(): void {
  if (lastSnapshot.phase === 'ready' && lastSnapshot.url) {
    void openHarness(lastSnapshot.url).catch(showUnexpectedError)
    return
  }
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function reapRecordedEngine(): void {
  const pid = readEnginePid(app.getPath('userData'))
  if (pid) killProcessTree(pid)
  clearEnginePid(app.getPath('userData'))
}

function dismissUi(): void {
  try {
    statusTray?.destroy()
  } catch {
    // tray already gone
  }
  statusTray = undefined
  closeAllPluginConfigWindows()
  if (mobileWindow && !mobileWindow.isDestroyed()) mobileWindow.destroy()
  mobileWindow = undefined
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close')
    mainWindow.close()
  }
}

function forceExit(): void {
  if (forceExiting) return
  forceExiting = true
  quitting = true
  if (lastEnginePid) killProcessTree(lastEnginePid)
  clearEnginePid(app.getPath('userData'))
  dismissUi()
  host = undefined
  mobileBridge = undefined
  app.exit(0)
}

async function quitAll(): Promise<void> {
  if (quitting) return
  quitting = true
  publishSnapshot(stoppingSnapshot(harnessLocale(), launchDirectory))
  dismissUi()
  const budget = setTimeout(() => forceExit(), QUIT_BUDGET_MS)
  try {
    await Promise.all([
      host?.stop().catch(() => undefined),
      mobileBridge?.stop().catch(() => undefined),
    ])
  } finally {
    clearTimeout(budget)
    // Strong reap (plan §退出无残留): close any in-flight bootstrap/install
    // children first, then kill orphaned engine/market processes by command
    // line — this closes the detached/reparented worker gap that taskkill /T
    // cannot reach. Match our own artifacts to keep the blast radius tight.
    killBootstrapProcesses()
    killMatchingProcesses([
      'plugin-marketplace',
      'plugin --profile',
      'apps/cli/lib/bin.js',
      'harness/apps/cli/lib/bin.js',
    ])
    forceExit()
  }
}

/**
 * P0-2: sanitize persisted window geometry against the CURRENT display layout.
 * A saved window that would be mostly off-screen (e.g. an external monitor was
 * unplugged) is discarded so the app falls back to maximize instead of
 * reopening somewhere the user cannot see it.
 */
function usableWindowBounds(bounds: WindowBounds | undefined): WindowBounds | undefined {
  if (!bounds || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
    return undefined
  }
  const MIN_VISIBLE = 80
  const wa = screen.getDisplayMatching({
    x: bounds.x ?? 0,
    y: bounds.y ?? 0,
    width: bounds.width,
    height: bounds.height,
  }).workArea
  if (bounds.x !== undefined && bounds.y !== undefined) {
    const visibleW = Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x)
    const visibleH = Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y)
    if (visibleW < MIN_VISIBLE || visibleH < MIN_VISIBLE) return undefined
  }
  return bounds
}

/**
 * P0-2: persist window geometry + maximized state (debounced 300ms) so the
 * next launch restores the same size/position, honoring “maximize on boot”.
 */
function watchWindowBounds(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const persist = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (window.isDestroyed()) return
      const b = window.getNormalBounds()
      const maximized = window.isMaximized()
      saveDesktopSettings(app.getPath('userData'), {
        ...loadDesktopSettings(app.getPath('userData')),
        windowBounds: {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          maximized,
        },
      })
    }, 300)
  }
  window.on('resize', persist)
  window.on('move', persist)
  window.on('maximize', persist)
  window.on('unmaximize', persist)
}

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const chrome = desktopChromeOptions(dark)
  const webPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    preload: preloadPath(),
    sandbox: true,
    webSecurity: true,
  }
  // P0-2: restore persisted bounds (fall back to maximize on first launch).
  const saved = usableWindowBounds(loadDesktopSettings(app.getPath('userData')).windowBounds)
  let window: BrowserWindow
  try {
    window = new BrowserWindow({
      width: saved?.width ?? 1380,
      height: saved?.height ?? 900,
      x: saved?.x,
      y: saved?.y,
      minWidth: 900,
      minHeight: 640,
      show: false,
      ...chrome,
      webPreferences,
    })
  } catch {
    window = new BrowserWindow({
      width: saved?.width ?? 1380,
      height: saved?.height ?? 900,
      x: saved?.x,
      y: saved?.y,
      minWidth: 900,
      minHeight: 640,
      show: false,
      title: HARNESS_WINDOW_TITLE,
      autoHideMenuBar: true,
      backgroundColor: chrome.backgroundColor,
      webPreferences,
    })
  }
  // No usable saved geometry (first run, or it fell off-screen) → maximize;
  // a saved maximized state is restored right after construction.
  if (!saved || saved.maximized) window.maximize()
  window.setMenuBarVisibility(false)
  watchWindowBounds(window)
  // In-window plugin panels must track the window geometry (resize / maximize).
  window.on('resize', () => layoutPluginConfigViews())
  window.on('maximize', () => layoutPluginConfigViews())
  window.on('unmaximize', () => layoutPluginConfigViews())
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(HARNESS_WINDOW_TITLE)
  })
  window.webContents.on('did-finish-load', () => {
    void window.webContents.insertCSS(FILL_VIEWPORT_CSS)
    void window.webContents.insertCSS(NO_DRAG_INTERACTIVES_CSS)
  })
  secureWindow(
    window,
    [desktopResourcePath('splash.html'), desktopResourcePath('setup.html')],
    () => (lastSnapshot.url ? [new URL(lastSnapshot.url).origin] : []),
  )
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.on('close', (event) => {
    if (quitting || forceExiting) return
    if (process.platform === 'darwin') {
      event.preventDefault()
      window.hide()
      return
    }
    void quitAll()
  })
  mainWindow = window
  return window
}

async function openHarness(url: string): Promise<void> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  if (shouldLoadHarnessUrl(window.webContents.getURL(), url)) {
    try {
      await window.loadURL(url)
    } catch (error) {
      if (isAbortedNavigationError(error)) return
      throw error
    }
  }
  if (lastSnapshot.url !== url || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function showSplash(): Promise<void> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  await window.loadFile(desktopResourcePath('splash.html'))
  if (window.isDestroyed()) return
  window.show()
  window.focus()
}

function showUnexpectedError(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  dialog.showErrorBox('my-dsh encountered an error', message)
}

/**
 * Ensure the bundled marketplace is installed AND matches this client build
 * in EVERY plugin home (primary + mirrors): a stale build is refreshed via
 * official CLI remove+add (the version fingerprint from
 * scripts/bump-version.mjs changed → pnpm re-snapshots the file: dep), a
 * missing market is first-run installed. The primary respects an intentional
 * uninstall (marketUserRemoved); mirrors are independent (a removed primary
 * market never silently kills another home's market). Best-effort per home.
 */
async function ensureMarketFreshness(
  dshCommand: string,
  marketPath: string,
  homes: string[],
  settings: DesktopSettings,
): Promise<{ primaryFirstInstall: boolean }> {
  const bundledVersion = marketBundledVersion(marketPath)
  let primaryFirstInstall = false
  for (let index = 0; index < homes.length; index++) {
    const home = homes[index]
    const isPrimary = index === 0
    if (isPrimary && settings.marketUserRemoved) continue
    try {
      if (marketNeedsRefresh(home, bundledVersion)) {
        const boot = await refreshMarket(dshCommand, marketPath, home)
        if (boot.ok) {
          logInfo(`marketplace refreshed → build ${bundledVersion} @ ${home}`)
          if (isPrimary) {
            saveDesktopSettings(app.getPath('userData'), {
              ...loadDesktopSettings(app.getPath('userData')),
              marketEverInstalled: true,
            })
          }
        } else {
          logWarn(`marketplace refresh failed @ ${home}: ${boot.output}`)
        }
      } else if (!isMarketInstalled(home)) {
        if (isPrimary && settings.marketEverInstalled) {
          // Was auto-installed before but is now missing (removed via CLI).
          saveDesktopSettings(app.getPath('userData'), { ...settings, marketUserRemoved: true })
        } else {
          const boot = await installMarket(dshCommand, marketPath, home)
          if (boot.ok) {
            if (isPrimary) {
              primaryFirstInstall = true
              saveDesktopSettings(app.getPath('userData'), {
                ...loadDesktopSettings(app.getPath('userData')),
                marketEverInstalled: true,
              })
            } else {
              logInfo(`marketplace first-installed @ mirror ${home}`)
            }
          } else {
            logWarn(`marketplace bootstrap failed @ ${home}: ${boot.output}`)
          }
        }
      }
    } catch (error) {
      logWarn(`marketplace bootstrap error @ ${home}: ${String(error)}`)
    }
  }
  return { primaryFirstInstall }
}

/**
 * Lazy plugin-homes repair: ask the marketplace (inside the engine) to bring
 * every mirror home up to the primary's plugin set. Fire-and-forget — a
 * missing market or transient failure is logged, never fatal. Only called
 * when the engine reports ready and there is at least one mirror.
 */
async function syncMarketHomes(harnessUrl: string, token: string): Promise<void> {
  if (!token) return
  const response = await net.fetch(new URL('/coeasy-market/api/sync', harnessUrl).href, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-market-broker': token,
    },
    body: JSON.stringify({ force: false }),
    signal: AbortSignal.timeout(305_000),
  })
  if (!response.ok) {
    const text = await response.text()
    logWarn(`market mirror sync returned ${response.status}: ${text.slice(0, 200)}`)
  }
}

async function launchHarness(): Promise<void> {
  if (quitting) return
  publishSnapshot({ phase: 'starting', message: 'Starting my-dsh…', logs: [], launchDirectory })
  await showSplash()
  if (quitting) return
  if (host) {
    await host.stop()
    rememberEngine(undefined)
  }
  const bundled = loadBundledRuntime()
  const engine = overrideEngineWithCache(
    resolveEngineLaunch({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      moduleDir: moduleDir(),
      repoRoot: repoRoot(),
      env: process.env,
      runtime: bundled,
    }),
  )
  if (engine.cloneBin && engine.dshCommand) {
    writeDevLauncher({ command: engine.dshCommand, cloneBin: engine.cloneBin })
  }
  const canonicalDshCommand = engine.dshCommand ? canonicalEnginePath(engine.dshCommand) : undefined
  const pluginPath = canonicalEnginePath(
    resolvePluginPath({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      moduleDir: moduleDir(),
    }),
  )
  const dshHome = effectiveHarnessHome()
  const sidecarEnv = loadDotEnvFile(sidecarDotEnvPath())
  const spawn = buildHarnessSpawnOptions(
    launchDirectory,
    dshHome,
    process.platform,
    process.env,
    sidecarEnv,
  )
  if (engine.mode === 'bundled' && spawn.env) {
    spawn.env = sanitizeBundledSpawnEnv(spawn.env)
  }
  marketBrokerToken = randomBytes(32).toString('base64url')
  // Plugin-homes sync matrix: the marketplace (running inside the engine)
  // reads DSH_MARKET_MIRRORS to broadcast installs to every other home. Only
  // re-evaluated at launch — changing pluginHomes needs a Harness restart.
  const pluginHomes = resolvePluginHomes(
    app.getPath('userData'),
    loadDesktopSettings(app.getPath('userData')),
  )
  // Put the engine's own runtime directory on PATH so any process in the
  // engine tree that shells out to a bare `dsh`/`dsh.cmd` launcher can resolve
  // it. Without this the engine fails with “dsh.cmd is not recognized” and the
  // client stalls waiting for ready.
  const dshRuntimeDir = engine.dshCommand ? dirname(engine.dshCommand) : ''
  spawn.env = {
    ...(spawn.env ?? process.env),
    DSH_MARKET_BROKER_TOKEN: marketBrokerToken,
    DSH_MARKET_MIRRORS: JSON.stringify(pluginHomes.mirrors),
    ...(dshRuntimeDir
      ? {
          PATH: `${dshRuntimeDir}${delimiter}${spawn.env?.PATH ?? process.env.PATH ?? ''}`,
        }
      : {}),
  }
  // Normalize the engine's profile junction to the current runtime BEFORE the
  // engine spawns: a stale/mismatched junction is rebuilt by the engine on
  // every boot, and two instances rebuilding it race into EPERM (symptom:
  // “click the exe, nothing happens”). Best-effort, never fatal.
  if (engine.mode === 'bundled' && dshRuntimeDir) {
    const result = normalizeEngineJunction({
      dshHome,
      runtimeDir: dshRuntimeDir,
      log: logInfo,
    })
    if (result.ok && result.action === 'repaired') {
      logInfo('engine-junction: normalized before engine spawn')
    }
  }
  try {
    rememberEngine(
      await launchHost({
        workspaceCwd: launchDirectory,
        mode: engine.mode,
        dshCommand: canonicalDshCommand ?? engine.dshCommand,
        downloadUrl: resolveDesktopDownloadUrl({ env: process.env, bundled }),
        pluginPath,
        readyTimeoutMs: 90_000,
        logPath: harnessLogPath(),
        // P0-1: the desktop client owns its window — never let the engine
        // open a second copy in the default browser.
        extraArgs: ['--no-open'],
        env: spawn.env,
        onProgress: (stage) => {
          const message = launchStageMessage(stage)
          publishSnapshot({
            phase: 'starting',
            message,
            logs: [],
            launchDirectory,
          })
          setSplashStatus(message)
        },
      }),
    )
    if (!host || quitting) return
    assertLoopbackUrl(host.url)
    bootFuseSteps = 0
    setUsageAnalyticsHttpClient({
      harnessUrl: host.url,
      fetchImpl: (url, init) => net.fetch(url, init),
    })
    setModelConfigHttpClient({
      harnessUrl: host.url,
      fetchImpl: (url, init) => net.fetch(url, init),
    })
    setDegenerationGuardHttpClient({
      harnessUrl: host.url,
      fetchImpl: (url, init) => net.fetch(url, init),
    })
    publishSnapshot({
      phase: 'ready',
      message: 'Harness is ready.',
      logs: [],
      launchDirectory,
      url: host.url,
    })
    // Lazy plugin-homes repair: converge every mirror onto the primary set.
    // Best-effort — never blocks launch, never fatal.
    if (pluginHomes.mirrors.length > 0 && marketBrokerToken) {
      void syncMarketHomes(host.url, marketBrokerToken).catch((error) =>
        logWarn(`market mirror sync skipped: ${String(error)}`),
      )
    }
    await openHarness(host.url)
    // Marketplace + first-party plugin bootstrap now runs in the BACKGROUND:
    // the engine hot-reloads profile patch changes (Cordis HMR via
    // watchUserPatches), so installs land on the already-live UI without a
    // restart or reload. Launch returns the moment the UI is up — plugin
    // provisioning never blocks the main window again.
    if (!quitting && engine.dshCommand) {
      const dshCommand = engine.dshCommand
      const userData = app.getPath('userData')
      const settings = loadDesktopSettings(userData)
      const marketPath = app.isPackaged
        ? join(process.resourcesPath, 'plugin-marketplace')
        : join(repoRoot(), 'plugins', 'plugin-marketplace')
      const firstParty = app.isPackaged
        ? firstPartyPluginsFromResources(process.resourcesPath)
        : firstPartyPluginsFromRepo(repoRoot())
      const homes = [pluginHomes.primary, ...pluginHomes.mirrors]
      void (async () => {
        if (quitting) return
        const { primaryFirstInstall } = await ensureMarketFreshness(
          dshCommand,
          marketPath,
          homes,
          settings,
        )
        if (primaryFirstInstall && !quitting) {
          const zh = harnessLocale() === 'zh'
          const opts: Electron.MessageBoxOptions = {
            type: 'info',
            message: zh ? '已为你开启插件市场' : 'Plugin Marketplace enabled',
            detail: zh
              ? '在 设置 → 插件市场 中浏览并安装社区插件。'
              : 'Browse and install community plugins under Settings → Marketplace.',
          }
          // Fire-and-forget: a modal here would block the background plugin
          // provisioning below until the user clicks, so built-in plugins
          // would never install on first launch.
          void (
            mainWindow && !mainWindow.isDestroyed()
              ? dialog.showMessageBox(mainWindow, opts)
              : dialog.showMessageBox(opts)
          ).catch(() => {})
        }
        if (quitting) return
        // First-party built-in plugins bootstrap: ensure model-config /
        // degeneration-guard / usage-analytics are installed (and current) in
        // every plugin home, from the copy bundled with THIS client —
        // portable across machines (resources when packaged, repo in dev).
        await ensureFirstPartyPlugins(dshCommand, firstParty, homes, (level, message) => {
          if (level === 'warn') logWarn(message)
          else logInfo(message)
        })
      })().catch((error) => {
        logWarn(`plugin bootstrap background task failed: ${String(error)}`)
      })
    }
  } catch (error) {
    rememberEngine(undefined)
    const message = error instanceof Error ? error.message : String(error)
    publishSnapshot({
      phase: 'failed',
      message,
      logs: [],
      launchDirectory,
    })
    // Auto boot-fusing: a freshly installed (broken) plugin fails the whole
    // fail-loud engine boot. Disable the newest community bundle one at a time
    // and retry, so every OTHER plugin keeps working. Only for plugin-like
    // failures — a runtime/network issue must never silently disable plugins.
    if (PLUGIN_FAILURE_HINTS.test(message) && bootFuseSteps < MAX_AUTO_FUSE_STEPS) {
      // Fuse the same newest-bundle on primary AND every mirror, so a broken
      // bundle can't keep another engine's home down either.
      const pluginHomes = resolvePluginHomes(
        app.getPath('userData'),
        loadDesktopSettings(app.getPath('userData')),
      )
      const recovery = disableNewestCommunityBundlesMany([
        pluginHomes.primary,
        ...pluginHomes.mirrors,
      ])
      const fused = recovery.results.filter((r) => r.ok && r.disabled.length > 0)
      const allDisabled = fused.flatMap((r) => r.disabled)
      if (allDisabled.length > 0) {
        bootFuseSteps += allDisabled.length
        logWarn(`boot fuse: disabled ${allDisabled.join(', ')} → retrying`)
        const zh = harnessLocale() === 'zh'
        await (mainWindow
          ? dialog.showMessageBox(mainWindow, {
              type: 'warning',
              message: zh ? '已自动禁用故障插件，正在重试' : 'Disabled a broken plugin; retrying',
              detail: zh
                ? `已禁用：${allDisabled.join(', ')}。其他插件不受影响，可稍后在插件市场重新安装。`
                : `Disabled: ${allDisabled.join(', ')}. Other plugins are unaffected; you can reinstall later.`,
              buttons: ['OK'],
            })
          : dialog.showMessageBox({
              type: 'warning',
              message: zh ? '已自动禁用故障插件，正在重试' : 'Disabled a broken plugin; retrying',
              detail: zh
                ? `已禁用：${allDisabled.join(', ')}。其他插件不受影响，可稍后在插件市场重新安装。`
                : `Disabled: ${allDisabled.join(', ')}. Other plugins are unaffected; you can reinstall later.`,
              buttons: ['OK'],
            }))
        if (quitting) return
        await launchHarness()
        return
      }
    }
    await showRuntimeFailure(lastSnapshot)
  }
}

async function showRuntimeFailure(snapshot: RuntimeSnapshot): Promise<void> {
  if (failureDialogVisible || quitting) return
  failureDialogVisible = true
  try {
    while (!quitting && lastSnapshot.phase === 'failed') {
      const zh = harnessLocale() === 'zh'
      const options: MessageBoxOptions = {
        type: 'error',
        title: zh ? 'Harness 未能启动' : 'Harness could not start',
        message: snapshot.message,
        detail: snapshot.launchDirectory
          ? zh
            ? `启动目录：${snapshot.launchDirectory}\n\n可以重试或查看 Harness 日志。`
            : `Launch directory: ${snapshot.launchDirectory}\n\nYou can retry or inspect the Harness log.`
          : zh
            ? '可以重试或查看 Harness 日志。'
            : 'You can retry or inspect the Harness log.',
        buttons: zh
          ? ['重试', '查看日志', '禁用新装插件并重试', '退出']
          : ['Retry', 'Show Log', 'Disable new plugins & retry', 'Quit'],
        defaultId: 0,
        cancelId: 3,
        noLink: true,
      }
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      if (result.response === 0) {
        await launchHarness()
      } else if (result.response === 1) {
        shell.showItemInFolder(harnessLogPath())
        continue
      } else if (result.response === 2) {
        // A freshly installed (broken) plugin can brick the whole boot; drop
        // non-core bundles and relaunch so the base layers come up. Apply to
        // primary AND every mirror so all homes boot on base layers.
        const pluginHomes = resolvePluginHomes(
          app.getPath('userData'),
          loadDesktopSettings(app.getPath('userData')),
        )
        const recovery = disableCommunityBundles(pluginHomes.primary)
        for (const mirror of pluginHomes.mirrors) disableCommunityBundles(mirror)
        const detail = recovery.ok
          ? zh
            ? `已禁用：${recovery.disabled.join(', ')}（主目录 + ${pluginHomes.mirrors.length} 个镜像目录）。依赖保留，重新安装可再次注册。`
            : `Disabled: ${recovery.disabled.join(', ')} (primary + ${pluginHomes.mirrors.length} mirror(s)). Dependencies kept; reinstall to re-register.`
          : (recovery.error ?? 'recovery failed')
        const info: Electron.MessageBoxOptions = {
          type: recovery.ok ? 'info' : 'warning',
          message: zh ? '已禁用新装插件' : 'Community plugins disabled',
          detail,
          buttons: ['OK'],
        }
        await (mainWindow ? dialog.showMessageBox(mainWindow, info) : dialog.showMessageBox(info))
        await launchHarness()
      } else {
        void quitAll()
      }
      if (lastSnapshot.phase !== 'failed') return
      snapshot = lastSnapshot
    }
  } catch (error) {
    showUnexpectedError(error)
  } finally {
    failureDialogVisible = false
  }
}

async function confirmLanBridge(): Promise<boolean> {
  const isChinese = harnessLocale() === 'zh'
  const options: MessageBoxOptions = {
    type: 'warning',
    title: isChinese ? '连接手机' : 'Connect Phone',
    message: isChinese ? '手机桥会在局域网监听。' : 'The phone bridge listens on your private LAN.',
    detail: isChinese
      ? '只接受同一 RFC1918 网段，并需要扫码配对。不要在不可信的 Wi-Fi 上开启。'
      : 'It accepts RFC1918/loopback clients after QR pairing. Do not enable it on untrusted Wi-Fi.',
    buttons: isChinese ? ['继续', '取消'] : ['Continue', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

async function showMobilePairing(): Promise<void> {
  if (!mobileBridge) return
  if (lastSnapshot.phase !== 'ready' || !lastSnapshot.url) {
    const options: MessageBoxOptions = {
      type: 'info',
      message: harnessLocale() === 'zh' ? 'Harness 仍在启动。' : 'Harness is still starting.',
      detail:
        harnessLocale() === 'zh'
          ? '请等桌面客户端就绪后再连接手机。'
          : 'Wait until the desktop client is ready, then connect your phone again.',
      buttons: ['OK'],
    }
    await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options))
    return
  }
  if (!mobileBridge.snapshot().running && !(await confirmLanBridge())) return

  const snapshot = await mobileBridge.start()
  if (!snapshot.desktopUrl || !snapshot.pairingUrl) {
    await mobileBridge.stop()
    const options: MessageBoxOptions = {
      type: 'warning',
      message:
        harnessLocale() === 'zh' ? '没有找到可用的局域网。' : 'No private Wi-Fi network was found.',
      detail:
        harnessLocale() === 'zh'
          ? '请把这台电脑连到和手机同一局域网后再试。'
          : 'Connect this computer to the same private Wi-Fi as your phone and try again.',
      buttons: ['OK'],
    }
    await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options))
    return
  }

  if (mobileWindow && !mobileWindow.isDestroyed()) mobileWindow.destroy()
  mobileWindow = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 420,
    minHeight: 560,
    title: harnessLocale() === 'zh' ? '连接手机' : 'Connect Phone',
    parent: mainWindow,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  secureWindow(mobileWindow, [], [new URL(snapshot.desktopUrl).origin])
  mobileWindow.on('closed', () => {
    mobileWindow = undefined
  })
  await mobileWindow.loadURL(snapshot.desktopUrl)
  mobileWindow.show()
  mobileWindow.focus()
}

async function stopMobileBridge(): Promise<void> {
  if (mobileWindow && !mobileWindow.isDestroyed()) mobileWindow.destroy()
  await mobileBridge?.stop()
}

/** In-window plugin panels (one WebContentsView per bundled first-party
 * plugin), embedded into the main window so they no longer pop out as
 * separate windows — consistent with how the market panel behaves. */
const pluginConfigViews = new Map<string, WebContentsView>()
let activePluginConfig: string | null = null

/** Float a close button over an embedded plugin panel (replaces the OS
 * titlebar close of the former standalone windows). */
const PLUGIN_PANEL_CLOSE_CSS = `
  #dsh-plugin-panel-close {
    position: fixed; top: 10px; right: 10px; z-index: 2147483647;
    width: 30px; height: 30px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(15,17,21,0.72); color: #c9d1d9;
    border: 1px solid rgba(255,255,255,0.12); cursor: pointer;
    font: 15px/1 system-ui, sans-serif; padding: 0;
  }
  #dsh-plugin-panel-close:hover { background: rgba(48,54,61,0.9); color: #fff; }
`

async function injectPluginPanelClose(webContents: Electron.WebContents): Promise<void> {
  try {
    await webContents.insertCSS(PLUGIN_PANEL_CLOSE_CSS)
    await webContents.executeJavaScript(`
      (function () {
        if (document.getElementById('dsh-plugin-panel-close')) return;
        var b = document.createElement('button');
        b.id = 'dsh-plugin-panel-close';
        b.type = 'button';
        b.setAttribute('aria-label', '关闭');
        b.title = '关闭';
        b.textContent = '✕';
        b.addEventListener('click', function () {
          try {
            window.dshDesktop && window.dshDesktop.pluginConfigClose && window.dshDesktop.pluginConfigClose();
          } catch (e) {}
        });
        (document.body || document.documentElement).appendChild(b);
      })();
    `)
  } catch {
    // Panel may have been closed while injecting; ignore.
  }
}

/** Lay out every visible plugin panel to fill the current main-window content
 * area (called on open and on main-window resize/maximize). */
function layoutPluginConfigViews(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.getContentBounds()
  for (const view of pluginConfigViews.values()) {
    if (view.webContents.isDestroyed()) continue
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  }
}

/** Hide all embedded plugin panels, returning focus to the engine page. */
function hidePluginConfigViews(): void {
  for (const view of pluginConfigViews.values()) {
    if (view.webContents.isDestroyed()) continue
    view.setVisible(false)
  }
  activePluginConfig = null
  mainWindow?.focus()
}

const PLUGIN_CONFIG_PAGES: Record<
  string,
  {
    html(bundlePath: string): string
    title: string
    width: number
    height: number
  }
> = {
  'model-config': {
    html: (bundlePath) => modelConfigPageHtml(bundlePath),
    get title() {
      return harnessLocale() === 'zh' ? '模型配置' : 'Model Config'
    },
    width: 900,
    height: 680,
  },
  'degeneration-guard': {
    html: (bundlePath) => guardPageHtml(bundlePath),
    get title() {
      return harnessLocale() === 'zh' ? '退化防护' : 'Degeneration Guard'
    },
    width: 760,
    height: 620,
  },
  'usage-analytics': {
    html: (bundlePath) => usageAnalyticsPageHtml(bundlePath),
    get title() {
      return harnessLocale() === 'zh' ? '用量分析' : 'Usage Analytics'
    },
    width: 1080,
    height: 720,
  },
}

/** Open (or bring to front) the in-window panel for a bundled plugin. The page
 * and its bundle are materialized under the userData dir so both load over
 * file:// (CSP `script-src 'self'` holds within the same directory) and the
 * existing file:// trust rules apply unchanged. */
async function showPluginConfigView(plugin: string): Promise<void> {
  const spec = PLUGIN_CONFIG_PAGES[plugin]
  if (!spec) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  // Close whatever panel is currently open before stacking the new one.
  if (activePluginConfig && activePluginConfig !== plugin) {
    pluginConfigViews.get(activePluginConfig)?.setVisible(false)
  }
  const dir = join(app.getPath('userData'), 'plugin-ui')
  mkdirSync(dir, { recursive: true })
  const bundleSrc = desktopResourcePath(join('plugin-ui', `${plugin}.js`))
  if (!existsSync(bundleSrc)) return
  // Overwrite the cached bundle so UI fixes ship on next open (mirror-update).
  cpSync(bundleSrc, join(dir, `${plugin}.js`), { force: true })
  const htmlPath = join(dir, `${plugin}.html`)
  writeFileSync(htmlPath, spec.html(`./${plugin}.js`), 'utf8')

  let view = pluginConfigViews.get(plugin)
  if (!view || view.webContents.isDestroyed()) {
    view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath(),
        sandbox: true,
        webSecurity: true,
      },
    })
    secureWindow(view, [dir], [])
    pluginConfigViews.set(plugin, view)
    try {
      await view.webContents.loadFile(htmlPath)
    } catch (error) {
      if (isAbortedNavigationError(error)) return
      throw error
    }
    if (view.webContents.isDestroyed()) return
  }
  // Float the close button. Idempotent, and re-run on every open: a cached
  // panel that missed its injection (e.g. dom-ready already fired before the
  // listener was attached) gets one on the next open.
  void injectPluginPanelClose(view.webContents)
  // Re-add to the top of the child-view stack so it sits above everything.
  if (!mainWindow.contentView.children.includes(view)) {
    mainWindow.contentView.addChildView(view)
  } else {
    mainWindow.contentView.removeChildView(view)
    mainWindow.contentView.addChildView(view)
  }
  layoutPluginConfigViews()
  view.setVisible(true)
  activePluginConfig = plugin
}

function closeAllPluginConfigWindows(): void {
  for (const view of pluginConfigViews.values()) {
    if (view.webContents.isDestroyed()) continue
    mainWindow?.contentView.removeChildView(view)
    view.webContents.close()
  }
  pluginConfigViews.clear()
  activePluginConfig = null
}

async function chooseFolder(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(mainWindow ?? createWindow(), {
    title: harnessLocale() === 'zh' ? '选择工作区' : 'Choose workspace',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return undefined
  return result.filePaths[0]
}

async function applyWorkspace(folder: string, restart: boolean): Promise<void> {
  if (!isUsableWorkspace(folder)) return
  const userData = app.getPath('userData')
  const settings = loadDesktopSettings(userData)
  saveDesktopSettings(userData, { ...settings, workspace: folder })
  launchDirectory = folder
  if (restart) await launchHarness()
}

async function exportDiagnostics(): Promise<void> {
  const originPath = app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'origin.json')
    : join(moduleDir(), '..', '..', '..', 'runtime', 'payload', 'origin.json')
  let engineRef = ''
  if (existsSync(originPath)) {
    try {
      const origin = JSON.parse(readFileSync(originPath, 'utf8')) as { ref?: unknown }
      if (typeof origin.ref === 'string') engineRef = origin.ref
    } catch {
      engineRef = ''
    }
  }
  const logTail = existsSync(harnessLogPath())
    ? readFileSync(harnessLogPath(), 'utf8').slice(-80_000)
    : ''
  const report = buildDiagnosticsReport({
    appVersion: app.getVersion(),
    engineRef,
    workspace: launchDirectory,
    packaged: app.isPackaged,
    logTail,
  })
  const dest = join(app.getPath('documents'), `dsh-client-diagnostics-${Date.now()}.txt`)
  writeFileSync(dest, report, 'utf8')
  shell.showItemInFolder(dest)
}

/** Bundled engine ref that ships inside the client resources. */
const BUNDLED_ENGINE_VERSION = '0.1.0'

function engineCacheRoot(): string {
  return join(app.getPath('userData'), 'engine-cache')
}

/** Download manifest awaiting an explicit activation/restart step (if any). */
let pendingEngineUpdate: EngineUpdateManifest | undefined

/** Use the cache as the live engine when a newer/pinned version is usable. */
function overrideEngineWithCache(
  engine: ReturnType<typeof resolveEngineLaunch>,
): ReturnType<typeof resolveEngineLaunch> {
  const active = resolveActiveEngineDir(engineCacheRoot(), BUNDLED_ENGINE_VERSION)
  if (!active) return engine
  const launcher = join(active.dir, engineLauncherName(process.platform))
  if (!existsSync(launcher)) return engine
  return { ...engine, dshCommand: launcher }
}

function engineStatusMessage(): {
  activeVersion?: string
  pendingVersion?: string
  rollbackAvailable: boolean
  hasNewer: boolean
} {
  const cacheRoot = engineCacheRoot()
  const active = resolveActiveEngineDir(cacheRoot, BUNDLED_ENGINE_VERSION)
  const rollbackAvailable =
    (active && Boolean(rollbackCandidate(cacheRoot, active.version))) || Boolean(active)
  return {
    activeVersion: active?.version,
    pendingVersion: pendingEngineUpdate?.version,
    rollbackAvailable,
    hasNewer: Boolean(active),
  }
}

/** Extract + pin a downloaded engine version, then restart the shell. */
async function applyEngineActivation(version: string): Promise<string> {
  const msg = await applyEngineActivationCore(version)
  await performEngineRestart()
  return msg
}

async function applyEngineActivationCore(version: string): Promise<string> {
  const isChinese = harnessLocale() === 'zh'
  let info: { dir: string; entries: number }
  try {
    info = activateEngineVersion({ cacheRoot: engineCacheRoot(), version })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (isChinese) return `激活失败：${detail}`
    return `Activation failed: ${detail}`
  }
  if (isChinese) {
    return `引擎 ${version} 已解压并激活，正在重启（${info.entries} 个文件）。`
  }
  return `Engine ${version} extracted and activated (${info.entries} entries); restarting.`
}

/** Resolve the previous usable engine and relaunch with it. */
async function applyEngineRollback(): Promise<string> {
  const isChinese = harnessLocale() === 'zh'
  const cacheRoot = engineCacheRoot()
  const active = resolveActiveEngineDir(cacheRoot, BUNDLED_ENGINE_VERSION)
  const previous = active ? rollbackCandidate(cacheRoot, active.version) : undefined
  let target: string
  if (previous) {
    const version = previous.split(/[\\/]/u).pop() ?? ''
    writeActiveEngineVersion(cacheRoot, version)
    target = isChinese
      ? `已回滚到引擎 ${version}，正在重启。`
      : `Rolled back to engine ${version}; restarting.`
  } else {
    clearActiveEngineVersion(cacheRoot)
    target = isChinese
      ? '未找到更早的本地引擎，已恢复使用内置引擎，正在重启。'
      : 'No older local engine found; restored the bundled engine and restarting.'
  }
  await performEngineRestart()
  return target
}

/** Stop the engine and relaunch the desktop shell so a new engine boots. */
async function performEngineRestart(): Promise<void> {
  publishSnapshot({
    phase: 'restarting',
    message: 'Restarting to apply engine change…',
    logs: [],
    launchDirectory,
  })
  if (host) {
    await host.stop().catch(() => undefined)
    rememberEngine(undefined)
    host = undefined
  }
  app.relaunch()
  app.exit(0)
}

async function checkForEngineUpdate(interactive: boolean): Promise<string> {
  const repo = parseGithubRepo(process.env.DSH_GITHUB_REPO)
  const isChinese = harnessLocale() === 'zh'
  if (!repo) {
    const msg = isChinese
      ? '未配置更新源（DSH_GITHUB_REPO）。'
      : 'No engine update source (DSH_GITHUB_REPO).'
    if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
    return msg
  }
  const res = await net.fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,
    { headers: { 'User-Agent': 'my-dsh' } },
  )
  if (!res.ok) throw new Error(`engine update: GitHub HTTP ${res.status}`)
  const latest = parseLatestRelease(await res.text())
  if (!latest) {
    const msg = isChinese ? '未能解析最新引擎版本。' : 'Could not parse the latest engine release.'
    if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
    return msg
  }
  const cacheRoot = engineCacheRoot()
  const bundledRef = BUNDLED_ENGINE_VERSION
  if (!isNewerVersion(latest.ref, bundledRef)) {
    const msg = isChinese ? `引擎已是 ${bundledRef}。` : `Engine is up to date (${bundledRef}).`
    if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
    return msg
  }
  const manifestUrl = process.env.DSH_ENGINE_UPDATE_URL
  let manifestRaw = ''
  if (manifestUrl) {
    let parsedManifestUrl: URL
    try {
      parsedManifestUrl = new URL(manifestUrl)
    } catch {
      parsedManifestUrl = new URL('about:blank')
    }
    if (parsedManifestUrl.protocol !== 'https:') {
      const msg = isChinese
        ? '引擎更新清单必须使用 HTTPS。'
        : 'The engine update manifest must use HTTPS.'
      if (interactive)
        await dialog.showMessageBox({ type: 'warning', message: msg, buttons: ['OK'] })
      return msg
    }
    const manifestResponse = await net.fetch(parsedManifestUrl.href)
    if (!manifestResponse.ok)
      throw new Error(`engine update manifest: HTTP ${manifestResponse.status}`)
    manifestRaw = await manifestResponse.text()
  }
  const manifest = parseEngineUpdateManifest(manifestRaw)
  if (!manifest) {
    const msg = isChinese
      ? `发现新引擎 ${latest.ref}，但未配置可下载清单（DSH_ENGINE_UPDATE_URL）。`
      : `Engine ${latest.ref} available, but no manifest (DSH_ENGINE_UPDATE_URL).`
    if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
    return msg
  }
  await downloadEnginePayload({
    cacheRoot,
    version: manifest.version,
    url: manifest.url,
    checksum: manifest.checksum,
    fetchImpl: (u, init) => net.fetch(u instanceof URL ? u.href : u, init),
  })
  pendingEngineUpdate = manifest
  if (!interactive) {
    return `Engine ${manifest.version} downloaded and verified; activation is pending.`
  }
  const dir = engineVersionDir(cacheRoot, manifest.version)
  const options: MessageBoxOptions = {
    type: 'question',
    title: isChinese ? '引擎更新就绪' : 'Engine update ready',
    message: isChinese
      ? `引擎 ${manifest.version} 已下载并校验。激活后需要重启，是否现在激活？`
      : `Engine ${manifest.version} is downloaded and verified. Activate and restart?`,
    detail: isChinese
      ? `下载目录：${dir}\n激活后将立即重启以加载新引擎。`
      : `Cache: ${dir}\nActivating relaunches the shell to load the new engine.`,
    buttons: isChinese ? ['现在激活并重启', '稍后'] : ['Activate & restart', 'Later'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  if (result.response !== 0) {
    const msg = isChinese
      ? `引擎 ${manifest.version} 已下载并校验，等待后续激活。`
      : `Engine ${manifest.version} downloaded and verified; activation is pending.`
    return msg
  }
  return applyEngineActivation(manifest.version)
}

async function showSetupIfNeeded(fallback: string): Promise<void> {
  const settings = loadDesktopSettings(app.getPath('userData'))
  launchDirectory = resolveLaunchDirectory(settings.workspace, fallback)
  if (
    isUsableWorkspace(settings.workspace ?? '') &&
    (currentApiKeyPresent() || settings.apiKeyPrompted)
  ) {
    return
  }
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  const finished = new Promise<{ workspace: string; apiKey: string }>((resolve) => {
    setupWaiter = resolve
  })
  await window.loadFile(desktopResourcePath('setup.html'))
  window.show()
  window.focus()
  const result = await finished
  setupWaiter = undefined
  if (result.workspace) await applyWorkspace(result.workspace, false)
  persistApiKey(result.apiKey)
  const userData = app.getPath('userData')
  saveDesktopSettings(userData, { ...loadDesktopSettings(userData), apiKeyPrompted: true })
}

async function confirmMarketAction(request: MarketActionRequest): Promise<boolean> {
  const zh = harnessLocale() === 'zh'
  const target =
    typeof request.payload.full_name === 'string'
      ? request.payload.full_name
      : request.kind === 'restore'
        ? zh
          ? '备份中的插件集合'
          : 'the plugins in this backup'
        : zh
          ? '当前安装'
          : 'this installation'
  const labels: Record<MarketActionRequest['kind'], { zh: string; en: string }> = {
    install: { zh: '安装插件', en: 'Install plugin' },
    update: { zh: '更新插件', en: 'Update plugin' },
    remove: { zh: '移除插件', en: 'Remove plugin' },
    toggle: { zh: '更改插件状态', en: 'Change plugin state' },
    restore: { zh: '恢复插件备份', en: 'Restore plugin backup' },
    sync: { zh: '同步插件目录', en: 'Sync plugin homes' },
    'uninstall-market': { zh: '卸载插件市场', en: 'Uninstall Marketplace' },
    'uninstall-app': { zh: '卸载 my-dsh', en: 'Uninstall my-dsh' },
  }
  const label = zh ? labels[request.kind].zh : labels[request.kind].en
  const options: MessageBoxOptions = {
    type:
      request.kind.startsWith('uninstall') || request.kind === 'remove' ? 'warning' : 'question',
    title: label,
    message: zh ? `确认${label}？` : `${label}?`,
    detail: String(target),
    buttons: zh ? ['继续', '取消'] : ['Continue', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

function installIpc(): void {
  ipcMain.handle('engine:check-update', () =>
    checkForEngineUpdate(true).catch((e) => (e instanceof Error ? e.message : String(e))),
  )
  ipcMain.handle('engine:activity', () => {
    const pending = pendingEngineUpdate
    const status = engineStatusMessage()
    return {
      ...status,
      pendingVersion: pending?.version ?? status.pendingVersion,
      pendingChecksum: pending?.checksum,
      bundledVersion: BUNDLED_ENGINE_VERSION,
      cacheRoot: engineCacheRoot(),
    }
  })
  ipcMain.handle('engine:activate', () => {
    const pending = pendingEngineUpdate
    if (!pending) {
      const isChinese = harnessLocale() === 'zh'
      return isChinese ? '尚未下载新的引擎包。' : 'No pending engine download to activate.'
    }
    return applyEngineActivation(pending.version).catch((e) =>
      e instanceof Error ? e.message : String(e),
    )
  })
  ipcMain.handle('engine:rollback', () =>
    applyEngineRollback().catch((e) => (e instanceof Error ? e.message : String(e))),
  )
  ipcMain.handle('mobile:open-pairing', () => showMobilePairing())
  ipcMain.handle('mobile:status', () => ({
    connected: mobileBridge?.snapshot().connected === true,
    running: mobileBridge?.snapshot().running === true,
  }))
  ipcMain.handle('desktop:pick-folder', () => chooseFolder())
  ipcMain.handle('desktop:setup-defaults', () => ({
    workspace: launchDirectory,
    hasKey: currentApiKeyPresent(),
  }))
  ipcMain.handle(
    'desktop:complete-setup',
    (_event, payload: { workspace?: unknown; apiKey?: unknown }) => {
      setupWaiter?.({
        workspace: typeof payload?.workspace === 'string' ? payload.workspace : '',
        apiKey: typeof payload?.apiKey === 'string' ? payload.apiKey : '',
      })
      return true
    },
  )
  // When the user has already been prompted for an API key but never
  // configured one, skip the engine's full-screen onboarding takeover so the
  // client opens straight to a usable UI instead of a blocking modal.
  ipcMain.handle('desktop:should-skip-onboarding', () => {
    const settings = loadDesktopSettings(app.getPath('userData'))
    return settings.apiKeyPrompted === true && !currentApiKeyPresent()
  })
  ipcMain.handle('usage-analytics:action', async (_event, request: unknown) => {
    const req =
      typeof request === 'object' && request !== null
        ? (request as { kind: string; payload?: unknown })
        : { kind: String(request) }
    return dispatchUsageAnalyticsAction(req)
  })
  ipcMain.handle('model-config:action', (_event, request: unknown) =>
    dispatchModelConfigAction(request),
  )
  ipcMain.handle('degeneration-guard:action', (_event, request: unknown) =>
    dispatchDegenerationGuardAction(request),
  )
  ipcMain.handle('plugin-config:open', (_event, payload: unknown) => {
    const plugin =
      typeof payload === 'object' && payload !== null && 'plugin' in payload
        ? String((payload as { plugin?: unknown }).plugin ?? '')
        : ''
    if (!PLUGIN_CONFIG_PAGES[plugin])
      return { ok: false, error: `unknown plugin config: ${plugin}` }
    void showPluginConfigView(plugin)
    return { ok: true }
  })
  ipcMain.handle('plugin-config:close', () => {
    hidePluginConfigViews()
    return { ok: true }
  })
  ipcMain.handle('market:action', async (event, request: unknown) => {
    if (!host?.url) return { ok: false, error: 'Harness is not ready' }
    try {
      return await executeMarketBrokerAction({
        request,
        senderUrl: event.senderFrame?.url ?? event.sender.getURL(),
        harnessUrl: host.url,
        token: marketBrokerToken,
        confirm: confirmMarketAction,
        fetchImpl: (url, init) => net.fetch(url, init),
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Harness home discovery / selection / import + plugin-homes sync matrix
  // (multi-dir compatibility).
  ipcMain.handle('home:discover', () => {
    const homes = discoverHarnessHomes(app.getPath('userData'))
    return {
      homes,
      current: effectiveHarnessHome(),
      pluginHomes: resolvePluginHomes(
        app.getPath('userData'),
        loadDesktopSettings(app.getPath('userData')),
      ),
    }
  })
  ipcMain.handle('home:set-homes', (_event, value: unknown) => {
    const userData = app.getPath('userData')
    const settings = loadDesktopSettings(userData)
    const raw =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as { primary?: unknown; mirrors?: unknown })
        : {}
    const next: { primary?: string; mirrors?: string[] } = {}
    if (typeof raw.primary === 'string' && raw.primary.trim()) next.primary = raw.primary.trim()
    if (Array.isArray(raw.mirrors)) {
      const mirrors = raw.mirrors.filter(
        (m): m is string => typeof m === 'string' && m.trim().length > 0,
      )
      if (mirrors.length > 0) next.mirrors = mirrors.map((m) => m.trim())
    }
    saveDesktopSettings(userData, { ...settings, pluginHomes: next })
    const resolved = resolvePluginHomes(userData, { pluginHomes: next })
    logWarn(
      `plugin homes updated: primary=${resolved.primary} mirrors=[${resolved.mirrors.join(', ')}]`,
    )
    // The marketplace reads the matrix at engine launch — a restart applies it.
    return { ok: true, ...resolved, restartRequired: true }
  })
  ipcMain.handle('home:set', (_event, mode: unknown) => {
    if (typeof mode !== 'string' || mode.trim() === '') return { ok: false, error: 'invalid mode' }
    const userData = app.getPath('userData')
    saveDesktopSettings(userData, { ...loadDesktopSettings(userData), harnessHome: mode.trim() })
    return { ok: true, current: effectiveHarnessHome() }
  })
  ipcMain.handle('home:import', async (_event, source: unknown) => {
    if (typeof source !== 'string' || source.trim() === '') {
      return { ok: false, error: 'invalid source' }
    }
    const target = effectiveHarnessHome()
    const result = importHarnessHome(source.trim(), target)
    if (!result.ok) return { ok: false, error: result.error ?? 'import failed' }
    logWarn(`harness home imported: ${source} → ${target}`)
    return { ok: true, target }
  })
}

function installMenu(): void {
  const isChinese = harnessLocale() === 'zh'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: isChinese ? '文件' : 'File',
      submenu: [
        {
          label: isChinese ? '打开工作区…' : 'Open Workspace…',
          accelerator: 'CmdOrCtrl+O',
          click: () =>
            void chooseFolder()
              .then((folder) => (folder ? applyWorkspace(folder, true) : undefined))
              .catch(showUnexpectedError),
        },
        {
          label: isChinese ? '导出诊断…' : 'Export Diagnostics…',
          click: () => void exportDiagnostics().catch(showUnexpectedError),
        },
        { type: 'separator' },
        {
          label: isChinese ? '检查更新…' : 'Check for Updates…',
          click: () =>
            void checkForAppUpdates({ interactive: true, locale: harnessLocale() }).catch(
              showUnexpectedError,
            ),
        },
        ...(process.platform === 'darwin'
          ? []
          : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Harness',
      submenu: [
        {
          label: isChinese ? '连接手机…' : 'Connect Phone…',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => void showMobilePairing().catch(showUnexpectedError),
        },
        {
          label: isChinese ? '停止手机桥' : 'Stop Phone Bridge',
          click: () => void stopMobileBridge().catch(showUnexpectedError),
        },
        { type: 'separator' },
        {
          label: isChinese ? '重启 Harness' : 'Restart Harness',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => void launchHarness().catch(showUnexpectedError),
        },
        {
          label: isChinese ? '打开 Harness 日志' : 'Show Harness Log',
          click: () => shell.showItemInFolder(harnessLogPath()),
        },
      ],
    },
    {
      label: isChinese ? '编辑' : 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: isChinese ? '查看' : 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: isChinese ? '窗口' : 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function bootstrap(): Promise<void> {
  // Register IPC handlers before any window/page loads: the preload calls
  // mobile:status on every page (including splash), which would otherwise
  // race ahead of installIpc() and log "No handler registered".
  installIpc()
  createWindow()
  await showSplash()
  reapRecordedEngine()
  const fallback = await ensureLaunchRoot(app.getPath('userData'))
  statusTray = createStatusTray({
    iconPath: trayIconPath(),
    locale: harnessLocale(),
    snapshot: lastSnapshot,
    onShow: showMainWindow,
    onMarket: showMainWindow,
    onRestart: () => {
      if (!quitting) void launchHarness().catch(showUnexpectedError)
    },
    onQuit: () => {
      void quitAll()
    },
  })
  mobileBridge = new LanMobileBridge({
    harnessUrl: () => lastSnapshot.url,
    locale: harnessLocale,
    port: app.isPackaged ? 43127 : 43128,
  })
  installMenu()
  await showSetupIfNeeded(fallback)
  const settings = loadDesktopSettings(app.getPath('userData'))
  if (settings.autoUpdate !== false && app.isPackaged) {
    void checkForAppUpdates({ interactive: false, locale: harnessLocale() }).catch(() => undefined)
  }
  await launchHarness()
}

configureAppIdentity()
initObservability()
logInfo('app starting')
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      showUnexpectedError(error)
      void quitAll()
    })
  app.on('activate', () => {
    if (quitting) return
    showMainWindow()
    if (lastSnapshot.phase === 'idle') {
      void launchHarness().catch(showUnexpectedError)
    }
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !quitting) void quitAll()
  })
  app.on('before-quit', (event) => {
    if (forceExiting) return
    event.preventDefault()
    if (!quitting) void quitAll()
  })
}
